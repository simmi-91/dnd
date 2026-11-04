# D&D kampguide – utviklingsplan

Versjon 1 · 4. november 2026 · Elin

Planen beskriver hva som skal bygges og i hvilken rekkefølge. Den er skrevet for en kodeklient i WSL som skal implementere appen. Dette er en plan, ikke fasit for kode: ta egne tekniske valg der planen er åpen, men hold deg til beslutningene i kapittel 2.

## 1. Mål

En nettside på eget subdomene som hjelper en ny D&D-spiller ved bordet. Den skal svare på to spørsmål:

1. **I kamp:** Hva kan jeg gjøre nå, og hva skal jeg si til DM?
2. **Mellom kamper:** Hva vet vi om questene, personene og stedene i kampanjen?

Siden skal fungere like godt på mobil (én hånd ved bordet) og laptop (mer plass, flere kolonner samtidig). Data lagres på serveren, slik at det går an å bytte mellom mobil og laptop midt i en kamp.

### Referansemateriale i repoet

| Sti | Innhold |
| --- | --- |
| `reference/prototype/byggebeskrivelse.md` | Hvordan prototypen virker: regler, utregning, kampflyt, bjørnetrekk. **Les denne først.** |
| `reference/prototype/derive.js` | `deriveCharacter`, `seedPetTraits`, `applyPetTraits`. Regner ut et ark fra D&D Beyond-JSON. Skal skrives om til TypeScript |
| `reference/prototype/app.jsx` | Hele prototypen (React 18, uten byggesystem). Kampflyt, terninginnskriving, angrep, bjørnetur |
| `reference/prototype/shell.html` | CSS og fargevariabler fra prototypen (mørkt tema, gjelder ikke det nye designet) |
| `docs/design/retninger.html` | Tre designretninger. **Variant B «Pergament» er valgt** |
| `docs/design/kampanjebok.html` | Skisser av «Mine spill» og kampanjeboka (oppslagsverk og dagbok, begge skal bygges) |

Åpne HTML-skissene i en nettleser. De viser mobil- og laptopvisning side om side.

## 2. Beslutninger (tatt, ikke diskuter på nytt)

| Tema | Beslutning |
| --- | --- |
| Språk i appen | Norsk tekst. Engelske regelord der D&D bruker dem (Action, Bonus Action, Hit Dice, Advantage, Concentration …) |
| Design | Variant B «Pergament»: lyst pergament, Cinzel + EB Garamond, mørk rød. Bunnmeny på mobil, sidemeny på laptop. Turen vises som nummererte steg |
| Teknologi | Node, React, TypeScript, MySQL. Innlogging med Google-konto |
| Database | **Ingen ny database.** Tabeller i den eksisterende databasen, alle med prefiks `dd_` |
| Hosting | LEMP-server, eget subdomene (`dnd.3lin.no`). Node finnes på serveren. Nginx foran Node |
| Utvikling og utrulling | Lokalt i WSL. GitHub Actions ruller ut til serveren |
| Brukere | Bare Elin nå, men datamodellen skal tåle flere brukere |
| Spill | Flere spill (kampanjer) per bruker, f.eks. «Icewind Dale» med Elowen og et tidligere «Lego-eventyr» med en annen karakter. Hvert spill har én tilkoblet D&D Beyond-karakter og sin egen kampanjebok |
| Kampanjebok | **Både** dagbok (fritekst per økt med `@person`, `#sted`, `!quest`) **og** oppslagsverk (kort per quest/person/sted). Samme data, to visninger |
| Terninger | Fysiske terninger først. Spilleren skriver inn tallet, og appen legger til bonuser. Rulling i appen er en liten reserve |

### Utviklingsmiljø

