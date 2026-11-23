import type { Page } from '@playwright/test';

// Mesures de lisibilite d'une page, portees de pageMetrics (outil de capture de
// l'audit du 19/11/2026, outil/capture-server.cjs). Seuils de l'outil : cible
// sous 43,5 px, texte sous 14 px, contraste sous 4,5 (3 pour un grand texte :
// 24 px, ou 18,66 px en gras). Seuls les champs ci-dessous sont rendus.
export type LookMetrics = {
  overflowX: number;
  smallTargets: number;
  smallTop: string[];
  pctUnder14: number;
  tinyTop: string[];
  pctLowContrast: number;
  lowTop: string[];
};

// Execute dans la page (page.evaluate) : aucune reference hors de la fonction.
function pageMetrics(): LookMetrics {
  const vw = innerWidth, de = document.documentElement;
  const visible = (el: Element) => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && el.getBoundingClientRect().width > 0;
  const label = (el: any) => (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 32);
  const sel = (el: Element) => el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  const inter = [...document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=tab],summary')].filter(visible);
  const small = inter.map((el) => ({ el, r: el.getBoundingClientRect() })).filter((o) => Math.min(o.r.width, o.r.height) < 43.5);
  const smallAgg: Record<string, { n: number; ex: string; r?: number }> = {};
  for (const o of small) { const k = sel(o.el) + ' ' + Math.round(o.r.width) + 'x' + Math.round(o.r.height); (smallAgg[k] = smallAgg[k] || { n: 0, ex: label(o.el) }).n++; }
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true })!; const cache: Record<string, number[]> = {};
  const rgba = (c: string) => { if (cache[c]) return cache[c]; cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; const a = d[3] / 255; return (cache[c] = a ? [d[0], d[1], d[2], a] : [0, 0, 0, 0]); };
  const lum = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const over = (top: number[], bot: number[]) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1]; };
  const bgOf = (el: Element) => { const layers: number[][] = []; let img = false; for (let n: Element | null = el; n && n.nodeType === 1; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.backgroundImage && cs.backgroundImage !== 'none') img = true; const c = rgba(cs.backgroundColor); if (c[3] > 0) { layers.push(c); if (c[3] >= 0.99) break; } } let base = [255, 255, 255, 1]; for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base); return { c: base, img }; };
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let chars = 0, c14 = 0, cLow = 0; const low: Record<string, { n: number; ex: string; r?: number }> = {}, tiny: Record<string, { n: number; ex: string; r?: number }> = {};
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const t = (n.nodeValue || '').trim(); if (t.length < 2) continue; const p = n.parentElement; if (!p || !visible(p) || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(p.tagName)) continue;
    const cs = getComputedStyle(p); const fs = parseFloat(cs.fontSize); chars += t.length;
    if (fs < 14) { c14 += t.length; const k = sel(p) + ' ' + fs + 'px'; (tiny[k] = tiny[k] || { n: 0, ex: t.slice(0, 28) }).n += t.length; }
    if (p.closest('[disabled],[aria-disabled="true"]')) continue;
    const bg = bgOf(p); if (bg.img) continue; const fg = over(rgba(cs.color), bg.c); const l1 = lum(fg), l2 = lum(bg.c); const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const big = fs >= 24 || (fs >= 18.66 && parseInt(cs.fontWeight, 10) >= 700);
    if (ratio < (big ? 3 : 4.5)) { cLow += t.length; const k = sel(p) + ' ' + cs.color + ' on ' + bg.c.slice(0, 3).map(Math.round).join(','); const o = (low[k] = low[k] || { n: 0, ex: t.slice(0, 28), r: Math.round(ratio * 100) / 100 }); o.n += t.length; }
  }
  const top = (o: Record<string, { n: number; ex: string; r?: number }>, n: number) => Object.entries(o).sort((a, b) => b[1].n - a[1].n).slice(0, n).map(([key, v]) => key + ' ×' + v.n + ' «' + v.ex + '»' + (v.r ? ' ratio ' + v.r : ''));
  return {
    overflowX: de.scrollWidth - vw,
    smallTargets: small.length, smallTop: top(smallAgg, 8),
    pctUnder14: chars ? Math.round((c14 / chars) * 100) : 0, tinyTop: top(tiny, 6),
    pctLowContrast: chars ? Math.round((cLow / chars) * 100) : 0, lowTop: top(low, 8),
  };
}

export async function lookMetrics(page: Page): Promise<LookMetrics> {
  return await page.evaluate(pageMetrics);
}
