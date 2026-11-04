# Avklaringer og plan for fase 0 og 1

4. november 2026. Svar på «Må avklares av klienten i WSL» i kapittel 2 i `UTVIKLINGSPLAN.md`, og endringer i planen som brukeren har bestemt. Det som står her, gjelder foran planen.

## Avklart

| Tema | Svar |
| --- | --- |
| Subdomene og port | `dnd.3lin.no`, Node på **8032** |
| Lokal database | `dev_container` (mysql:8.0.44, `127.0.0.1:3306`), databasen **`development_db`**, bruker root. Passordet står som `DEV_DB_PASSWORD` i `~/_server_/api-admin/.env`. Compose-filen ligger i `C:\Users\Elin\dockerContainer\` |
| Database i produksjon | **`prodbase`**, bruker `3lin_web`, MySQL **8.0.46**. Delt med andre apper. JSON-kolonner og FULLTEXT på InnoDB virker. `innodb_ft_min_token_size` = 3 |
| Node | 22 (som i alle workflows). `.nvmrc` = 22 |
| Pakkebehandler | npm workspaces |
| Kjøring på serveren | pm2 som `DEPLOY_RUN_AS_USER`, prosessnavn `dnd`, `--env-file=/var/www/dnd/.env` |
| Utrulling | GitHub Actions som i brukerens andre prosjekter: bygg i CI, `appleboy/scp-action` til `/tmp/dnd-deploy-*`, `appleboy/ssh-action` som bytter `server` → `server_old` og `client` → `client_old`, `npm ci --omit=dev`, migrering, pm2-restart, helsesjekk på `http://localhost:8032/api/health` og rollback ved feil. Secrets: `SERVER_HOST`, `SERVER_USER`, `SERVER_SSH_KEY`, `DEPLOY_RUN_AS_USER` |
| Mapper på serveren | `/var/www/dnd/.env`, `/var/www/dnd/client/` (bygd web), `/var/www/dnd/server/` (Node), `/var/www/dnd/img/` (opplastede bilder, senere) |
| Repo | `https://github.com/simmi-91/dnd` (offentlig). Loggene fra Actions er derfor offentlige: aldri skriv ut `.env` eller secrets |
| Google-innlogging | ID-token-flyten fra kapittel 6 (Google-knappen i web, `google-auth-library` på serveren, som i api-admin og palia). Sesjon som hash i `dd_auth_sessions`, som i planteapp2. Brukeren lager en ny OAuth-klient med origins `https://dnd.3lin.no` og `http://localhost:5173` |

## Endringer i planen

- **`ALLOWED_EMAILS` utgår.** Alle med Google-konto kan logge inn. `dd_users` får `blocked TINYINT(1) NOT NULL DEFAULT 0`. Sperrede brukere får 403 «Kontoen er sperret» ved innlogging, og `blocked` sjekkes på hvert kall, så sperringen virker med en gang. Sperring gjøres foreløpig med SQL (se `deploy/README.md`). I fase 2 trengs en grense per bruker på henting fra D&D Beyond, siden innloggingen er åpen.
- **Nginx sender alt til Node** (brukerens fil `/etc/nginx/sites-available/dnd.3lin.no`: `location /` og `location /api/upload` → `localhost:8032`). Fastify serverer derfor den bygde nettsiden fra `WEB_DIR=/var/www/dnd/client` i produksjon, med lang cache på `/assets/*` og `no-cache` på `index.html` og service workeren. Dette erstatter `root`-oppsettet i kapittel 9.
- **Google client ID i web** hentes fra serveren (`GET /api/auth/config`) i stedet for `VITE_GOOGLE_CLIENT_ID`, så det trengs ikke noen egen GitHub-secret og bare én `.env`.
- **`packages/shared`** er lagt til for Zod-skjemaer og API-typer som web og server deler. `packages/rules` forblir uten avhengigheter.
- **Bilder:** `IMAGE_DIR=/var/www/dnd/img`. Opplasting av kart over verdenen er ønsket senere (ikke i fase 0–1). Nginx har allerede `/api/upload` med 20 MB og lang timeout.
- Lokal innlogging uten Google: `GET /api/auth/dev-login` når `DEV_LOGIN_EMAIL` er satt og `NODE_ENV` ikke er `production` (som i planteapp2).

## Plan for fase 0 og 1

