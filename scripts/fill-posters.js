// Doplní chybějící plakáty z infoboxu Wikipedie (často logo seriálu) → scripts/cache/manual-posters.json
// Spuštění: node scripts/fill-posters.js && node scripts/build-catalog.js
const fs = require("fs");
const path = require("path");
global.window = {};
require("../public/catalog.js");
const UA = { "User-Agent": "trashlist-catalog/1.0 (school project; node)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FILE = path.join(__dirname, "cache", "manual-posters.json");
const manual = JSON.parse(fs.readFileSync(FILE, "utf8"));
const postersCache = JSON.parse(fs.readFileSync(path.join(__dirname, "cache", "posters.json"), "utf8"));

async function api(params) {
  for (let a = 0; a < 6; a++) {
    const res = await fetch("https://en.wikipedia.org/w/api.php", {
      method: "POST", headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ format: "json", formatversion: "2", ...params }),
    }).catch(() => null);
    if (!res || res.status === 429 || res.status >= 500) { await sleep(3000 * (a + 1)); continue; }
    return res.json();
  }
  return null;
}

(async () => {
  // wiki název titulu: z cache plakátů (klíče = wiki názvy bez obrázku)
  const missing = Object.keys(postersCache).filter((w) => !postersCache[w] && !manual[w]);
  console.log("Chybí plakát:", missing.length);
  let found = 0;
  for (let i = 0; i < missing.length; i += 20) {
    const chunk = missing.slice(i, i + 20);
    const j = await api({ action: "query", prop: "revisions", rvprop: "content", rvslots: "main", redirects: "1", titles: chunk.join("|") });
    if (!j || !j.query) continue;
    const norm = {}, redir = {}, file = {};
    (j.query.normalized || []).forEach((n) => (norm[n.from] = n.to));
    (j.query.redirects || []).forEach((r) => (redir[r.from] = r.to));
    j.query.pages.forEach((p) => {
      const text = p.revisions ? p.revisions[0].slots.main.content.slice(0, 6000) : "";
      const m = text.match(/\|\s*(?:image|logo)\s*=\s*(?:\[\[)?(?:File:|Image:)?([^|\]\n<{}]+\.(?:png|jpe?g|svg|gif|webp))/i);
      if (m) file[p.title] = m[1].trim();
    });
    const want = {};
    chunk.forEach((t) => { let k = norm[t] || t; k = redir[k] || k; if (file[k]) want[t] = "File:" + file[k]; });
    const files = [...new Set(Object.values(want))];
    if (files.length) {
      const ii = await api({ action: "query", prop: "imageinfo", iiprop: "url", iiurlwidth: "400", titles: files.join("|") });
      const url = {}, fnorm = {};
      ((ii && ii.query && ii.query.normalized) || []).forEach((n) => (fnorm[n.from] = n.to));
      ((ii && ii.query && ii.query.pages) || []).forEach((p) => { if (p.imageinfo) url[p.title] = p.imageinfo[0].thumburl || p.imageinfo[0].url; });
      Object.entries(want).forEach(([t, f]) => { const u = url[fnorm[f] || f]; if (u) { manual[t] = u; found++; } });
    }
    if ((i / 20) % 10 === 0) { fs.writeFileSync(FILE, JSON.stringify(manual, null, 1)); console.log(`  ${i + chunk.length}/${missing.length}, nalezeno ${found}`); }
    await sleep(200);
  }
  fs.writeFileSync(FILE, JSON.stringify(manual, null, 1));
  console.log("Hotovo, doplněno plakátů:", found);
})();
