# 💩 Trashlist

Web na hodnocení filmů a seriálů (2000–2026, ~15 700 titulů z Wikidat – Netflix, HBO Max, Disney+, Prime, Apple TV+, SkyShowtime, Voyo, kino…) – místo hvězdiček hovínka.

- registrace jen jménem, hodnocení 1–5 💩 + komentář
- katalog s plakáty, filtry (žánr, platforma, roky, typ), hledání, řazení
- můj list (Chci vidět / Viděno), žebříčky (největší trash, pecky), profily lidí
- ruleta „Co dneska?“, přidávání vlastních titulů, živý ticker aktivity
- všechno se ukládá na server, takže ostatní hned vidí, co jsi přidal

## Spuštění

```
node server.js
```

pak otevři http://localhost:3000 (Node 18+, žádné závislosti).

Data se ukládají do `data/db.json` (není v gitu).
Katalog se přegeneruje příkazem `node scripts/build-catalog.js` (titulky se upravují v `scripts/catalog-src.js`).