| Del | Innhold |
| --- | --- |
| Rot | npm workspaces (`@dnd/server`, `@dnd/web`, `@dnd/rules`, `@dnd/shared`), TypeScript strict, ESLint (flat) og Prettier, Vitest med prosjekter, `.nvmrc`, `.gitignore` |
| `apps/server` | Fastify 5, `@fastify/cookie`, `@fastify/static`, `mysql2` + Kysely, Zod, `google-auth-library`. Bundles med esbuild til `dist/index.js` og `dist/migrate.js` |
| Migreringer | Kysely-migreringer i kode, tabellene `dd_migrations` og `dd_migrations_lock`. Fase 1 lager `dd_users` og `dd_auth_sessions`. Migratoren nekter tabellnavn uten `dd_` |
| Innlogging | `POST /api/auth/google`, `POST /api/auth/logout`, `GET /api/me`, `GET /api/health` (med `SELECT 1`). Informasjonskapselen `dd_session` (HttpOnly, Secure i produksjon, SameSite=Lax, 60 dager, forlenges ved bruk). `X-Requested-With` kreves på skrivende kall |
| `apps/web` | React 19, Vite, React Router, TanStack Query, `@react-oauth/google`, fontene Cinzel og EB Garamond lokalt (`@fontsource`). Pergamentskall: innlogging, tom «Mine spill», bunnmeny på mobil og sidemeny på laptop |
| `deploy/` | `README.md` (stegene på serveren), `rollback.sh`, kopi av nginx-filen |
| CI | `.github/workflows/deploy.yml`: lint, typecheck, test (mot en MySQL 8.0-tjeneste i CI), build, utrulling som beskrevet over |

## Arbeidsmåte

Se «Arbeidsmåte» i `CLAUDE.md`: workers per del med passende modell, uavhengig test av en annen worker, og ingen commit eller push uten at brukeren ber om det.

## Beslutninger under fase 0 og 1

- **Sesjoner:** `dd_auth_sessions` har et eget tall som `id` og `token_hash` (sha256 i hex, unik) som egen kolonne, i stedet for at hashen er `id`. `user_agent` er med. Sesjonen forlenges høyst én gang i døgnet.
- **Kontokobling:** brukere finnes via Google `sub`. E-post kobles bare til en eksisterende bruker som kommer fra dev-login (`google_sub` begynner med `dev:`). Ellers svarer serveren 409 `account_conflict`.
- **CSRF:** `X-Requested-With: dnd` kreves på alle skrivende metoder (POST, PUT, PATCH, DELETE), uansett sti. API-stier som ikke er skrevet nøyaktig som `/api/...`, for eksempel `/API` eller `/%61pi`, får JSON 404.
- **`dd_`-vernet:** migreringene får et frosset `MigrationContext` med bare `createTable`, `alterTable`, `dropTable`, `createIndex` og `dropIndex`. En plugin med tillatelsesliste krever `dd_` på alle tabeller. Rå SQL er bare lov fra de faste `ddl`-hjelperne, og `setSchema` er nektet. Migreringer kan ikke endre data ennå. Trengs det, må konteksten utvides. Vernet hindrer feil, men ikke ondsinnet kode, og den reelle sikringen er en egen databasebruker (se `deploy/README.md` §10).
- **Logger:** feil ved Google-verifisering logges som en fast kategori, aldri som meldingstekst eller token.
- **Bygg og utrulling:** `apps/server/dist/` har `index.js`, `migrate.js` og en `package.json` med de eksterne avhengighetene. I CI lages serverens lockfil fra rot-lockfilen, og `deploy/check-lock.mjs` stopper utrullingen hvis versjonene avviker. Actions er festet til commit-SHA. Ved feil etter at mappene er byttet, rulles det tilbake. Migreringer rulles ikke tilbake, så de må være bakoverkompatible.
- **Web:** menyen har bare «Mine spill» og «Konto». Valgene for et spill kommer i fase 2–4. Brytepunktet er 700 px, som i kapittel 8. `--dim` er `#6f604c` og `--nav-dim` er `#a8957a`, litt mørkere og lysere enn skissen, for å nå WCAG AA. Sentral håndtering i QueryClient: 401 sender til `/logg-inn`, og 403 `blocked` viser «Kontoen er sperret».
- **Kysely 0.29:** `Migrator` og `Migration` importeres fra `kysely/migration`.

## Beslutninger under fase 2a (regelmotoren)

- **Fixtures:** `packages/rules/fixtures/elowen-4.json` (Gloom Stalker Ranger 4) og `lego-ranger-5.json` (Hunter Ranger 5) er ekte D&D Beyond-svar, anonymisert med `npm run fixture -w @dnd/rules`. Karakter-ID-en er byttet til 1000001 og 1000002. `userId`, `username`, `campaign`, `readonlyUrl` og `decorations` er nullet ut. Skriptet stopper hvis den ekte ID-en finnes i utdataene.
- **`Sheet`** (`src/sheet.ts`, `DERIVE_VERSION = 1`):
  - Feltene er nær prototypen.
  - Fjernet: `id`, `avatar` og `v`. D&D Beyond-ID-en lagres i `dd_characters.ddb_id`.
  - Lagt til: `classes`, `summary`, `resources` (alle `limitedUse` med stabile nøkler), `hitDice` (per terningstørrelse, nøkler som `'d10'`), `shield`, `pactSlots` og `slotsUsed`.
  - `castAb`, `spellDc` og `spellAttack` kan være `null`.
