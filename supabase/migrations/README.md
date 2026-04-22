# Supabase Migrations

Les migrations SQL appliquées durant l'audit (avril 2026).

Les fichiers sont versionnés ici pour traçabilité. Ils ont été appliqués via le MCP Supabase au moment de l'audit ; la base actuelle reflète leur état final.

Phases principales :
- `phase_0a_*` — RLS + indexes + bucket listing
- `phase_1_*` — Hash PINs + sessions + stored procs
- `phase_2_*` — Isolation tables bot_* vers schema trading
- `phase_3_*` — Bucket photos + colonnes photo_path