- All utvikling skjer i WSL, mot en **lokal MySQL i Docker** som brukeren allerede har. Lag `dd_`-tabellene i en database der, på samme måte som i de andre prosjektene.
- WSL har **ikke** tilgang til produksjonsserveren eller filene der. Alt om serveren må utledes fra repoene til de andre prosjektene (workflow-filer, skript, README, docker-compose), eller brukeren må svare.
- Konfigurasjon som skal installeres på serveren for hånd (nginx-blokk, systemd-enhet eller pm2-fil) lages som filer i `deploy/`, med en kort `deploy/README.md` med stegene brukeren selv må gjøre på serveren.

### Må avklares av klienten i WSL

Finn svarene i de andre prosjektene. Det som ikke står der, samler du i **én** liste med spørsmål til brukeren.

- [x] Hvordan den lokale Docker-databasen startes, og hvilken database, bruker og port de andre prosjektene bruker (fra docker-compose og `.env.example`).
- [x] MySQL- eller MariaDB-versjon. Les den lokalt fra Docker-imaget. Spør brukeren om produksjonen har samme versjon. Er JSON-kolonner og FULLTEXT på InnoDB tilgjengelig?
- [x] Hvordan eksisterende GitHub Actions-workflows ruller ut: ssh + rsync, git pull på serveren, secrets-navn, stier på serveren. **Gjør likt som i de andre prosjektene.**
- [x] Hvordan andre Node-apper kjøres på serveren (systemd, pm2 eller Docker), slik det kommer fram av workflows og skript. Gjør likt.
- [x] Hvordan Google-innlogging er løst i de andre prosjektene. Gjenbruk mønsteret hvis det passer med kapittel 6.
- [x] Node-versjon. Bruk den samme som i de andre prosjektene (`engines`, `.nvmrc`, workflow).
- [x] Navnet på subdomenet. Spør brukeren.

## 3. Arkitektur

```
mobil / laptop ──HTTPS──> nginx (dnd.3lin.no)
                           ├─ /         → statiske filer fra web/dist (SPA, PWA)
                           └─ /api/*    → Node-server (127.0.0.1:<PORT>)
                                            ├─ MySQL (eksisterende DB, tabeller dd_*)
                                            └─ D&D Beyond character-service (hentes fra serveren, bufres)
```

### Repostruktur (npm workspaces)

```
apps/web        React + Vite + TypeScript. UI, PWA
apps/server     Fastify + TypeScript. API, innlogging, D&D Beyond-henting, migreringer
packages/rules  Ren TypeScript uten avhengigheter: deriveCharacter, regelkatalog, tur-reducer. Brukes av web og server
docs/           Plan og skisser
reference/      Prototypen (bare til lesing, bygges ikke)
```

### Anbefalte biblioteker (kan byttes hvis de andre prosjektene bruker noe annet)

| Behov | Forslag |
| --- | --- |
| Server | Fastify, `@fastify/cookie`, `@fastify/static` (bare i utvikling) |
| Database | `mysql2` + Kysely (typede spørringer og migreringer). Migreringstabellene skal hete `dd_migrations` og `dd_migrations_lock` |
| Validering | Zod. Skjemaene deles mellom web og server |
| Innlogging | `google-auth-library` for å verifisere ID-tokens. Google Identity Services-knappen i web |
| Frontend-data | TanStack Query |
| Ruting | React Router |
| PWA | `vite-plugin-pwa` |
| Tester | Vitest. Playwright for et par flyter fra start til slutt |

## 4. Datamodell (MySQL, prefiks `dd_`)

Alle tabeller bruker InnoDB og utf8mb4. Bruk JSON-kolonner der det står `json`. Mangler serveren JSON-støtte, bruk `LONGTEXT` med validering i appen. Alle rader som kan redigeres fra flere enheter har en `version`-kolonne for samtidighetskontroll (se 5.3).

