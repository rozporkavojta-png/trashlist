# 💩 Trashlist

Web na hodnocení filmů a seriálů (2000–2026, ~15 700 titulů z Wikidat – Netflix, HBO Max, Disney+, Prime, Apple TV+, SkyShowtime, Voyo, kino…) – místo hvězdiček hovínka.

**Web:** https://rozporkavojta-png.github.io/trashlist/

- registrace jen jménem, hodnocení 1–5 💩 + komentář
- katalog s plakáty, filtry (žánr, platforma, roky, typ), hledání, řazení
- můj list (Chci vidět / Viděno), žebříčky (největší trash, pecky), profily lidí
- ruleta „Co dneska?“, přidávání vlastních titulů, živý ticker aktivity
- funguje i na mobilu (spodní lišta)
- hodnocení se ukládají do sdílené databáze, takže ostatní hned vidí, co jsi přidal

## Kam se ukládají hodnocení

Web vybere automaticky (`public/config.js`):

1. **Supabase** (sdílené online) – když je v `config.js` vyplněné `supabaseUrl` a `supabaseKey`.
2. **Lokální server** – `node server.js` na http://localhost:3000, data v `data/db.json`.
3. **Jen prohlížeč** – když nic z toho není (např. GitHub Pages bez Supabase).

### Zapnutí sdílení přes Supabase (zdarma)

1. Na https://supabase.com se přihlas přes GitHub a vytvoř nový projekt (region Frankfurt).
2. V projektu otevři **SQL Editor → New query**, vlož celý soubor `supabase.sql` a dej **Run**.
3. V **Project Settings → API** zkopíruj *Project URL* a klíč *anon / public* do `public/config.js`.
4. Commit + `npm run deploy` (nahraje složku public/ do větve gh-pages, ze které běží web).

Pozn.: free projekt na Supabase se po týdnu bez návštěv uspí – v dashboardu se jedním klikem probudí.

## Lokální spuštění

```
node server.js
```

pak otevři http://localhost:3000 (Node 18+, žádné závislosti).

## Katalog

`node scripts/build-catalog.js` – stáhne filmy a seriály z Wikidat a plakáty z Wikipedie
(ruční úpravy v `scripts/catalog-src.js`, chybějící plakáty doplní `node scripts/fill-posters.js`).
