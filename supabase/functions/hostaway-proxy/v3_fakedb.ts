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
};

export function fakeDb(seed: Record<string, any[]> = {}) {
  const tables: Record<string, any[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  const writes: Array<{ table: string; op: string; values: any }> = [];
  // Erreurs a injecter, par cle "table.op" : fail["cleaning_timer.upsert"] = {...}
  const fail: Record<string, any> = {};
  let nextId = 1000;

  function from(table: string) {
    const filters: Array<{ col: string; val: any; kind: "eq" | "in" }> = [];
    let pending: { op: string; values: any } | null = null;
    const list = () => (tables[table] ??= []);
    const match = (r: any) =>
      filters.every((f) =>
        f.kind === "in"
          ? (f.val as any[]).map(String).includes(String(r[f.col]))
          : String(r[f.col]) === String(f.val)
      );
    const selected = () => list().filter(match);
    const sameUnique = (a: any, b: any) => {
      const cols = UNIQUE[table] ?? [];
      return cols.length > 0 && cols.every((c) => String(a[c]) === String(b[c]));
    };

    async function run(): Promise<{ data: any; error: any }> {
      const key = table + "." + (pending ? pending.op : "select");
      if (fail[key]) return { data: null, error: fail[key] };
      if (!pending) return { data: selected(), error: null };
      const rows = Array.isArray(pending.values) ? pending.values : [pending.values];
      if (pending.op === "insert") {
        const out: any[] = [];
        for (const v of rows) {
          if (list().some((r) => sameUnique(r, v))) {
            return { data: null, error: { code: "23505", message: "duplicate key" } };
          }
          const row = { id: nextId++, ...v };
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
      in: (col: string, val: any[]) => { filters.push({ col, val, kind: "in" }); return q; },
      order: () => q, limit: () => q, not: () => q, is: () => q,
      gte: () => q, lte: () => q, lt: () => q, gt: () => q,
      // `like` n'est pas simule : la lecture des instantanes rend toute la table,
      // ce qui suffit aux tests et rend `pickSnapshot` seul juge du choix.
      like: () => q,
      insert: (values: any) => { pending = { op: "insert", values }; return q; },
      upsert: (values: any) => { pending = { op: "upsert", values }; return q; },
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
  const storage = {
    uploads,
    removals,
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
        async createSignedUrl(path: string, seconds: number) {
          if (fail["storage.sign"]) return { data: null, error: fail["storage.sign"] };
          return { data: { signedUrl: "https://signed.test/" + path + "?exp=" + seconds }, error: null };
        },
      };
    },
  };

  return { tables, writes, fail, from, storage };
}