| Tabell | Kolonner | Merknad |
| --- | --- | --- |
| `dd_users` | id, google_sub (unik), email, name, avatar_url, created_at, last_login_at | |
| `dd_auth_sessions` | id (sha256 av token), user_id, created_at, expires_at, user_agent | Tokenet ligger bare i informasjonskapselen. I databasen lagres hashen |
| `dd_characters` | id, user_id, ddb_id, name, summary (f.eks. «Gloom Stalker Ranger 4»), derived (json), derive_version, imported_at | Det utregnede arket, ca. 11 kB. Rå D&D Beyond-JSON lagres ikke |
| `dd_games` | id, user_id, name, status (`active`/`archived`), character_id (nullable FK), cover (forhåndsvalgt fargetema), created_at, updated_at | Et spill er en kampanje |
| `dd_game_state` | game_id (PK), state (json), version, updated_at | Varig spilltilstand, se under |
| `dd_combats` | id, game_id, status (`active`/`ended`), round, state (json), version, started_at, ended_at | Maks én aktiv kamp per spill (sjekkes i appen) |
| `dd_sessions` | id, game_id, number, played_on (date), title, body (text), version, created_at, updated_at | Dagbok, én rad per økt. FULLTEXT(title, body) |
| `dd_entries` | id, game_id, kind (`quest`/`person`/`place`/`other`), name, summary, body (text), status, fields (json), archived, version, created_at, updated_at | Oppslagsverket. UNIQUE(game_id, kind, name). FULLTEXT(name, summary, body) |
| `dd_mentions` | source_type (`session`/`entry`), source_id, entry_id. PK på alle tre | Bygges på nytt når kilden lagres |

**`dd_game_state.state`** (videreført fra prototypens `app/state`):
`hpRemoved`, `tempHp`, `resources` (brukte ganger per ressursnøkkel), `slotsUsed` (per nivå), `hitDiceUsed`, `exhaustion`, `conditions`, `deathSaves`, `pets[id]` (`traits`, `hpRemoved`, `inCombat`), `companions` (egne deltakere som ikke finnes i D&D Beyond, f.eks. ugla med initiativbonus og HP).

