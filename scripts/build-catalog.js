// Postaví velký katalog filmů a seriálů 2000–2026 z Wikidat + plakáty z Wikipedie.
// Spuštění: node scripts/build-catalog.js
//   - Wikidata: všechny filmy a seriály s článkem na en.wikipedii a aspoň N jazykovými verzemi
//   - ruční seznam scripts/catalog-src.js má přednost (české názvy, platformy)
//   - plakáty se cachují v scripts/cache/posters.json, takže další běh je rychlý
const fs = require("fs");
const path = require("path");
const curated = require("./catalog-src.js");

const YEAR_FROM = 2000, YEAR_TO = 2026;
const MIN_LINKS_FILM = 12;   // kolik jazykových verzí Wikipedie musí film mít (míra známosti)
const MIN_LINKS_SERIES = 8;
const UA = { "User-Agent": "trashlist-catalog/1.0 (school project; node)" };
const CACHE_DIR = path.join(__dirname, "cache");
fs.mkdirSync(CACHE_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (_) { return d; } };

// ---------- Wikidata ----------
const FILM_CLASSES = "wd:Q11424";
const SERIES_CLASSES = "wd:Q5398426 wd:Q1259759 wd:Q526877 wd:Q581714 wd:Q63952888 wd:Q117467246";

function query(year, kind) {
  const classes = kind === "film" ? FILM_CLASSES : SERIES_CLASSES;
  const dateProp = kind === "film" ? "wdt:P577" : "wdt:P580|wdt:P577";
  const min = kind === "film" ? MIN_LINKS_FILM : MIN_LINKS_SERIES;
  return `SELECT ?item ?sl ?enTitle ?cs ?en (GROUP_CONCAT(DISTINCT ?gl;separator="|") AS ?genres)
    (GROUP_CONCAT(DISTINCT ?nl;separator="|") AS ?nets) (SAMPLE(?nf) AS ?netflix) WHERE {
    VALUES ?cls { ${classes} }
    ?item wdt:P31 ?cls; ${dateProp} ?d; wikibase:sitelinks ?sl .
    FILTER(?sl >= ${min}) FILTER(YEAR(?d) = ${year})
    FILTER NOT EXISTS { ?item ${dateProp} ?d0 . FILTER(YEAR(?d0) < ${year}) }
    ?enA schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?enTitle .
    OPTIONAL { ?item rdfs:label ?cs FILTER(LANG(?cs) = "cs") }
    OPTIONAL { ?item rdfs:label ?en FILTER(LANG(?en) = "en") }
    OPTIONAL { ?item wdt:P136 ?g . ?g rdfs:label ?gl FILTER(LANG(?gl) = "en") }
    OPTIONAL { ?item wdt:P449|wdt:P750 ?n . ?n rdfs:label ?nl FILTER(LANG(?nl) = "en") }
    OPTIONAL { ?item wdt:P1874 ?nf }
  } GROUP BY ?item ?sl ?enTitle ?cs ?en`;
}

async function sparql(q) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch("https://query.wikidata.org/sparql", {
        method: "POST",
        headers: { ...UA, Accept: "application/sparql-results+json", "Content-Type": "application/x-www-form-urlencoded" },
        body: "query=" + encodeURIComponent(q),
      });
      if (res.status === 429 || res.status >= 500) { await sleep(5000 * (attempt + 1)); continue; }
      const j = await res.json();
      return j.results.bindings;
    } catch (e) { await sleep(5000 * (attempt + 1)); }
  }
  throw new Error("Wikidata nevrací data");
}

