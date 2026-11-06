// Trashlist – jednoduchý server bez závislostí (Node 18+)
// Spuštění: node server.js   →   http://localhost:3000
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");
const DB_FILE = path.join(__dirname, "data", "db.json");

// ---------- databáze (JSON soubor) ----------
function emptyDb() {
  return { users: {}, reviews: [], titles: [], lists: {} };
}
let db = emptyDb();
try {
  db = { ...emptyDb(), ...JSON.parse(fs.readFileSync(DB_FILE, "utf8")) };
} catch (_) {}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    fs.writeFileSync(DB_FILE + ".tmp", JSON.stringify(db, null, 1));
    fs.renameSync(DB_FILE + ".tmp", DB_FILE);
  }, 200);
}
let version = Date.now();
function changed() {
  version = Date.now();
  save();
}

// ---------- pomocné ----------
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".ico": "image/x-icon", ".json": "application/json",
};
function send(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1e5) { reject(new Error("too big")); req.destroy(); }
    });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
  });
}
const clean = (s, max) => String(s || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
const id = () => crypto.randomBytes(6).toString("hex");

// Uživatel se identifikuje jménem + tokenem, který dostal při registraci
function auth(body) {
  const u = db.users[(body.name || "").toLowerCase()];
  if (!u || u.token !== body.token) return null;
  return u;
}

// ---------- API ----------
async function api(req, res, url) {
  const route = req.method + " " + url.pathname;

  if (route === "GET /api/state") {
    const users = Object.values(db.users).map((u) => ({ name: u.name, joined: u.joined }));
    return send(res, 200, { version, users, reviews: db.reviews, titles: db.titles, lists: db.lists });
  }
  if (route === "GET /api/version") return send(res, 200, { version });

  const body = req.method === "GET" ? {} : await readBody(req).catch(() => null);
  if (!body) return send(res, 400, { error: "Špatná data" });

  if (route === "POST /api/register") {
    const name = clean(body.name, 24);
    if (name.length < 2) return send(res, 400, { error: "Jméno musí mít aspoň 2 znaky" });
    const key = name.toLowerCase();
    const existing = db.users[key];
    if (existing) {
      // Návrat na stejném zařízení (token sedí) = přihlášení
      if (body.token && existing.token === body.token) return send(res, 200, { name: existing.name, token: existing.token });
      return send(res, 409, { error: "Tohle jméno už někdo má, zkus jiné" });
    }
    db.users[key] = { name, token: crypto.randomBytes(16).toString("hex"), joined: Date.now() };
    changed();
    return send(res, 200, { name, token: db.users[key].token });
  }

  const user = auth(body);
  if (!user) return send(res, 401, { error: "Nejdřív se zaregistruj" });

  if (route === "POST /api/review") {
    const poops = Math.round(Number(body.poops));
    if (!(poops >= 1 && poops <= 5)) return send(res, 400, { error: "Vyber 1–5 hovínek" });
    const titleId = clean(body.titleId, 120);
    const text = clean(body.text, 1000);
    // Jeden uživatel = jedno hodnocení na titul (přepíše se)
    let r = db.reviews.find((x) => x.titleId === titleId && x.user === user.name);
    if (r) Object.assign(r, { poops, text, ts: Date.now() });
    else db.reviews.push((r = { id: id(), titleId, user: user.name, poops, text, ts: Date.now(), likes: [] }));
    changed();
    return send(res, 200, r);
  }

  if (route === "POST /api/review/delete") {
    const before = db.reviews.length;
    db.reviews = db.reviews.filter((r) => !(r.id === body.id && r.user === user.name));
    if (db.reviews.length === before) return send(res, 404, { error: "Nenalezeno" });
    changed();
    return send(res, 200, { ok: true });
  }

  if (route === "POST /api/review/like") {
    const r = db.reviews.find((x) => x.id === body.id);
    if (!r) return send(res, 404, { error: "Nenalezeno" });
    r.likes = r.likes || [];
    const i = r.likes.indexOf(user.name);
    if (i >= 0) r.likes.splice(i, 1); else r.likes.push(user.name);
    changed();
    return send(res, 200, r);
  }

  if (route === "POST /api/title") {
    const title = clean(body.title, 120);
    const year = Number(body.year);
    if (title.length < 1) return send(res, 400, { error: "Chybí název" });
    if (!(year >= 1900 && year <= 2030)) return send(res, 400, { error: "Rok vypadá divně" });
    const img = clean(body.img, 500);
    const t = {
      id: "u-" + id(), title, year, type: body.type === "serial" ? "serial" : "film",
      genres: (Array.isArray(body.genres) ? body.genres : []).map((g) => clean(g, 30)).filter(Boolean).slice(0, 5),
      platform: clean(body.platform, 30) || "Jinde",
      img: /^https?:\/\//.test(img) ? img : null,
      addedBy: user.name, ts: Date.now(),
    };
    db.titles.push(t);
    changed();
    return send(res, 200, t);
  }

  if (route === "POST /api/list") {
    // stav: "want" (chci vidět), "seen" (viděno), nebo null (odebrat)
    const titleId = clean(body.titleId, 120);
    const list = (db.lists[user.name] = db.lists[user.name] || {});
    if (body.status === "want" || body.status === "seen") list[titleId] = { status: body.status, ts: Date.now() };
    else delete list[titleId];
    changed();
    return send(res, 200, { ok: true });
  }

  send(res, 404, { error: "Neznámá cesta" });
}

// ---------- statické soubory ----------
function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === "/") p = "/index.html";
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("404"); }
    const headers = { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" };
    // Katalog má několik MB → posílat zkomprimovaně
    if (/\.(js|css|html|json)$/.test(file) && /gzip/.test(req.headers["accept-encoding"] || "")) {
      headers["Content-Encoding"] = "gzip";
      data = zlib.gzipSync(data);
    }
    res.writeHead(200, headers);
    res.end(data);
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith("/api/")) {
    api(req, res, url).catch((e) => { console.error(e); send(res, 500, { error: "Chyba serveru" }); });
  } else serveStatic(req, res, url);
}).listen(PORT, () => console.log(`💩 Trashlist běží na http://localhost:${PORT}`));
