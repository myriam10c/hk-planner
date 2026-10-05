// Partage natif du téléphone. Le texte est aussi copié : WhatsApp ignore parfois le texte quand il y a des fichiers.
// Les fichiers sont filtrés un par un (un seul fichier refusé ne fait plus tomber tout le partage).
// textOnly : après un échec du partage avec fichiers, le prochain appui partage le texte seul.
export async function shareReport({ text, files = [], textOnly = false, nav = globalThis.navigator }) {
  // Ne pas await la copie clipboard avant share : sur iOS Safari, une async attendue peut consommer l'activation utilisateur transiente.
  try { const p = nav.clipboard && nav.clipboard.writeText(text); if (p && p.catch) p.catch(() => {}); } catch (e) { /* copie facultative */ }
  if (!nav || !nav.share) return { ok: false, mode: "none" };
  const can = typeof nav.canShare === "function" ? d => { try { return !!nav.canShare(d); } catch (e) { return false; } } : () => false;
  const shareable = textOnly ? [] : files.filter(f => can({ files: [f] }));
  const withFiles = shareable.length > 0 && can({ files: shareable });
  const mode = withFiles ? "files" : "text";
  try {
    await nav.share(withFiles ? { text, files: shareable } : { text });
    return withFiles ? { ok: true, mode, count: shareable.length } : { ok: true, mode };
  } catch (e) {
    if (e && e.name === "AbortError") return { ok: false, mode, aborted: true };
    return { ok: false, mode, error: e && e.message ? e.message : String(e) };
  }
}
