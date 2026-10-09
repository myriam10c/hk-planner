// Faux client Supabase pour les tests des modules v3. Pas de reseau, pas de
// supabase-js : il reproduit uniquement ce que les actions v3 utilisent de
// PostgREST, et garde la trace des ecritures. L'unicite est declaree par table,
// pour qu'un insert en double rende un vrai 23505 comme Postgres.
const UNIQUE: Record<string, string[]> = {
  job_events: ["idem_key"],
  cleaning_timer: ["reservation_key"],
  checklist_progress: ["reservation_key", "item_name"],
  menage_done: ["reservation_key"],
  laundry_counts: ["reservation_key"],
  photos: ["storage_path"],
  on_duty: ["duty_date"],
  v3_job_keys: ["job_id"],
  cleaning_reports: ["job_id"],
  inspections: ["idem_key"],
  inspection_items: ["inspection_id", "zone"],
  inspection_photos: ["idem_key"],
  inspection_proposals: ["proposal_date", "listing_id"],
  proxy_cache: ["key"],
  security_contacts_doc: ["id"],
};

// Tables dont created_at est rempli par la base a l'insertion.
const DEFAULT_NOW = new Set(['job_events']);

// honorOrder : applique .order() (sinon no-op, comportement historique des tests).
// maxRows : plafond de lignes par select comme le max_rows de PostgREST (defaut : aucun).
export function fakeDb(seed: Record<string, any[]> = {}, opts: { maxRows?: number; honorOrder?: boolean } = {}) {
  const tables: Record<string, any[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  const writes: Array<{ table: string; op: string; values: any }> = [];
  // Erreurs a injecter, par cle "table.op" : fail["cleaning_timer.upsert"] = {...}
  const fail: Record<string, any> = {};
  let nextId = 1000;

  function from(table: string) {
    const filters: Array<{ col: string; val: any; kind: "eq" | "in" | "or" | "gte" | "lte" | "lt" | "gt" | "isnull" }> = [];
    let pending: { op: string; values: any; opts?: any } | null = null;
    const orders: Array<{ col: string; asc: boolean }> = [];
    let slice: [number, number] | null = null; // .range(a, b) : bornes incluses
    const list = () => (tables[table] ??= []);
    // « payload->>listingId » : chemin JSON texte de PostgREST, un seul niveau.
    const lire = (r: any, col: string) => {
      const i = col.indexOf("->>");
      if (i < 0) return r[col];
      const v = r[col.slice(0, i)]?.[col.slice(i + 3)];
      return v === undefined || v === null ? undefined : String(v);
    };
    // Comparaisons par chaines : toutes les valeurs comparees sont des dates ISO.
    const cmp = (kind: string, a: any, b: any) =>
      kind === "gte" ? String(a) >= String(b) : kind === "lte" ? String(a) <= String(b)
      : kind === "lt" ? String(a) < String(b) : String(a) > String(b);
    const match = (r: any) =>
      filters.every((f) =>
        f.kind === "or"
          // PostgREST or("col.is.null,col.eq.v") : une des alternatives suffit.
          ? String(f.val).split(",").some((alt) => {
            const [c, op, ...rest] = alt.split(".");
            const v = rest.join(".");
            return op === "is" && v === "null" ? (lire(r, c) ?? null) === null
              : op === "eq" && String(lire(r, c)) === v;
          })
          : f.kind === "in"
          ? (f.val as any[]).map(String).includes(String(lire(r, f.col)))
          : f.kind === "eq"
          ? String(lire(r, f.col)) === String(f.val)
          : f.kind === "isnull"
          ? (lire(r, f.col) ?? null) === null
          : (lire(r, f.col) !== undefined && lire(r, f.col) !== null && cmp(f.kind, lire(r, f.col), f.val))
      );
    const selected = () => list().filter(match);
    const sameUnique = (a: any, b: any) => {
      const cols = UNIQUE[table] ?? [];
      return cols.length > 0 && cols.every((c) => String(a[c]) === String(b[c]));
    };

    async function run(): Promise<{ data: any; error: any }> {
      const key = table + "." + (pending ? pending.op : "select");
      if (fail[key]) return { data: null, error: fail[key] };
      if (!pending) {
        let all = selected();
        if (opts.honorOrder && orders.length) {
          all = all.slice().sort((a, b) => {
            for (const o of orders) {
              const x = lire(a, o.col), y = lire(b, o.col);
              const c = x === y ? 0 : (typeof x === "number" && typeof y === "number" ? x - y : String(x) < String(y) ? -1 : 1);
              if (c) return o.asc ? c : -c;
            }
            return 0;
          });
        }
        const part = slice ? all.slice(slice[0], slice[1] + 1) : all;
        return { data: opts.maxRows ? part.slice(0, opts.maxRows) : part, error: null };
      }
      const rows = Array.isArray(pending.values) ? pending.values : [pending.values];
      if (pending.op === "insert") {
        const out: any[] = [];
        for (const v of rows) {
          if (list().some((r) => sameUnique(r, v))) {
            return { data: null, error: { code: "23505", message: "duplicate key" } };
          }
          // Defaut de colonne created_at DEFAULT now() (les filtres de date le lisent).
          const row = { id: nextId++, ...(DEFAULT_NOW.has(table) ? { created_at: new Date().toISOString() } : {}), ...v };
          list().push(row);
          out.push(row);
        }
        writes.push({ table, op: "insert", values: rows });
        return { data: out, error: null };
      }
      if (pending.op === "upsert") {
        const out: any[] = [];
        for (const v of rows) {
          const i = list().findIndex((r) => sameUnique(r, v));
          // ignoreDuplicates : ON CONFLICT DO NOTHING, la ligne existante reste.
          if (i >= 0 && pending.opts?.ignoreDuplicates) continue;
          if (i >= 0) list()[i] = { ...list()[i], ...v };
          else list().push({ id: nextId++, ...v });
          out.push(v);
        }
        writes.push({ table, op: "upsert", values: rows });
        return { data: out, error: null };
      }
      if (pending.op === "update") {
        const hit = selected();
        for (const r of hit) Object.assign(r, pending.values);
        writes.push({ table, op: "update", values: pending.values });
        return { data: hit, error: null };
      }
      if (pending.op === "delete") {
        const keep = list().filter((r) => !match(r));
        writes.push({ table, op: "delete", values: filters.map((f) => [f.col, f.val]) });
        tables[table] = keep;
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }

    const q: any = {
      select: () => q,
      eq: (col: string, val: any) => { filters.push({ col, val, kind: "eq" }); return q; },
      or: (expr: string) => { filters.push({ col: "", val: expr, kind: "or" }); return q; },
      in: (col: string, val: any[]) => { filters.push({ col, val, kind: "in" }); return q; },
      order: (col: string, o?: { ascending?: boolean }) => { orders.push({ col, asc: o?.ascending !== false }); return q; },
      limit: () => q, not: () => q,
      range: (a: number, b: number) => { slice = [a, b]; return q; },
      is: (col: string, val: any) => { if (val === null) filters.push({ col, val, kind: "isnull" }); return q; },
      gte: (col: string, val: any) => { filters.push({ col, val, kind: "gte" }); return q; },
      lte: (col: string, val: any) => { filters.push({ col, val, kind: "lte" }); return q; },
      lt: (col: string, val: any) => { filters.push({ col, val, kind: "lt" }); return q; },
      gt: (col: string, val: any) => { filters.push({ col, val, kind: "gt" }); return q; },
      // `like` n'est pas simule : la lecture des instantanes rend toute la table,
      // ce qui suffit aux tests et rend `pickSnapshot` seul juge du choix.
      like: () => q,
      insert: (values: any) => { pending = { op: "insert", values }; return q; },
      upsert: (values: any, opts?: any) => { pending = { op: "upsert", values, opts }; return q; },
      update: (values: any) => { pending = { op: "update", values }; return q; },
      delete: () => { pending = { op: "delete", values: null }; return q; },
      maybeSingle: async () => {
        const r = await run();
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
      },
      single: async () => {
        const r = await run();
        const row = Array.isArray(r.data) ? (r.data[0] ?? null) : r.data;
        return { data: row, error: r.error ?? (row ? null : { message: "no rows" }) };
      },
      then: (res: any, rej: any) => run().then(res, rej),
    };
    return q;
  }

  // Faux Storage : upload et URL signee, sans reseau. Les octets sont gardes
  // pour que les tests puissent verifier ce qui est parti dans le bucket.
  const uploads: Array<{ bucket: string; path: string; bytes: number; contentType: string }> = [];
  // Historique des retraits. `uploads` reste l'image du bucket (un retrait en
  // sort l'objet), `removals` garde la trace de l'appel pour qu'un test puisse
  // affirmer que le nettoyage a bien vise le bon chemin.
  const removals: Array<{ bucket: string; paths: string[] }> = [];
  // Appels de signature par lot, pour verifier qu'une journee ne signe qu'une fois.
  const signBatches: Array<{ bucket: string; paths: string[]; seconds: number }> = [];
  const storage = {
    uploads,
    removals,
    signBatches,
    from(bucket: string) {
      return {
        async upload(path: string, body: any, opts: any) {
          if (fail["storage.upload"]) return { data: null, error: fail["storage.upload"] };
          const bytes = body && typeof body.byteLength === "number"
            ? body.byteLength
            : (body && typeof body.size === "number" ? body.size : 0);
          uploads.push({ bucket, path, bytes, contentType: opts?.contentType ?? "" });
          return { data: { path }, error: null };
        },
        async remove(paths: string[]) {
          if (fail["storage.remove"]) return { data: null, error: fail["storage.remove"] };
          removals.push({ bucket, paths: [...paths] });
          for (const chemin of paths) {
            const i = uploads.findIndex((u) => u.bucket === bucket && u.path === chemin);
            if (i >= 0) uploads.splice(i, 1);
          }
          return { data: paths.map((chemin) => ({ name: chemin })), error: null };
        },
        async createSignedUrls(paths: string[], seconds: number) {
          if (fail["storage.sign"]) return { data: null, error: fail["storage.sign"] };
          signBatches.push({ bucket, paths: [...paths], seconds });
          return {
            data: paths.map((p) => ({
              path: p, error: null, signedUrl: "https://signed.test/" + p + "?exp=" + seconds,
            })),
            error: null,
          };
        },
        async createSignedUrl(path: string, seconds: number) {
          if (fail["storage.sign"]) return { data: null, error: fail["storage.sign"] };
          return { data: { signedUrl: "https://signed.test/" + path + "?exp=" + seconds }, error: null };
        },
      };
    },
  };

  return { tables, writes, fail, from, storage };
}