- **Gjenstander:**
  - `modifiers.item` brukes ikke, fordi D&D Beyond tar med alle gjenstander i inventory, også de som ikke er utrustet. I stedet telles `grantedModifiers` på gjenstander som virker: utrustet eller `canEquip false`, attunet når det kreves, og ikke forbruksgjenstander.
  - Spells fra gjenstander følger samme regel. En Potion of Speed gir derfor ikke Haste.
- **Rase fra 2014 med bakgrunn fra 2024:** Rasens `*-score`-bonuser telles ikke når `race.isLegacy` er sann og bakgrunnen gir økninger i evneverdier (feat fra `background.grantedFeats` eller `__INITIAL_ASI` med `bonus/*-score`). D&D Beyond gjør det samme.
- **Weapon Mastery** gjelder bare når den er valgt for våpentypen. Nick som egenskap ved våpenet alene gir ikke Nick-regelen.
- **Spell slots:** én caster-klasse bruker klassens egen tabell. Multiclass bruker 2024-tabellen: full caster teller fullt, half rundes opp og third rundes ned. Warlock har Pact Magic for seg.
- **`resetType`:** 2 = Long Rest (sett i data), 1 = Short Rest (antatt), alt annet = `other`.
- **`attacksPerAction`** leses fra `set/extra-attacks`, med navnet «Extra Attack» som reserve. Initiativ tar med `statId`-bonuser, `ability-checks` og halv proficiency. Den faste reserven «Dread Ambusher → WIS» er fjernet.
- **Følgesvenner:**
  - `seedPetTraits` tar en funksjon som lager ID-ene, og bruker ikke `Math.random`.
  - Følgesvenner som legges inn for hånd har typen `Companion`, med `initiativeBonus`, `hpMax` og `ac`. Ugla med fast +1 er borte.
- **Import** (`src/import.ts`):
  - `initialGameState`, `mergeOnRefresh` og `newFeatures`.
  - Kjæledyr som er borte fra D&D Beyond, beholder trekk og HP i `GameState`, så de er der hvis dyret kommer tilbake.
  - `shortRest` og `longRest` kommer i 2b.

## Status

- **Fase 0 og 1 er ferdige** (4. november 2026). Appen kjører på `https://dnd.3lin.no`, innlogging med Google virker på mobil og laptop, og push til `main` ruller ut automatisk.
  - Lint, typecheck, test (135 tester), build og `prettier --check` går gjennom.
  - Alle funn fra de uavhengige testene er rettet.
- **Lærdom fra første utrulling:**
  - Sudo på serveren tillater bare `npm` og `pm2` som kjøringsbrukeren, ikke `node`. Migreringen kjøres derfor med `npm run migrate` (skriptet ligger i `dist/package.json` og leser `../.env`).
  - `WEB_DIR=/var/www/dnd/client` må stå i `/var/www/dnd/.env`. Uten den svarer `/` med JSON 404.
  - Nginx-filen på serveren bruker `localhost:8032`. `127.0.0.1:8032`, som i `deploy/nginx/dnd.3lin.no`, er anbefalt.
- **Kjent:**
  - jsdom 30 krever Node ^22.22.2, men WSL har 22.21.1. Det virker, men oppdater med `nvm install 22`.
  - `npm audit --omit=dev` gir 3 moderate funn via `@fastify/static` → `glob` → `minimatch`. Ikke bruk `audit fix --force`.
  - TypeScript står på 6.0.3, fordi typescript-eslint ennå ikke støtter 7.
  - `dd_`-vernet hindrer feil i migreringene, men databasebrukeren har tilgang til hele `prodbase`. En egen databasebruker er anbefalt (`deploy/README.md` §10).
- **Fase 2a er ferdig** (4. november 2026). `deriveCharacter` gir Elowens tall fra D&D Beyond: HP 40, AC 14, Init +6, Longbow +7 1d8+3 og alle saves og skills som er sjekket. Lint, typecheck, test (194 tester), build og `prettier --check` går gjennom, og alle funn fra den uavhengige valideringen er rettet.
  - **Lego-rangeren er sjekket mot D&D Beyond-arket:** DEX 18, AC 18, Init +4, HP 39, Longbow +9 1d8+4, Perception +9, og alle saves og skills.
  - **Ikke sett i ekte data:** multiclass, third casters, `resetType` 1 og `operator` 2 på `limitedUse`. Disse er bare testet med håndlagde objekter.
- **Neste fase:** 2b. Det omfatter tabellene `dd_characters`, `dd_games` og `dd_game_state`, henting fra D&D Beyond med en grense per bruker, Mine spill og Nytt spill, ark og følgesvenner, og HP, Short Rest og Long Rest. Den tas i en ny tråd.
