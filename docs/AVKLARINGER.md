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

## Status

- **Worker A (grunnoppsett) er ferdig og uavhengig testet.** Avhengighetene har faste versjoner, og `package-lock.json` er laget. `npm ci`, lint, typecheck, test, build og `prettier --check` går gjennom.
  - TypeScript står på 6.0.3, fordi typescript-eslint ennå ikke støtter 7.
  - `@types/node` står på ^22, som `.nvmrc`.
  - jsdom 30 krever Node ^22.22.2, men WSL har 22.21.1. Det virker foreløpig. Oppdater med `nvm install 22`.
  - `npm audit --omit=dev` gir 3 moderate funn, alle via `@fastify/static` → `glob` → `minimatch`. Følg med på en ny versjon. Ikke bruk `audit fix --force`, som nedgraderer.
- Neste steg: worker for `apps/server` (Opus for innlogging og sesjoner) og migreringer. `apps/server/build.mjs` er fortsatt en stubb som ikke lager `dist/`. Etter det kommer `apps/web`, så `deploy/` og CI.
