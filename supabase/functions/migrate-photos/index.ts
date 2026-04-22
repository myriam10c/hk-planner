import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// One-shot migration : photos base64 DB → bucket Storage
// Appel : GET /functions/v1/migrate-photos?table=cleaning_photos&batch=20
// Tables supportées : cleaning_photos, cleaning_issues, maintenance_tickets (photo_data + resolution), ticket_comments, maintenance_costs

const BUCKET = "cleaning-photos";

interface TableConfig {
  table: string;
  dataCol: string;
  pathCol: string;
  idCol: string;
}

const CONFIGS: Record<string, TableConfig[]> = {
  cleaning_photos:     [{ table: "cleaning_photos",    dataCol: "photo_data",      pathCol: "photo_path",           idCol: "id" }],
  cleaning_issues:     [{ table: "cleaning_issues",    dataCol: "photo_data",      pathCol: "photo_path",           idCol: "id" }],
  maintenance_tickets: [
    { table: "maintenance_tickets", dataCol: "photo_data",      pathCol: "photo_path",           idCol: "id" },
    { table: "maintenance_tickets", dataCol: "resolution_photo",pathCol: "resolution_photo_path",idCol: "id" },
  ],
  ticket_comments:     [{ table: "ticket_comments",   dataCol: "photo_data",      pathCol: "photo_path",           idCol: "id" }],
  maintenance_costs:   [{ table: "maintenance_costs", dataCol: "receipt_photo",   pathCol: "receipt_photo_path",   idCol: "id" }],
  all:                 [], // filled below
};
CONFIGS.all = Object.values(CONFIGS).flat();

function parseDataUrl(s: string): { mime: string; bytes: Uint8Array } | null {
  // data:image/jpeg;base64,/9j/...
  const m = s.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  const mime = m[1];
  const base64 = m[2];
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mime, bytes };
}

function extFromMime(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "jpg";
}

Deno.serve(async (req: Request) => {
  try {
    const url = new URL(req.url);
    const tableArg = url.searchParams.get("table") ?? "cleaning_photos";
    const batch = Math.min(50, Number(url.searchParams.get("batch") ?? "20"));
    const dryRun = url.searchParams.get("dry") === "true";

    const cfgs = CONFIGS[tableArg];
    if (!cfgs) {
      return new Response(JSON.stringify({ error: `unknown table ${tableArg}` }), { status: 400 });
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const results: any[] = [];
    let totalMigrated = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (const cfg of cfgs) {
      const { data: rows, error } = await sb
        .from(cfg.table)
        .select(`${cfg.idCol}, ${cfg.dataCol}, ${cfg.pathCol}`)
        .is(cfg.pathCol, null)
        .not(cfg.dataCol, "is", null)
        .limit(batch);

      if (error) {
        results.push({ config: cfg, error: error.message });
        continue;
      }

      let migrated = 0, skipped = 0, errors = 0;
      for (const row of rows ?? []) {
        const id = row[cfg.idCol];
        const dataStr = row[cfg.dataCol];
        if (typeof dataStr !== "string" || !dataStr.startsWith("data:")) {
          skipped++; continue;
        }
        const parsed = parseDataUrl(dataStr);
        if (!parsed) {
          skipped++; continue;
        }
        const ext = extFromMime(parsed.mime);
        const path = `${cfg.table}/${cfg.dataCol}/${id}.${ext}`;

        if (dryRun) {
          results.push({ table: cfg.table, id, would_path: path, size_kb: (parsed.bytes.length / 1024).toFixed(1) });
          migrated++;
          continue;
        }

        const { error: upErr } = await sb.storage.from(BUCKET).upload(path, parsed.bytes, {
          contentType: parsed.mime,
          upsert: true,
        });
        if (upErr) {
          errors++;
          results.push({ table: cfg.table, id, error: upErr.message });
          continue;
        }

        // Update path + clear photo_data
        const upd: any = {};
        upd[cfg.pathCol] = path;
        upd[cfg.dataCol] = null;
        const { error: updErr } = await sb.from(cfg.table).update(upd).eq(cfg.idCol, id);
        if (updErr) {
          errors++;
          results.push({ table: cfg.table, id, uploaded: true, db_update_error: updErr.message });
          continue;
        }
        migrated++;
      }

      results.push({ table: cfg.table, column: cfg.dataCol, found: rows?.length ?? 0, migrated, skipped, errors });
      totalMigrated += migrated;
      totalSkipped += skipped;
      totalErrors += errors;
    }

    return new Response(JSON.stringify({
      success: true,
      dryRun,
      totalMigrated,
      totalSkipped,
      totalErrors,
      results,
    }, null, 2), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