// ---------- mapování žánrů a platforem ----------
const GENRE_RULES = [
  [/animat|anime|cartoon|stop-motion|computer-animated/, "Animovaný"],
  [/documentar|docuseries|docudrama/, "Dokument"],
  [/superhero/, "Akce"], [/superhero/, "Sci-fi"],
  [/action|martial arts|spy|disaster/, "Akce"],
  [/comedy|sitcom|satir|parody|sketch/, "Komedie"],
  [/horror|slasher|zombie|vampire|supernatural/, "Horor"],
  [/thriller|mystery|suspense|psychological/, "Thriller"],
  [/crime|gangster|heist|detective|police|legal|noir|mafia/, "Krimi"],
  [/science fiction|sci-fi|cyberpunk|dystopi|space opera|post-apocalyptic|time travel/, "Sci-fi"],
  [/fantasy|fairy tale|sword and sorcery/, "Fantasy"],
  [/romance|romantic/, "Romantický"],
  [/adventure/, "Dobrodružný"],
  [/war film|war drama|war\b|military/, "Válečný"],
  [/historical|period|biographical|biopic|epic/, "Historický"],
  [/musical|music|dance/, "Muzikál"],
  [/western/, "Western"],
  [/family|children|teen/, "Rodinný"],
  [/drama|soap opera|telenovela/, "Drama"],
  [/sport/, "Sportovní"],
  [/reality|game show|talk show|variety/, "Reality"],
];
function mapGenres(raw) {
  const out = [];
  raw.toLowerCase().split("|").forEach((g) => GENRE_RULES.forEach(([re, cz]) => { if (re.test(g) && !out.includes(cz)) out.push(cz); }));
  return out.length ? out.slice(0, 4) : ["Ostatní"];
}
const PLATFORM_RULES = [
  [/netflix/i, "Netflix"], [/\bhbo\b|hbo max|^max$|cinemax|warner bros\. discovery/i, "HBO Max"],
  [/disney\+|disney plus|hulu|^fx|star\+|national geographic/i, "Disney+"],
  [/prime video|amazon/i, "Prime Video"], [/apple tv/i, "Apple TV+"],
  [/paramount\+|showtime|peacock|skyshowtime/i, "SkyShowtime"],
  [/česká televize|čt1|čt2|czech television/i, "iVysílání"], [/tv nova|voyo/i, "Voyo"],
];
function mapPlatform(nets, netflixId, kind) {
  const list = nets ? nets.split("|") : [];
  for (const [re, name] of PLATFORM_RULES) if (list.some((n) => re.test(n))) return name;
  if (netflixId) return "Netflix";
  if (kind === "film") return "Kino";
  return list[0] || "TV";
}
const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ---------- plakáty ----------
async function posters(titles) {
  const cacheFile = path.join(CACHE_DIR, "posters.json");
  const cache = readJson(cacheFile, {});
  const todo = titles.filter((t) => !(t in cache));
  console.log(`Plakáty: ${titles.length - todo.length} v cache, stahuji ${todo.length}…`);
  for (let i = 0; i < todo.length; i += 50) {
    const chunk = todo.slice(i, i + 50);
    const params = new URLSearchParams({
      action: "query", format: "json", formatversion: "2", redirects: "1",
      prop: "pageimages", piprop: "thumbnail", pithumbsize: "400", pilicense: "any", titles: chunk.join("|"),
    });
    let j = null;
    for (let a = 0; a < 6 && !j; a++) {
      const res = await fetch("https://en.wikipedia.org/w/api.php?" + params, { headers: UA }).catch(() => null);
      if (!res || res.status === 429 || res.status >= 500) { await sleep(3000 * (a + 1)); continue; }
      j = await res.json();
    }
    if (!j) continue;
    const norm = {}, redir = {}, img = {};
    (j.query.normalized || []).forEach((n) => (norm[n.from] = n.to));
    (j.query.redirects || []).forEach((r) => (redir[r.from] = r.to));
    j.query.pages.forEach((p) => (img[p.title] = p.thumbnail ? p.thumbnail.source : null));
    chunk.forEach((t) => { let k = norm[t] || t; k = redir[k] || k; cache[t] = img[k] || null; });
    if ((i / 50) % 20 === 0) { fs.writeFileSync(cacheFile, JSON.stringify(cache)); process.stdout.write(`  ${i + chunk.length}/${todo.length}\n`); }
    await sleep(150);
  }
  fs.writeFileSync(cacheFile, JSON.stringify(cache));
  return cache;
}

