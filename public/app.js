/* Trashlist – frontend (čistý JS, bez knihoven) */
(() => {
  "use strict";

  // ---------- stav ----------
  const S = {
    me: JSON.parse(localStorage.getItem("trashlist-me") || "null"), // {name, token}
    server: { version: 0, users: [], reviews: [], titles: [], lists: {} },
    filters: { type: "all", genre: "all", platform: "all", decade: "all", q: "", sort: "new" },
  };
  const POOP_LABELS = ["", "Totální odpad", "Slabota", "Ujde to", "Dobrý", "Pecka"];
  const GENRE_ORDER = ["Akce", "Komedie", "Drama", "Krimi", "Thriller", "Horor", "Sci-fi", "Fantasy", "Animovaný", "Romantický", "Dobrodružný", "Historický", "Válečný", "Dokument", "Muzikál", "Western", "Rodinný", "Sportovní", "Reality", "Ostatní"];
  const MAIN_PLATFORMS = ["Netflix", "HBO Max", "Disney+", "Prime Video", "Apple TV+", "SkyShowtime", "Voyo", "iVysílání", "Kino"];
  const PAGE = 60;
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  const $ = (s, el = document) => el.querySelector(s);
  const app = $("#app");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- data ----------
  // Katalog má desítky tisíc titulů → indexy pro rychlost
  window.CATALOG.forEach((t) => (t._s = norm(t.title + " " + (t.orig || ""))));
  let ALL = window.CATALOG, BY_ID = new Map(), STATS = new Map();
  function reindex() {
    S.server.titles.forEach((t) => { t._s = norm(t.title); t.pop = t.pop || 500; });
    ALL = [...S.server.titles, ...window.CATALOG];
    BY_ID = new Map(ALL.map((t) => [t.id, t]));
    STATS = new Map();
    S.server.reviews.forEach((r) => {
      const s = STATS.get(r.titleId) || { sum: 0, n: 0 };
      s.sum += r.poops; s.n++; STATS.set(r.titleId, s);
    });
    STATS.forEach((s) => (s.avg = s.sum / s.n));
  }
  reindex();
  const allTitles = () => ALL;
  const popular = (n) => ALL.slice(0, n); // CATALOG je seřazený podle známosti
  const byId = (id) => BY_ID.get(id);
  const reviewsOf = (id) => S.server.reviews.filter((r) => r.titleId === id).sort((a, b) => b.ts - a.ts);
  const stats = (id) => STATS.get(id) || { avg: 0, n: 0 };
  const myList = () => (S.me && S.server.lists[S.me.name]) || {};

  // ---------- ukládání: Supabase (sdílené online) / lokální server / jen prohlížeč ----------
  const CFG = window.TRASHLIST_CONFIG || {};
  let MODE = CFG.supabaseUrl && CFG.supabaseKey ? "supabase" : "server"; // "local" se zjistí při startu

  async function apiServer(path, body) {
    const opts = body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" };
    const res = await fetch(path, opts);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || "Něco se pokazilo");
    return j;
  }

  async function rpc(fn, args = {}) {
    const res = await fetch(CFG.supabaseUrl.replace(/\/$/, "") + "/rest/v1/rpc/" + fn, {
      method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json", apikey: CFG.supabaseKey, Authorization: "Bearer " + CFG.supabaseKey },
      body: JSON.stringify(args),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok) throw new Error((j && j.message) || "Databáze neodpovídá");
    return j;
  }
  function apiSupabase(path, b) {
    const auth = { p_name: b && b.name, p_token: b && b.token };
    switch (path) {
      case "/api/state": return rpc("tl_state");
      case "/api/version": return rpc("tl_version").then((version) => ({ version }));
      case "/api/register": return rpc("tl_register", { p_name: b.name, p_token: b.token || null });
      case "/api/review": return rpc("tl_review", { ...auth, p_title_id: b.titleId, p_poops: b.poops, p_text: b.text || "" });
      case "/api/review/delete": return rpc("tl_review_delete", { ...auth, p_id: b.id });
      case "/api/review/like": return rpc("tl_review_like", { ...auth, p_id: b.id });
      case "/api/title": return rpc("tl_title_add", { ...auth, p_data: b });
      case "/api/list": return rpc("tl_list", { ...auth, p_title_id: b.titleId, p_status: b.status || null });
    }
  }

  // Bez serveru (např. GitHub Pages bez databáze) – vše jen v tomto prohlížeči
  function apiLocal(path, b) {
    const db = JSON.parse(localStorage.getItem("trashlist-local-db") || '{"users":[],"reviews":[],"titles":[],"lists":{},"version":1}');
    const save = () => { db.version = Date.now(); localStorage.setItem("trashlist-local-db", JSON.stringify(db)); };
    const rid = () => Math.random().toString(16).slice(2, 14);
    if (path === "/api/state") return Promise.resolve(db);
    if (path === "/api/version") return Promise.resolve({ version: db.version });
    if (path === "/api/register") {
      const name = String(b.name || "").trim().slice(0, 24);
      if (name.length < 2) return Promise.reject(new Error("Jméno musí mít aspoň 2 znaky"));
      if (!db.users.some((u) => u.name.toLowerCase() === name.toLowerCase())) db.users.push({ name, joined: Date.now() });
      save(); return Promise.resolve({ name, token: "local" });
    }
    const user = b.name;
    if (path === "/api/review") {
      let r = db.reviews.find((x) => x.titleId === b.titleId && x.user === user);
      if (r) Object.assign(r, { poops: b.poops, text: b.text, ts: Date.now() });
      else db.reviews.push((r = { id: rid(), titleId: b.titleId, user, poops: b.poops, text: b.text || "", ts: Date.now(), likes: [] }));
      save(); return Promise.resolve(r);
    }
    if (path === "/api/review/delete") { db.reviews = db.reviews.filter((r) => !(r.id === b.id && r.user === user)); save(); return Promise.resolve({}); }
    if (path === "/api/review/like") {
      const r = db.reviews.find((x) => x.id === b.id);
      if (r) { const i = r.likes.indexOf(user); i >= 0 ? r.likes.splice(i, 1) : r.likes.push(user); }
      save(); return Promise.resolve({});
    }
    if (path === "/api/title") {
      if (!String(b.title || "").trim()) return Promise.reject(new Error("Chybí název"));
      const t = { id: "u-" + rid(), title: b.title.trim(), year: +b.year, type: b.type, genres: b.genres, platform: b.platform,
        img: /^https?:\/\//.test(b.img || "") ? b.img : null, addedBy: user, ts: Date.now() };
      db.titles.push(t); save(); return Promise.resolve(t);
    }
    if (path === "/api/list") {
      const l = (db.lists[user] = db.lists[user] || {});
      if (b.status) l[b.titleId] = { status: b.status, ts: Date.now() }; else delete l[b.titleId];
      save(); return Promise.resolve({});
    }
  }

  async function api(path, body) {
    const b = body ? { ...body, ...(S.me || {}) } : null;
    if (MODE === "supabase") return apiSupabase(path, b || {});
    if (MODE === "local") return apiLocal(path, b || {});
    return apiServer(path, b);
  }
  async function detectMode() {
    if (MODE === "supabase") return;
    try { await apiServer("/api/version"); MODE = "server"; } catch (_) { MODE = "local"; }
  }
  async function refresh() {
    try {
      S.server = await api("/api/state");
      reindex();
      // Pokud mě server nezná (smazaná DB), odhlásit
      if (S.me && !S.server.users.some((u) => u.name === S.me.name)) logout(true);
    } catch (e) { console.warn(e); }
  }
  // Živé aktualizace – kontrola verze každých 5 s
  setInterval(async () => {
    try {
      const { version } = await api("/api/version");
      if (version !== S.server.version) {
        await refresh();
        renderTicker();
        if (!$("#modal").hidden && $("#modal").dataset.title) { /* detail je otevřený – překreslit jen komentáře */ renderDetailReviews($("#modal").dataset.title); }
        else if (!document.activeElement || !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) route(true);
      }
    } catch (_) {}
  }, 5000);

  // ---------- pomocné UI ----------
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(t._t); t._t = setTimeout(() => (t.hidden = true), 2600);
  }
  const COLORS = ["#7a4a22", "#c8442a", "#2f5d50", "#3c4a7a", "#8a6d1c", "#6b2d5c", "#1f1f1f", "#a35a2a"];
  const colorOf = (s) => COLORS[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
  const avatar = (name) => `<span class="avatar" style="background:${colorOf(name)}">${esc(name[0].toUpperCase())}</span>`;
  function ago(ts) {
    const s = (Date.now() - ts) / 1000;
    if (s < 60) return "právě teď";
    if (s < 3600) return `před ${Math.floor(s / 60)} min`;
    if (s < 86400) return `před ${Math.floor(s / 3600)} h`;
    if (s < 86400 * 7) return `před ${Math.floor(s / 86400)} d`;
    return new Date(ts).toLocaleDateString("cs-CZ");
  }
  const poopStr = (n) => "💩".repeat(Math.round(n)) + `<span class="p-off">${"💩".repeat(5 - Math.round(n))}</span>`;
  const typeLabel = (t) => (t.type === "serial" ? "Seriál" : "Film");

  function posterImg(t, cls = "") {
    if (!t.img) return `<div class="fallback" style="background:${colorOf(t.title)}">${esc(t.title)}</div>`;
    return `<img src="${esc(t.img)}" alt="${esc(t.title)}" loading="lazy" class="${cls}" onload="if(this.naturalWidth>this.naturalHeight*1.05)this.classList.add('logo-img')" onerror="this.outerHTML='<div class=&quot;fallback&quot; style=&quot;background:${colorOf(t.title)}&quot;>${esc(esc(t.title))}</div>'">`;
  }

  function card(t, opts = {}) {
    const st = stats(t.id);
    const inList = myList()[t.id];
    return `<div class="card" data-open="${esc(t.id)}">
      <div class="poster">${posterImg(t)}
        <span class="badge">${typeLabel(t)} · ${t.year}</span>
        ${inList ? `<span class="badge right">${inList.status === "seen" ? "Viděno" : "Chci"}</span>` : opts.rank ? `<span class="badge right">#${opts.rank}</span>` : ""}
      </div>
      <div class="card-title">${esc(t.title)}</div>
      <div class="card-meta"><span>${esc(t.genres.slice(0, 2).join(", "))}</span>
        <span class="mini-poops">${st.n ? `💩 ${st.avg.toFixed(1)} (${st.n})` : esc(t.platform)}</span></div>
    </div>`;
  }

  // ---------- ticker (aktivita nahoře) ----------
  function renderTicker() {
    const items = [...S.server.reviews].sort((a, b) => b.ts - a.ts).slice(0, 15).map((r) => {
      const t = byId(r.titleId);
      return `<span>💩 ${esc(r.user)} dal ${esc(t ? t.title : "?")} ${r.poops}/5 — „${esc((r.text || POOP_LABELS[r.poops]).slice(0, 60))}“</span>`;
    });
    const base = [
      "<span>★ Žádné hvězdičky. Jen hovínka. ★</span>",
      `<span>${allTitles().length} filmů a seriálů od roku 2000</span>`,
      "<span>Registrace jen jménem — zabere to 3 vteřiny</span>",
    ];
    $("#ticker").innerHTML = (items.length ? items : base).concat(items.length ? base : []).join("");
  }

  // ---------- stránky ----------
  function viewHome() {
    const titles = allTitles();
    const withImg = popular(400).filter((t) => t.img);
    const collage = [...withImg].sort(() => Math.random() - 0.5).slice(0, 40);
    const fresh = titles.filter((t) => t.year >= 2025 && t.img).slice(0, 24).sort((a, b) => b.year - a.year);
    const freshSeries = titles.filter((t) => t.year >= 2023 && t.type === "serial" && t.img).slice(0, 20);
    const rated = titles.map((t) => ({ t, ...stats(t.id) })).filter((x) => x.n);
    const top = [...rated].sort((a, b) => b.avg - a.avg || b.n - a.n).slice(0, 12);
    const trash = [...rated].sort((a, b) => a.avg - b.avg || b.n - a.n).slice(0, 12);
    const recent = [...S.server.reviews].sort((a, b) => b.ts - a.ts).slice(0, 6);
    const userAdded = [...S.server.titles].sort((a, b) => b.ts - a.ts).slice(0, 12);
    const bannerImgs = [...withImg].sort(() => Math.random() - 0.5).slice(0, 6);

    app.innerHTML = `
      <section class="hero">
        <div class="hero-collage">${collage.map((t) => `<div class="pc"><img src="${esc(t.img)}" alt="" loading="lazy"></div>`).join("")}</div>
        <div class="hero-inner">
          <div class="eyebrow" style="color:#e9e2d4">${titles.length.toLocaleString("cs-CZ")} filmů & seriálů 2000 — 2026 · Netflix · HBO Max · Disney+ · Prime · Apple TV+ · SkyShowtime · Voyo · kino</div>
          <h1 class="hero-title">Trashlist</h1>
          <div class="hero-bottom">
            <div class="hero-text">Hodnoť filmy a seriály hovínky. Jedno 💩 = totální odpad, pět 💩 = pecka. Piš komentáře a koukej, co vidí ostatní.</div>
            <div class="hero-cta">
              <a class="btn light" href="#/katalog">Procházet katalog</a>
              <button class="btn" style="color:#f4efe6" data-action="random">🎲 Co dneska?</button>
            </div>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="section-head"><h2 class="big">Novinky</h2><a class="more" href="#/katalog?sort=new">Zobrazit vše</a></div>
        <div class="row">${fresh.map((t) => card(t)).join("")}</div>
      </section>

      <section class="section">
        <div class="section-head"><h2 class="mid">Seriály, o kterých se mluví</h2><a class="more" href="#/katalog?type=serial">Všechny seriály</a></div>
        <div class="row">${freshSeries.map((t) => card(t)).join("")}</div>
      </section>

      <section class="section">
        <div class="section-head"><h2 class="big">Čerstvé hovínka</h2><a class="more" href="#/lide">Všichni lidi</a></div>
        ${recent.length ? `<div class="feed">${recent.map(commentHtml).join("")}</div>` : `<div class="empty">Zatím nikdo nic nehodnotil. Buď první, kdo nadělí 💩.</div>`}
      </section>

      <section class="banner">
        <div class="banner-text">
          <div class="eyebrow" style="color:#bdb5a6">Komunitní žebříček</div>
          <h2 class="big">Největší<br>trash</h2>
          <div><a class="btn light" href="#/zebricky">Otevřít žebříčky</a></div>
        </div>
        <div class="banner-imgs">${bannerImgs.map((t) => `<img src="${esc(t.img)}" alt="" loading="lazy">`).join("")}</div>
      </section>

      ${trash.length ? `<section class="section"><div class="section-head"><h2 class="mid">Nejhůř hodnocené</h2><a class="more" href="#/zebricky">Celý žebříček</a></div>
        <div class="row">${trash.map((x, i) => card(x.t, { rank: i + 1 })).join("")}</div></section>` : ""}
      ${top.length ? `<section class="section"><div class="section-head"><h2 class="mid">Komunitní pecky</h2></div>
        <div class="row">${top.map((x, i) => card(x.t, { rank: i + 1 })).join("")}</div></section>` : ""}
      ${userAdded.length ? `<section class="section"><div class="section-head"><h2 class="mid">Přidali lidi</h2></div>
        <div class="row">${userAdded.map((t) => card(t)).join("")}</div></section>` : ""}

      <section class="section">
        <div class="section-head"><h2 class="big">Kolekce</h2><span class="eyebrow">Podle žánrů</span></div>
        <div class="genres">${genreTiles()}</div>
      </section>`;
  }

  function genreTiles() {
    const titles = allTitles();
    return GENRE_ORDER.map((g) => {
      const list = titles.filter((t) => t.genres.includes(g));
      if (!list.length) return "";
      const imgs = list.filter((t) => t.img).slice(0, 3);
      return `<a class="genre-tile" href="#/katalog?genre=${encodeURIComponent(g)}">
        <div class="gimgs">${imgs.map((t) => `<img src="${esc(t.img)}" alt="" loading="lazy">`).join("")}</div>
        <small>${list.length.toLocaleString("cs-CZ")} titulů</small><span>${esc(g)}</span></a>`;
    }).join("");
  }

  function viewCatalog(params) {
    const f = S.filters;
    ["type", "genre", "platform", "decade", "sort"].forEach((k) => { if (params.has(k)) f[k] = params.get(k); });
    if (params.has("q")) f.q = params.get("q");
    if (!params.toString()) Object.assign(f, { type: "all", genre: "all", platform: "all", decade: "all", q: "", sort: "pop" });
    else if (!params.has("sort")) f.sort = "pop";

    const titles = allTitles();
    const platforms = MAIN_PLATFORMS;
    const genres = GENRE_ORDER.filter((g) => titles.some((t) => t.genres.includes(g)));
    const heading = f.type === "film" ? "Filmy" : f.type === "serial" ? "Seriály" : f.genre !== "all" ? f.genre : "Katalog";

    app.innerHTML = `
      <section class="section">
        <div class="section-head"><h1 class="big">${esc(heading)}</h1><span class="eyebrow">2000 — 2026</span></div>
        <div class="filters">
          <input class="input" id="f-q" placeholder="Hledat název…" value="${esc(f.q)}" style="min-width:220px">
          <select class="input" id="f-type">
            <option value="all">Filmy i seriály</option><option value="film">Jen filmy</option><option value="serial">Jen seriály</option>
          </select>
          <select class="input" id="f-platform"><option value="all">Všechny platformy</option>${platforms.map((p) => `<option>${esc(p)}</option>`).join("")}<option value="tv">Ostatní TV stanice</option></select>
          <select class="input" id="f-decade">
            <option value="all">Všechny roky</option><option value="2000">2000–2009</option><option value="2010">2010–2019</option><option value="2020">2020–2026</option>
            ${Array.from({ length: 27 }, (_, i) => 2026 - i).map((y) => `<option value="y${y}">${y}</option>`).join("")}
          </select>
          <select class="input" id="f-sort">
            <option value="pop">Nejznámější</option><option value="new">Nejnovější</option><option value="old">Nejstarší</option><option value="az">A–Z</option>
            <option value="best">Nejvíc hovínek (nejlepší)</option><option value="worst">Nejmíň hovínek (trash)</option><option value="most">Nejvíc hodnocení</option>
          </select>
          <span class="count" id="f-count"></span>
        </div>
        <div class="chips" id="f-genres">
          <button class="chip ${f.genre === "all" ? "on" : ""}" data-genre="all">Vše</button>
          ${genres.map((g) => `<button class="chip ${f.genre === g ? "on" : ""}" data-genre="${esc(g)}">${esc(g)}</button>`).join("")}
        </div>
        <div class="grid" id="f-grid"></div>
        <div style="text-align:center;margin-top:34px"><button class="btn solid" id="f-more" hidden>Načíst další</button></div>
      </section>`;
    $("#f-type").value = f.type; $("#f-platform").value = f.platform; $("#f-decade").value = f.decade; $("#f-sort").value = f.sort;

    let list = [], shown = 0;
    const more = () => {
      $("#f-grid").insertAdjacentHTML("beforeend", list.slice(shown, shown + PAGE).map((t) => card(t)).join(""));
      shown += PAGE;
      $("#f-more").hidden = shown >= list.length;
      $("#f-more").textContent = `Načíst další (zbývá ${(list.length - shown).toLocaleString("cs-CZ")})`;
    };
    const decadeOk = (t) => f.decade === "all" ? true : f.decade[0] === "y" ? t.year === +f.decade.slice(1)
      : t.year >= +f.decade && t.year <= +f.decade + (f.decade === "2020" ? 6 : 9);
    const draw = () => {
      const q = norm(f.q.trim());
      list = titles.filter((t) =>
        (f.type === "all" || t.type === f.type) &&
        (f.genre === "all" || t.genres.includes(f.genre)) &&
        (f.platform === "all" || (f.platform === "tv" ? !MAIN_PLATFORMS.includes(t.platform) : t.platform === f.platform)) &&
        decadeOk(t) && (!q || t._s.includes(q)));
      const sorters = {
        pop: (a, b) => b.pop - a.pop,
        new: (a, b) => b.year - a.year || b.pop - a.pop,
        old: (a, b) => a.year - b.year || b.pop - a.pop,
        az: (a, b) => a.title.localeCompare(b.title, "cs"),
        best: (a, b) => stats(b.id).avg - stats(a.id).avg || stats(b.id).n - stats(a.id).n || b.pop - a.pop,
        worst: (a, b) => (stats(a.id).n ? stats(a.id).avg : 9) - (stats(b.id).n ? stats(b.id).avg : 9) || b.pop - a.pop,
        most: (a, b) => stats(b.id).n - stats(a.id).n || b.pop - a.pop,
      };
      list.sort(sorters[f.sort] || sorters.pop);
      $("#f-count").textContent = `${list.length.toLocaleString("cs-CZ")} titulů`;
      shown = 0;
      $("#f-grid").innerHTML = list.length ? ""
        : `<div class="empty" style="grid-column:1/-1"><div class="big">Nic</div>Nic takového tu není. <a class="more" href="#" data-action="add">Přidej to!</a></div>`;
      more();
    };
    $("#f-more").addEventListener("click", more);
    let qTimer;
    $("#f-q").addEventListener("input", (e) => { f.q = e.target.value; clearTimeout(qTimer); qTimer = setTimeout(draw, 150); });
    [["#f-type", "type"], ["#f-platform", "platform"], ["#f-decade", "decade"], ["#f-sort", "sort"]].forEach(([sel, k]) =>
      $(sel).addEventListener("change", (e) => { f[k] = e.target.value; draw(); }));
    $("#f-genres").addEventListener("click", (e) => {
      const b = e.target.closest("[data-genre]"); if (!b) return;
      f.genre = b.dataset.genre;
      $("#f-genres").querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c === b));
      draw();
    });
    draw();
  }

  function viewRankings(params) {
    const tab = params.get("tab") || "trash";
    const rated = allTitles().map((t) => ({ t, ...stats(t.id) })).filter((x) => x.n);
    const sorted = {
      trash: [...rated].sort((a, b) => a.avg - b.avg || b.n - a.n),
      top: [...rated].sort((a, b) => b.avg - a.avg || b.n - a.n),
      most: [...rated].sort((a, b) => b.n - a.n),
    }[tab] || [];
    app.innerHTML = `<section class="section">
      <div class="section-head"><h1 class="big">Žebříčky</h1></div>
      <div class="tabs">
        <a class="chip ${tab === "trash" ? "on" : ""}" href="#/zebricky?tab=trash">💩 Největší trash</a>
        <a class="chip ${tab === "top" ? "on" : ""}" href="#/zebricky?tab=top">Pecky</a>
        <a class="chip ${tab === "most" ? "on" : ""}" href="#/zebricky?tab=most">Nejprobíranější</a>
      </div>
      ${sorted.length ? `<div class="rank">${sorted.slice(0, 50).map((x, i) => `
        <div class="rank-item" data-open="${esc(x.t.id)}">
          <span class="n">${String(i + 1).padStart(2, "0")}</span>
          <div class="thumb">${x.t.img ? `<img src="${esc(x.t.img)}" alt="" loading="lazy">` : ""}</div>
          <div><b>${esc(x.t.title)}</b><div class="eyebrow">${typeLabel(x.t)} · ${x.t.year} · ${esc(x.t.genres.join(", "))}</div></div>
          <div style="text-align:right">${poopStr(x.avg)}<div class="eyebrow">${x.avg.toFixed(1)} · ${x.n}× hodnoceno</div></div>
        </div>`).join("")}</div>` : `<div class="empty"><div class="big">Prázdno</div>Až lidi začnou hodnotit, objeví se tu žebříček.</div>`}
    </section>`;
  }

  function viewPeople(params) {
    const who = params.get("u");
    if (who) return viewPerson(who);
    const users = [...S.server.users].map((u) => ({ ...u, n: S.server.reviews.filter((r) => r.user === u.name).length }))
      .sort((a, b) => b.n - a.n);
    app.innerHTML = `<section class="section">
      <div class="section-head"><h1 class="big">Lidi</h1><span class="eyebrow">${users.length} registrovaných</span></div>
      ${users.length ? `<div class="people">${users.map((u) => `
        <a class="person" href="#/lide?u=${encodeURIComponent(u.name)}">${avatar(u.name)}
          <div><b>${esc(u.name)}</b><small>${u.n} hodnocení · od ${new Date(u.joined).toLocaleDateString("cs-CZ")}</small></div></a>`).join("")}</div>`
        : `<div class="empty">Zatím tu nikdo není. <button class="btn solid" data-action="login">Zaregistruj se</button></div>`}
    </section>`;
  }

  function viewPerson(name) {
    const rs = S.server.reviews.filter((r) => r.user === name).sort((a, b) => b.ts - a.ts);
    const list = S.server.lists[name] || {};
    const want = Object.keys(list).filter((k) => list[k].status === "want").map(byId).filter(Boolean);
    const avg = rs.length ? rs.reduce((s, r) => s + r.poops, 0) / rs.length : 0;
    app.innerHTML = `<section class="section">
      <a class="more" href="#/lide">← Všichni lidi</a>
      <div class="section-head" style="margin-top:20px"><h1 class="big">${esc(name)}</h1>
        <span class="eyebrow">${rs.length} hodnocení${rs.length ? ` · průměr ${avg.toFixed(1)} 💩 · ${avg < 2.5 ? "přísný kritik" : avg > 3.8 ? "líbí se mu všechno" : "vyvážený divák"}` : ""}</span></div>
      ${rs.length ? `<div class="feed">${rs.map(commentHtml).join("")}</div>` : `<div class="empty">Ještě nic nehodnotil.</div>`}
      ${want.length ? `<div class="section-head" style="margin-top:50px"><h2 class="mid">Chce vidět</h2></div><div class="row">${want.map((t) => card(t)).join("")}</div>` : ""}
    </section>`;
  }

  function viewMine() {
    if (!S.me) {
      app.innerHTML = `<section class="section"><div class="empty"><div class="big">Můj list</div><p>Nejdřív se zaregistruj – stačí jméno.</p><button class="btn solid" data-action="login">Registrace</button></div></section>`;
      return;
    }
    const list = myList();
    const ids = Object.keys(list).sort((a, b) => list[b].ts - list[a].ts);
    const want = ids.filter((k) => list[k].status === "want").map(byId).filter(Boolean);
    const seen = ids.filter((k) => list[k].status === "seen").map(byId).filter(Boolean);
    const mine = S.server.reviews.filter((r) => r.user === S.me.name).sort((a, b) => b.ts - a.ts);
    app.innerHTML = `<section class="section">
      <div class="section-head"><h1 class="big">Můj list</h1><span class="eyebrow">Přihlášen jako ${esc(S.me.name)}</span></div>
      <div class="section-head"><h2 class="mid">Chci vidět (${want.length})</h2></div>
      ${want.length ? `<div class="row">${want.map((t) => card(t)).join("")}</div>` : `<p class="eyebrow">Otevři film a klikni „Chci vidět“.</p>`}
      <div class="section-head" style="margin-top:40px"><h2 class="mid">Viděno (${seen.length})</h2></div>
      ${seen.length ? `<div class="row">${seen.map((t) => card(t)).join("")}</div>` : `<p class="eyebrow">Zatím nic.</p>`}
      <div class="section-head" style="margin-top:40px"><h2 class="mid">Moje hodnocení (${mine.length})</h2></div>
      ${mine.length ? `<div class="feed">${mine.map(commentHtml).join("")}</div>` : `<p class="eyebrow">Zatím jsi nenadělil žádné 💩.</p>`}
    </section>`;
  }

  function commentHtml(r) {
    const t = byId(r.titleId);
    const mine = S.me && S.me.name === r.user;
    const liked = S.me && (r.likes || []).includes(S.me.name);
    return `<div class="comment">
      ${t ? `<div class="thumb" data-open="${esc(t.id)}">${t.img ? `<img src="${esc(t.img)}" alt="" loading="lazy">` : ""}</div>` : ""}
      <div style="flex:1;min-width:0">
        <div class="comment-head"><span style="display:flex;gap:8px;align-items:center">${avatar(r.user)}<span><a href="#/lide?u=${encodeURIComponent(r.user)}"><b>${esc(r.user)}</b></a>${t ? ` <span class="when">o</span> <a href="#" data-open="${esc(t.id)}"><b>${esc(t.title)}</b></a>` : ""}</span></span></div>
        <div style="margin-top:6px">${poopStr(r.poops)} <span class="poops-label" style="margin-left:4px">${POOP_LABELS[r.poops]}</span></div>
        ${r.text ? `<p>${esc(r.text)}</p>` : ""}
        <div class="comment-actions"><span class="when">${ago(r.ts)}</span>
          <button data-like="${r.id}" class="${liked ? "on" : ""}">👍 ${(r.likes || []).length || ""} Souhlas</button>
          ${mine ? `<button data-del="${r.id}">Smazat</button>` : ""}</div>
      </div></div>`;
  }

  // ---------- detail (modal) ----------
  function openModal(html, narrow = false, titleId = "") {
    const m = $("#modal");
    $("#modal-box").className = "modal-box" + (narrow ? " narrow" : "");
    $("#modal-box").innerHTML = `<button class="close" data-close aria-label="Zavřít">✕</button>` + html;
    m.dataset.title = titleId;
    m.hidden = false;
    document.body.style.overflow = "hidden";
  }
  function closeModal() {
    $("#modal").hidden = true;
    $("#modal").dataset.title = "";
    document.body.style.overflow = "";
    if (location.hash.startsWith("#/t/")) history.back();
  }

  function openDetail(id) {
    const t = byId(id);
    if (!t) return toast("Titul nenalezen");
    const st = stats(id);
    const my = S.me && S.server.reviews.find((r) => r.titleId === id && r.user === S.me.name);
    const inList = myList()[id];
    const similar = popular(2000).filter((x) => x.img).filter((x) => x.id !== id && x.genres.some((g) => t.genres.includes(g))).sort(() => Math.random() - .5).slice(0, 6);
    openModal(`<div class="detail">
      <div class="detail-poster">${posterImg(t)}</div>
      <div class="detail-body">
        <div class="eyebrow">${typeLabel(t)} · ${t.year} · ${esc(t.platform)}${t.addedBy ? ` · přidal ${esc(t.addedBy)}` : ""}</div>
        <h2 class="mid">${esc(t.title)}</h2>
        ${t.orig ? `<div class="eyebrow" style="margin-top:6px">${esc(t.orig)}</div>` : ""}
        <div class="meta-line">${t.genres.map((g) => `<a class="tag" href="#/katalog?genre=${encodeURIComponent(g)}">${esc(g)}</a>`).join("")}</div>
        <div class="score" id="d-score"></div>
        <div class="list-btns">
          <button class="btn small ${inList && inList.status === "want" ? "solid" : ""}" data-list="want">${inList && inList.status === "want" ? "✓ " : "+ "}Chci vidět</button>
          <button class="btn small ${inList && inList.status === "seen" ? "solid" : ""}" data-list="seen">${inList && inList.status === "seen" ? "✓ " : ""}Viděno</button>
          <a class="btn small" target="_blank" rel="noopener" href="https://www.csfd.cz/hledat/?q=${encodeURIComponent(t.title)}">ČSFD ↗</a>
        </div>
        <div class="form-box">
          <h4>${my ? "Upravit moje hodnocení" : "Tvoje hodnocení"}</h4>
          ${S.me ? `
            <div style="display:flex;align-items:center"><div class="poops" id="d-poops">${[1, 2, 3, 4, 5].map((n) => `<button data-p="${n}" title="${POOP_LABELS[n]}">💩</button>`).join("")}</div><span class="poops-label" id="d-plabel"></span></div>
            <textarea class="input" id="d-text" placeholder="Napiš komentář… (nepovinné)" maxlength="1000" style="margin-top:12px">${esc(my ? my.text : "")}</textarea>
            <div class="form-row"><button class="btn solid" id="d-send">${my ? "Uložit" : "Nadělit hovínka"}</button><span class="eyebrow">1 💩 = odpad · 5 💩 = pecka</span></div>`
          : `<p>Pro hodnocení se zaregistruj – stačí jméno.</p><button class="btn solid" data-action="login">Registrace</button>`}
        </div>
        <h4>Komentáře</h4>
        <div id="d-reviews"></div>
        ${similar.length ? `<h4>Podobné</h4><div class="row" style="grid-auto-columns:110px">${similar.map((x) => card(x)).join("")}</div>` : ""}
      </div></div>`, false, id);

    renderDetailReviews(id);
    if (S.me) {
      let sel = my ? my.poops : 0;
      const paint = (n) => {
        $("#d-poops").querySelectorAll("button").forEach((b) => b.classList.toggle("on", +b.dataset.p <= n));
        $("#d-plabel").textContent = POOP_LABELS[n] || "";
      };
      paint(sel);
      $("#d-poops").addEventListener("mouseover", (e) => { const b = e.target.closest("[data-p]"); if (b) paint(+b.dataset.p); });
      $("#d-poops").addEventListener("mouseleave", () => paint(sel));
      $("#d-poops").addEventListener("click", (e) => { const b = e.target.closest("[data-p]"); if (b) { sel = +b.dataset.p; paint(sel); } });
      $("#d-send").addEventListener("click", async () => {
        if (!sel) return toast("Vyber kolik hovínek 💩");
        try {
          await api("/api/review", { titleId: id, poops: sel, text: $("#d-text").value });
          await refresh();
          toast("Hovínka nadělena 💩");
          openDetail(id);
          renderTicker();
        } catch (e) { toast(e.message); }
      });
    }
  }

  function renderDetailReviews(id) {
    const box = $("#d-reviews");
    if (!box) return;
    const st = stats(id);
    const rs = reviewsOf(id);
    const dist = [5, 4, 3, 2, 1].map((n) => ({ n, c: rs.filter((r) => r.poops === n).length }));
    $("#d-score").innerHTML = st.n
      ? `<b>${st.avg.toFixed(1)}</b><div>${poopStr(st.avg)}<div class="eyebrow">${st.n}× hodnoceno · ${POOP_LABELS[Math.round(st.avg)]}</div></div>`
      : `<span class="eyebrow">Zatím bez hodnocení – buď první!</span>`;
    box.innerHTML = (st.n > 1 ? `<div class="dist">${dist.map((d) => `<div><span>${"💩".repeat(d.n)}</span><span class="bar"><i style="width:${(d.c / st.n) * 100}%"></i></span><span>${d.c}</span></div>`).join("")}</div>` : "")
      + (rs.length ? `<div class="feed" style="grid-template-columns:1fr">${rs.map((r) => commentHtml({ ...r, titleId: "__none" })).join("")}</div>` : `<p class="eyebrow">Žádné komentáře.</p>`);
  }

  // ---------- registrace ----------
  function openLogin() {
    if (S.me) {
      return openModal(`<div class="eyebrow">Účet</div><h2 class="mid" style="margin:8px 0 18px">${esc(S.me.name)}</h2>
        <p>Jsi přihlášený na tomhle zařízení. Kdo tě vidí: všichni na Trashlistu vidí tvoje hodnocení a list.</p>
        <div class="form-row"><a class="btn solid" href="#/muj" data-close>Můj list</a><button class="btn" id="logout">Odhlásit</button></div>`, true);
    }
    openModal(`<div class="eyebrow">Registrace</div><h2 class="mid" style="margin:8px 0 18px">Jak ti říkají?</h2>
      <p>Žádný e-mail, žádné heslo. Jen jméno, pod kterým uvidí ostatní tvoje hovínka.</p>
      <label class="field">Jméno<input class="input" id="l-name" maxlength="24" placeholder="např. Vojta" autofocus></label>
      <button class="btn solid" id="l-go">Vstoupit 💩</button>`, true);
    const go = async () => {
      try {
        const me = await api("/api/register", { name: $("#l-name").value });
        S.me = me; localStorage.setItem("trashlist-me", JSON.stringify(me));
        await refresh(); closeModal(); route(); updateNav();
        toast(`Vítej, ${me.name}!`);
      } catch (e) { toast(e.message); }
    };
    $("#l-go").addEventListener("click", go);
    $("#l-name").addEventListener("keydown", (e) => e.key === "Enter" && go());
    setTimeout(() => $("#l-name").focus(), 50);
  }
  function logout(silent) {
    S.me = null; localStorage.removeItem("trashlist-me");
    updateNav(); if (!silent) { closeModal(); route(); toast("Odhlášeno"); }
  }

  // ---------- přidat titul ----------
  function openAdd() {
    if (!S.me) return openLogin();
    openModal(`<div class="eyebrow">Chybí ti tu něco?</div><h2 class="mid" style="margin:8px 0 18px">Přidat film / seriál</h2>
      <label class="field">Název<input class="input" id="a-title" maxlength="120"></label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <label class="field">Rok<input class="input" id="a-year" type="number" min="2000" max="2026" value="2025"></label>
        <label class="field">Typ<select class="input" id="a-type"><option value="film">Film</option><option value="serial">Seriál</option></select></label>
      </div>
      <label class="field">Platforma<select class="input" id="a-platform">${["Netflix", "HBO Max", "Disney+", "Prime Video", "Apple TV+", "SkyShowtime", "Voyo", "iVysílání", "Kino", "Jinde"].map((p) => `<option>${p}</option>`).join("")}</select></label>
      <div class="field">Žánry<div class="chips" id="a-genres" style="margin:4px 0 0">${GENRE_ORDER.map((g) => `<button class="chip" type="button" data-g="${g}">${g}</button>`).join("")}</div></div>
      <label class="field">Odkaz na plakát (nepovinné)<input class="input" id="a-img" placeholder="https://…jpg"></label>
      <button class="btn solid" id="a-go">Přidat</button>`, true);
    $("#a-genres").addEventListener("click", (e) => { const b = e.target.closest("[data-g]"); if (b) b.classList.toggle("on"); });
    $("#a-go").addEventListener("click", async () => {
      try {
        const t = await api("/api/title", {
          title: $("#a-title").value, year: $("#a-year").value, type: $("#a-type").value, platform: $("#a-platform").value,
          img: $("#a-img").value, genres: [...$("#a-genres").querySelectorAll(".on")].map((b) => b.dataset.g),
        });
        await refresh(); toast("Přidáno!"); location.hash = "#/t/" + t.id;
      } catch (e) { toast(e.message); }
    });
  }

  // ---------- ruleta ----------
  function openRandom(genre = "all") {
    const pool = popular(3000).filter((t) => t.img).filter((t) => genre === "all" || t.genres.includes(genre)).filter((t) => !(myList()[t.id] && myList()[t.id].status === "seen"));
    const t = pool[Math.floor(Math.random() * pool.length)];
    if (!t) return toast("Není z čeho vybírat");
    const genres = GENRE_ORDER.filter((g) => allTitles().some((x) => x.genres.includes(g)));
    openModal(`<div class="roulette"><div class="eyebrow">Ruleta</div><h2 class="mid" style="margin-top:6px">Co dneska?</h2>
      <select class="input" id="r-genre" style="margin-top:14px"><option value="all">Jakýkoli žánr</option>${genres.map((g) => `<option ${g === genre ? "selected" : ""}>${g}</option>`).join("")}</select>
      <div class="card" data-open="${esc(t.id)}"><div class="poster">${posterImg(t)}</div></div>
      <h3 style="margin:0;text-transform:uppercase;letter-spacing:.06em">${esc(t.title)}</h3>
      <div class="eyebrow">${typeLabel(t)} · ${t.year} · ${esc(t.platform)}</div>
      <div class="form-row" style="justify-content:center;margin-top:18px">
        <button class="btn" id="r-again">🎲 Znovu</button><button class="btn solid" data-open="${esc(t.id)}">Otevřít</button></div></div>`, true);
    $("#r-again").addEventListener("click", () => openRandom($("#r-genre").value));
    $("#r-genre").addEventListener("change", (e) => openRandom(e.target.value));
  }

  // ---------- router ----------
  function updateNav() {
    $("#btn-account").textContent = S.me ? S.me.name : "Účet";
    const n = Object.keys(myList()).length;
    $("#nav-me").textContent = `Můj list${n ? ` (${n})` : ""}`;
  }
  let lastView = "";
  function route(soft) {
    const hash = location.hash.slice(1) || "/";
    const [p, qs] = hash.split("?");
    const params = new URLSearchParams(qs || "");
    if (p.startsWith("/t/")) {
      if (!lastView) { lastView = "/"; viewHome(); }
      return openDetail(decodeURIComponent(p.slice(3)));
    }
    if (!$("#modal").hidden && !soft) { $("#modal").hidden = true; document.body.style.overflow = ""; }
    const y = window.scrollY;
    lastView = p;
    if (p === "/katalog") viewCatalog(params);
    else if (p === "/zebricky") viewRankings(params);
    else if (p === "/lide") viewPeople(params);
    else if (p === "/muj") viewMine();
    else viewHome();
    document.querySelectorAll(".nav-left a").forEach((a) => a.classList.toggle("active",
      (a.dataset.nav === "film" && p === "/katalog" && params.get("type") === "film") ||
      (a.dataset.nav === "serial" && p === "/katalog" && params.get("type") === "serial") ||
      a.dataset.nav === p.slice(1)));
    document.querySelectorAll(".tabbar [data-tab]").forEach((a) => a.classList.toggle("active", a.dataset.tab === (p || "/")));
    updateNav();
    if (soft) window.scrollTo(0, y); else window.scrollTo(0, 0);
  }

  // ---------- globální kliky ----------
  document.addEventListener("click", async (e) => {
    const el = e.target;
    if (el.closest("[data-close]")) { e.preventDefault(); return closeModal(); }
    const open = el.closest("[data-open]");
    if (open) { e.preventDefault(); location.hash = "#/t/" + encodeURIComponent(open.dataset.open); return; }
    const act = el.closest("[data-action]");
    if (act) {
      e.preventDefault();
      const a = act.dataset.action;
      if (a === "login") openLogin(); else if (a === "add") openAdd(); else if (a === "random") openRandom();
      return;
    }
    const like = el.closest("[data-like]");
    if (like) {
      if (!S.me) return openLogin();
      try { await api("/api/review/like", { id: like.dataset.like }); await refresh(); afterChange(); } catch (err) { toast(err.message); }
      return;
    }
    const del = el.closest("[data-del]");
    if (del) {
      try { await api("/api/review/delete", { id: del.dataset.del }); await refresh(); toast("Smazáno"); afterChange(); } catch (err) { toast(err.message); }
      return;
    }
    const lb = el.closest("[data-list]");
    if (lb) {
      if (!S.me) return openLogin();
      const id = $("#modal").dataset.title;
      const cur = myList()[id];
      const status = cur && cur.status === lb.dataset.list ? null : lb.dataset.list;
      try { await api("/api/list", { titleId: id, status }); await refresh(); openDetail(id); updateNav(); toast(status ? (status === "want" ? "Přidáno do Chci vidět" : "Označeno jako viděné") : "Odebráno"); } catch (err) { toast(err.message); }
      return;
    }
    if (el.id === "logout") logout();
  });
  function afterChange() {
    const id = $("#modal").dataset.title;
    if (!$("#modal").hidden && id) renderDetailReviews(id); else route(true);
    renderTicker();
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#modal").hidden) closeModal(); });
  $("#btn-account").addEventListener("click", openLogin);
  $("#btn-add").addEventListener("click", openAdd);
  $("#btn-random").addEventListener("click", () => openRandom());
  $("#btn-search").addEventListener("click", () => { location.hash = "#/katalog?q="; setTimeout(() => $("#f-q") && $("#f-q").focus(), 30); });
  window.addEventListener("hashchange", () => route());

  // ---------- start ----------
  (async () => {
    await detectMode();
    if (MODE === "local") {
      $(".nav").insertAdjacentHTML("afterend", `<div class="notice">⚠️ Sdílená databáze ještě není připojená – tvoje hodnocení se zatím ukládají jen v tomhle prohlížeči.</div>`);
    }
    await refresh();
    renderTicker();
    route();
    if (!S.me) setTimeout(() => { if ($("#modal").hidden) openLogin(); }, 1200);
  })();
})();
