// Dotáhne plakáty z Wikipedie (hromadně po 50) a zapíše public/catalog.js
// Spuštění: node scripts/build-catalog.js
const fs = require("fs");
const path = require("path");
const src = require("./catalog-src.js");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function batch(titles) {
  const params = new URLSearchParams({
    action: "query", format: "json", formatversion: "2", redirects: "1",
    prop: "pageimages", piprop: "thumbnail", pithumbsize: "500", pilicense: "any",
    titles: titles.join("|"),
  });
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch("https://en.wikipedia.org/w/api.php?" + params, {
      headers: { "User-Agent": "trashlist-catalog/1.0 (school project)" },
    });
    if (res.status === 429) { await sleep(3000 * (attempt + 1)); continue; }
    const j = await res.json();
    const map = {};
    const norm = {};
    (j.query.normalized || []).forEach((n) => (norm[n.from] = n.to));
    const redir = {};
    (j.query.redirects || []).forEach((r) => (redir[r.from] = r.to));
    const byTitle = {};
    j.query.pages.forEach((p) => (byTitle[p.title] = p.thumbnail ? p.thumbnail.source : null));
    titles.forEach((t) => {
      let k = norm[t] || t;
      k = redir[k] || k;
      map[t] = byTitle[k] || null;
    });
    return map;
  }
  throw new Error("Wikipedie pořád vrací 429");
}

async function api(params) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch("https://en.wikipedia.org/w/api.php?" + new URLSearchParams({ format: "json", formatversion: "2", ...params }), {
      headers: { "User-Agent": "trashlist-catalog/1.0 (school project)" },
    });
    if (res.status === 429) { await sleep(3000 * (attempt + 1)); continue; }
    return res.json();
  }
  return null;
}

async function infoboxImage(title) {
  const j = await api({ action: "query", prop: "revisions", rvprop: "content", rvslots: "main", rvsection: "0", redirects: "1", titles: title });
  const page = j && j.query && j.query.pages[0];
  const text = page && page.revisions ? page.revisions[0].slots.main.content : "";
  const m = text.match(/\|\s*image\s*=\s*(?:\[\[)?(?:File:|Image:)?([^|\]\n<]+\.(?:png|jpe?g|svg|gif|webp))/i);
  if (!m) return null;
  const ii = await api({ action: "query", prop: "imageinfo", iiprop: "url", iiurlwidth: "500", titles: "File:" + m[1].trim() });
  const f = ii && ii.query && ii.query.pages[0];
  return f && f.imageinfo ? f.imageinfo[0].thumburl || f.imageinfo[0].url : null;
}

(async () => {
  const wikis = src.map((r) => r[5].replace(/_/g, " "));
  const imgs = {};
  for (let i = 0; i < wikis.length; i += 50) {
    Object.assign(imgs, await batch(wikis.slice(i, i + 50)));
    await sleep(500);
  }
  // Záloha: obrázek z infoboxu (často logo seriálu v SVG)
  for (const w of wikis.filter((w) => !imgs[w])) {
    imgs[w] = await infoboxImage(w);
    await sleep(300);
  }
  const missing = [];
  const out = src.map(([title, year, type, genres, platform, wiki]) => {
    const img = imgs[wiki.replace(/_/g, " ")];
    if (!img) missing.push(`${title} (${wiki})`);
    return {
      id: wiki.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      title, year, type: type === "F" ? "film" : "serial",
      genres: genres.split("|"), platform, img,
    };
  });
  const file = path.join(__dirname, "..", "public", "catalog.js");
  fs.writeFileSync(file, "// Vygenerováno skriptem scripts/build-catalog.js\nwindow.CATALOG = " + JSON.stringify(out, null, 1) + ";\n");
  console.log(`Hotovo: ${out.length} titulů, bez plakátu: ${missing.length}`);
  missing.forEach((m) => console.log("  - " + m));
})();