// ---------- hlavní běh ----------
(async () => {
  const wdCacheFile = path.join(CACHE_DIR, "wikidata.json");
  const wdCache = readJson(wdCacheFile, {});
  const items = new Map();
  for (let y = YEAR_FROM; y <= YEAR_TO; y++) {
    for (const kind of ["film", "serial"]) {
      const key = `${kind}-${y}-${kind === "film" ? MIN_LINKS_FILM : MIN_LINKS_SERIES}`;
      if (!wdCache[key]) {
        wdCache[key] = await sparql(query(y, kind));
        fs.writeFileSync(wdCacheFile, JSON.stringify(wdCache));
        await sleep(1000);
      }
      for (const b of wdCache[key]) {
        const qid = b.item.value.split("/").pop();
        const prev = items.get(qid);
        if (prev && prev.year <= y) continue;
        const enTitle = b.enTitle.value;
        items.set(qid, {
          id: slug(enTitle), wiki: enTitle,
          title: (b.cs && b.cs.value) || (b.en && b.en.value) || enTitle,
          orig: b.en ? b.en.value : enTitle,
          year: y, type: kind, genres: mapGenres(b.genres ? b.genres.value : ""),
          platform: mapPlatform(b.nets && b.nets.value, b.netflix, kind),
          pop: Number(b.sl.value),
        });
      }
      console.log(`${y} ${kind}: celkem ${items.size}`);
    }
  }

  // Ruční seznam má přednost
  const byWiki = new Map([...items.values()].map((t) => [t.wiki.replace(/ /g, "_"), t]));
  for (const [title, year, type, genres, platform, wiki] of curated) {
    const t = byWiki.get(wiki);
    const data = { title, year, type: type === "F" ? "film" : "serial", genres: genres.split("|"), platform };
    if (t) Object.assign(t, data, { pop: t.pop + 1000 });
    else items.set("cur-" + wiki, { id: slug(wiki), wiki: wiki.replace(/_/g, " "), orig: wiki.replace(/_/g, " ").replace(/ \(.*\)$/, ""), ...data, pop: 1000 });
  }

  const all = [...items.values()];
  // Unikátní id
  const seen = new Set();
  all.forEach((t) => { let id = t.id, n = 2; while (seen.has(id)) id = `${t.id}-${n++}`; t.id = id; seen.add(id); });

  const imgs = await posters([...new Set(all.map((t) => t.wiki))]);
  // Ručně vyhledané plakáty z předchozí verze (logo fallback) zachovat
  const manual = readJson(path.join(CACHE_DIR, "manual-posters.json"), {});
  all.forEach((t) => (t.img = manual[t.wiki] || imgs[t.wiki] || null));

  all.sort((a, b) => b.pop - a.pop);
  // Kompaktní formát: zkrácené klíče a společný prefix URL
  const PFX = "https://upload.wikimedia.org/wikipedia/";
  const rows = all.map((t) => [t.id, t.title, t.orig !== t.title ? t.orig : 0, t.year, t.type === "film" ? 0 : 1,
    t.genres.join("|"), t.platform, t.img ? (t.img.startsWith(PFX) ? t.img.slice(PFX.length) : t.img) : 0, t.pop]);
  const js = `// Vygenerováno skriptem scripts/build-catalog.js (${all.length} titulů)
window.CATALOG = (function (r) { var P = ${JSON.stringify(PFX)};
  return r.map(function (x) { return { id: x[0], title: x[1], orig: x[2] || "", year: x[3], type: x[4] ? "serial" : "film",
    genres: x[5].split("|"), platform: x[6], img: x[7] ? (x[7].indexOf("http") === 0 ? x[7] : P + x[7]) : null, pop: x[8] }; });
})(${JSON.stringify(rows)});
`;
  fs.writeFileSync(path.join(__dirname, "..", "public", "catalog.js"), js);
  const films = all.filter((t) => t.type === "film").length;
  console.log(`Hotovo: ${all.length} titulů (${films} filmů, ${all.length - films} seriálů), s plakátem: ${all.filter((t) => t.img).length}, velikost ${(js.length / 1e6).toFixed(1)} MB`);
})();