**`dd_combats.state`:** deltakere (karakter, kjæledyr, følgesvenner, fiender/NPC-er som legges inn for hånd) med initiativ, rekkefølge, hvem som har tur, hvem som har spilt, turobjektet (se 7.2), aktive effekter (Hunter's Mark-mål, konsentrasjon, mørke, Help, skjult) og kamplogg.

**`dd_entries.status`:** for quester `active`, `open`, `done` eller `failed`, ellers null.
**`dd_entries.fields`:** for quest `{ giverEntryId, placeEntryIds, reward }`, for person `{ role, attitude: friend|neutral|hostile, placeEntryId }`, for sted `{ type: by|dungeon|region|annet, parentEntryId }`.

## 5. API

Alle ruter ligger under `/api`. Alle unntatt `/api/auth/*` og `/api/health` krever innlogging. Alt valideres med Zod. Brukeren eier dataene sine: hver spørring filtrerer på `user_id` via spillet.

### 5.1 Endepunkter

| Metode og sti | Hva |
| --- | --- |
| `POST /api/auth/google` | Tar imot et Google ID-token, verifiserer det, sjekker tillatte e-postadresser, oppretter bruker og sesjon, setter informasjonskapsel |
| `POST /api/auth/logout` | Sletter sesjonen |
| `GET /api/me` | Innlogget bruker |
| `GET /api/health` | Helsesjekk for utrulling |
| `GET /api/games` · `POST /api/games` | Liste og opprett. Opprett tar `{ name, ddbUrlOrId }` og importerer karakteren |
| `GET/PATCH/DELETE /api/games/:id` | Navn, status (arkiver), cover, bytt karakter |
| `POST /api/games/:id/character/refresh` | Hent fra D&D Beyond på nytt. Valg: `{ alsoHpAndResources: boolean }`. Svarer med nye evner hvis nivået har gått opp |
| `POST /api/games/:id/character/paste` | Reserve: rå JSON limt inn av brukeren |
| `GET/PUT /api/games/:id/state` | Varig spilltilstand, med versjon |
| `GET /api/games/:id/combat` · `POST …/combat` · `PUT …/combat` · `POST …/combat/end` | Aktiv kamp |
| `GET/POST /api/games/:id/sessions` · `GET/PUT/DELETE /api/sessions/:id` | Dagbok |
| `GET/POST /api/games/:id/entries` · `GET/PUT/DELETE /api/entries/:id` | Oppslagsverk. `GET` på én oppføring tar med hvor den er nevnt |
| `GET /api/games/:id/search?q=` | Fulltekstsøk i økter og oppføringer |
| `GET /api/games/:id/entries/suggest?kind=&q=` | Autofullføring for `@`, `#` og `!` |

### 5.2 D&D Beyond-henting

- Adressen er `https://character-service.dndbeyond.com/character/v5/character/{id}`. Godta både en full lenke (`dndbeyond.com/characters/123456789`) og en ID.
- Tjenesten er uoffisiell. Bufre svaret i minnet i 5 minutter per ID, send en tydelig User-Agent, og hent bare når brukeren ber om det.
- Feilmeldinger på norsk: 403 betyr «Karakteren er privat. Sett Character Privacy til Public på D&D Beyond.», 404 betyr feil ID, og et ukjent format gir «D&D Beyond har endret formatet. Bruk lim inn.».
- Kjør `deriveCharacter` på serveren, og lagre resultatet og `derive_version`.
- Flettereglene er de samme som i prototypen (se byggebeskrivelsen, «Lagring og tilstand»). Arket byttes alltid ut. HP og ressurser hentes bare ved første import eller når brukeren ber om det. Kjæledyr som finnes fra før beholder trekkene sine.

### 5.3 Synk mellom enheter

- Hver skriving sender `version`. Serveren oppdaterer med `WHERE version = ?`. Treffer den ingen rad, svarer den 409 med gjeldende data.
- Ved 409 bruker web serverens versjon. I kamp skjer dette sjelden, siden bare én enhet brukes om gangen.
- Hent på nytt når fanen får fokus (`visibilitychange`). Mens en kamp pågår, hent også hvert 10. sekund når fanen er synlig.
- Lagre 0,7 sekunder etter siste endring, maks én skriving om gangen (som i prototypen).

## 6. Innlogging

1. Web viser Google Identity Services-knappen («Logg inn med Google»).
2. Web sender ID-tokenet til `POST /api/auth/google`.
3. Serveren verifiserer tokenet mot `GOOGLE_CLIENT_ID` og sjekker e-posten mot `ALLOWED_EMAILS`, en kommaseparert liste. Foreløpig står bare Elin på den.
4. Serveren lager et tilfeldig token på 32 byte, lagrer sha256-hashen i `dd_auth_sessions` og setter informasjonskapselen `dd_session` med `HttpOnly; Secure; SameSite=Lax; Path=/`. Sesjonen varer i 60 dager og forlenges ved bruk.
5. Skrivende kall krever i tillegg headeren `X-Requested-With`, som beskyttelse mot CSRF.

Brukeren må lage en OAuth-klient i Google Cloud Console med det nye subdomenet som «Authorized JavaScript origin». Legg også inn `http://localhost:5173` for utvikling. Det har brukeren gjort før på andre sider.

### Miljøvariabler (`apps/server/.env`, aldri i git)

`PORT`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `GOOGLE_CLIENT_ID`, `ALLOWED_EMAILS`, `SESSION_TTL_DAYS`, `DDB_CACHE_SECONDS`, `NODE_ENV`. Lag en `.env.example`. `GOOGLE_CLIENT_ID` trengs også i web, som `VITE_GOOGLE_CLIENT_ID`.

## 7. Regelmotoren (`packages/rules`)

### 7.1 Utregning av ark

- Skriv om `reference/prototype/derive.js` til TypeScript, med typer for både D&D Beyond-svaret (bare feltene som brukes) og arket som kommer ut.
- **Test først:** Lagre ekte D&D Beyond-svar som fixtures i `packages/rules/fixtures/`, og skriv tester som sjekker tallene i tabellen «Utregningen fra rådata til ark» i byggebeskrivelsen. Elowen nivå 4 skal gi HP 40, AC 14, Init +6, Longbow +7 1d8+3, Perception +7. Be brukeren om ID-ene og at karakterene er satt til Public.
- Rett opp kjente begrensninger der det er enkelt: spell slots og evner for multiclass, magiske gjenstander med bonuser, og initiativ og HP for følgesvenner som legges inn for hånd (erstatter ugla med «+1 skrevet inn i koden»).

### 7.2 Kataloger og tur

Evner skal beskrives som **data**, ikke `if (navn === …)` spredt rundt i UI-koden. Lag:

- **Actionkatalog (2024):** Attack, Dash, Disengage, Dodge, Help, Hide, Influence, Magic, Ready, Search, Study, Utilize. Hver med en kort norsk forklaring, hva den koster, og en «si til DM»-mal.
- **Bonus Action og Reaction:** fra evner og spells (Hunter's Mark, flytt Hunter's Mark, Light-ekstraangrep, Opportunity Attack).
- **Evneregister:** et kart fra evnenavn til effekt. Dekker minst det prototypen gjenkjenner: Extra Attack, Dread Ambusher (Dreadful Strike, Ambusher's Leap), Umbral Sight, Stalker's Flurry, Foe Slayer og Roving. Weapon Mastery (Slow, Nick, Vex, Sap, Topple, Push, Graze, Cleave). Sharpshooter. Nye klasser skal kunne legges til uten å endre UI-et.
- **Conditions (2024):** Blinded, Charmed, Deafened, Exhaustion, Frightened, Grappled, Incapacitated, Invisible, Paralyzed, Petrified, Poisoned, Prone, Restrained, Stunned, Unconscious. Hver med en kort norsk forklaring av hva den betyr for deg.
- **Tur-reducer:** en ren funksjon `turReducer(state, event)` som holder rede på action, bonus action, reaction, bevegelse (fot brukt og fot tilgjengelig), angrep igjen (Extra Attack), Light og Nick, Dreadful Strike én gang per tur, advantage-kilder og konsentrasjon. Den svarer på `canDo(option)` med `{ ok, reason }`. `reason` er den norske teksten som vises på gråe valg, f.eks. «Bonus action er brukt denne turen».
- Alle regler i tabellen «Spillregler i kampflyten» i byggebeskrivelsen skal finnes igjen her og ha tester.
- **Utenfor kamp:** Short Rest (bruk Hit Dice), Long Rest (fyll opp alt, inkludert kjæledyr), death saves ved 0 HP, temp HP, og konsentrasjonssjekk ved skade (DC = maks av 10 og halve skaden).

## 8. Skjermer

Bygg i pergamentstilen fra `docs/design/`. Bruk en mobil-først layout med tre brytepunkter: mobil under 700 px, nettbrett og liten laptop fra 700 px, laptop fra 1100 px.

| Skjerm | Mobil | Laptop |
| --- | --- | --- |
| Innlogging | Google-knapp midt på pergament | Samme |
| Mine spill | Kort under hverandre, «+ Nytt spill» | Rutenett med tre kort. Knappene «Kamp» og «Kampanjebok» på kortet for spillet som pågår |
| Nytt spill | Navn, lenke til D&D Beyond, forhåndsvisning av karakteren før lagring | Samme, i en dialog |
| Kamp: oppsett | Initiativ per deltaker, legg til fiender/NPC-er, bryter for mørke og hvem som er med | Samme |
| Kamp: runde | Faner per deltaker i initiativrekkefølge, festet øverst. Turen som steg 1–3 (Bevegelse, Bonus action, Action) og R (Reaction). «Avslutt tur → neste» | Tre kolonner: initiativliste med HP · valgt steg eller angrepsflyt · ark, notater eller bjørner (med faner) |
| Angrepsflyt | Som i prototypen: våpen → d20 → total og «Si til DM» → Traff/Bom → ekstra skade → skade per type | I midtkolonnen |
| Ark | Evneverdier, saves, skills, våpen, spells, evner, «Hva skjer på neste nivå» | To kolonner |
| Følgesvenner | Bjørnekort med trekk, HP og med i kamp av/på. Ugla og andre som legges inn for hånd | Rutenett |
| Kampanjebok: oppslagsverk | Søk, faner for Quester/Personer/Steder/Økter, liste, deretter detaljkort | Sidemeny, liste, detalj (tre kolonner) |
| Kampanjebok: dagbok | Økta i dag som skriveflate, med knapper for @, # og ! | Liste over økter i sidemenyen, skriveflate, register som bygges automatisk til høyre |
| Hurtignotat | Flytende knapp i kamp som legger tekst til økta i dag | Feltet i høyre kolonne |

Prinsipper fra prototypen som skal beholdes:
- Valg som ikke er mulige vises grå med grunnen under.
- Merket «Anbefalt» på det vanlige valget.
- «Si til DM»-setningen med tallene i.
- Innskrevne tall sjekkes: en d20 må være 1–20, og en skadegruppe må ligge mellom min og maks.
- Paneler skjules i stedet for å fjernes, slik at et halvveis angrep beholdes ved fanebytte.
- Kamploggen er lukket som standard.
- «Avslutt kamp» står øverst.

### Dagboksyntaks

- Når du skriver `@`, `#` eller `!`, åpnes autofullføring med eksisterende personer, steder eller quester, pluss valget «Opprett «…»».
- Teksten lagres som `@[Brann Holt](e:42)`, så navn med mellomrom og senere navnebytter virker. Ved visning blir det en farget lenke: person grønn, sted blå, quest rød.
- Serveren tolker teksten ved lagring, oppretter oppføringer som mangler og bygger `dd_mentions` på nytt.

### Fargevariabler (fra skissene)

| Variabel | Verdi | Bruk |
| --- | --- | --- |
| `--bg` | `#f3ead8` | Pergament |
| `--card` | `#fbf6ea` | Kort |
| `--line` | `#d8c7a5` | Kanter |
| `--ink` | `#2b2118` | Tekst, sidemeny og bunnmeny |
| `--dim` | `#7a6a55` | Dempet tekst |
| `--accent` | `#7a1f1a` | Hovedknapper, overskrifter, quest |
| `--gold` | `#a8894f` | Ornamenter, linjer |
| `--nav-active` | `#f3c56b` | Aktivt menypunkt |
| `--person` | `#3e6b4a` | Person, reaction, treff |
| `--place` | `#2f5578` | Sted, action |
| `--bonus` | `#a8741a` | Bonus action, Hunter's Mark |
| `--psychic` | `#6b3f8f` | Dreadful Strike, psychic |
| `--miss` | `#b2452c` | Bom, skade |

Overskrifter bruker Cinzel 600/700, brødtekst EB Garamond 400–600. Tall i kamp vises med `font-variant-numeric: tabular-nums`. Sjekk kontrasten (WCAG AA) på tekst mot pergamentfargen. Trykkflater skal være minst 44 px høye. Et mørkt «nattpergament»-tema kan komme senere, men legg alle farger i CSS-variabler fra starten.

## 9. Utrulling

- Nginx-serverblokk for subdomenet: TLS med certbot, `root` til `apps/web/dist`, `try_files $uri /index.html`, og `location /api/` som proxy til Node på `127.0.0.1:<PORT>`. Lang cache på filer med hash i navnet, og `no-cache` på `index.html` og service workeren.
- Node-serveren kjøres på samme måte som brukerens andre Node-apper (se kapittel 2).
- GitHub Actions skal bygge og teste (lint, typecheck, vitest), bygge web og server, overføre til serveren, kjøre `npm run migrate` og starte tjenesten på nytt. Til slutt sjekker den `GET /api/health`. Følg oppsettet i de andre prosjektene, med secrets i GitHub.
- Migreringene endrer bare tabeller med `dd_`-prefiks. Ingen migrering skal røre andre tabeller i databasen.

## 10. Faser

Hver fase skal kunne rulles ut og brukes for seg.

### Fase 0 – Oppsett
- [x] npm workspaces, TypeScript strict, ESLint og Prettier, Vitest
- [x] Svar på punktene under «Må avklares» i kapittel 2
- [x] `CLAUDE.md` med kommandoer og konvensjoner

**Ferdig når:** `npm run dev` starter web og server lokalt i WSL, og `npm test` kjører.

### Fase 1 – Grunnmur
- [x] Fastify-server, Kysely-migreringer for `dd_users`, `dd_auth_sessions` og `dd_migrations`
- [x] Google-innlogging, åpen for alle, med sperring (`blocked`). Se AVKLARINGER
- [x] Web-skall i pergamentstil: innlogging, tom «Mine spill», bunnmeny og sidemeny
- [x] Nginx, tjeneste og GitHub Actions-utrulling til subdomenet

**Ferdig når:** Elin kan logge inn på `https://dnd.3lin.no` fra både mobil og laptop, og en push til main ruller ut automatisk.

### Fase 2 – Spill, karakter og ark
- [ ] `packages/rules`: `deriveCharacter` i TypeScript med fixture-tester
- [ ] Tabellene `dd_characters`, `dd_games` og `dd_game_state`
- [ ] Hente fra D&D Beyond på serveren, lim inn som reserve, oppdater med nivåkort
- [ ] Mine spill, Nytt spill, arkivering
- [ ] Ark-skjermen og Følgesvenner (bjørnetrekk med `seedPetTraits` og `applyPetTraits`, egne følgesvenner som ugla)
- [ ] HP, ressurser, Short Rest og Long Rest

**Ferdig når:** Spillet «Icewind Dale» med Elowen viser de samme tallene som D&D Beyond, og et spill med en annen karakter kan opprettes.

### Fase 3 – Kamp
- [ ] Kataloger og `turReducer` med tester for alle reglene
- [ ] `dd_combats` med synk mellom enheter
- [ ] Oppsett, faner per deltaker, turen som steg, angrepsflyt, bjørnetur, ugla
- [ ] Fiender og NPC-er som legges inn for hånd (navn, initiativ, eventuelt HP)
- [ ] Conditions, konsentrasjon, death saves, kamplogg

**Ferdig når:** En hel kamp kan spilles på mobil, og hvis siden lastes på nytt eller du bytter til laptop midt i runden, er alt med.

### Fase 4 – Kampanjebok
- [ ] Tabellene `dd_sessions`, `dd_entries` og `dd_mentions`, med FULLTEXT
- [ ] Dagbok med `@`, `#` og `!`, autofullføring og tolking på serveren
- [ ] Oppslagsverk med detaljkort, felter og «Nevnt i økter»
- [ ] Søk og hurtignotat fra kampskjermen

**Ferdig når:** Det som skrives i dagboka under en økt dukker opp i oppslagsverket uten ekstra arbeid.

### Fase 5 – PWA og finpuss
- [ ] Manifest, ikon (`assets/icon.svg`) og service worker. Ark og kamp kan leses uten nett, og skrivinger settes i kø til nettet er tilbake
- [ ] Gjennomgang av tilgjengelighet (kontrast, fokus, skjermleser-etiketter)
- [ ] Playwright-tester for innlogging (med testmodus), nytt spill, én kamprunde og dagbok → oppslagsverk
- [ ] Eventuelt et mørkt tema

## 11. Risiko

| Risiko | Tiltak |
| --- | --- |
| D&D Beyond endrer formatet eller stenger tjenesten | Lim inn som reserve, fixture-tester, tydelig feilmelding, `derive_version` |
| Regler som kan tolkes ulikt (Nick, husregler for bjørnene) | Gjør tolkningen synlig i Tips-teksten. Husregler er data på kjæledyret, ikke kode |
| Lite plass på mobil i kamp | Ett steg åpent om gangen, resten lukket med et sammendrag |
| Migreringer i en delt database | Bare `dd_`-tabeller. Les migreringene før de kjøres i produksjon |
