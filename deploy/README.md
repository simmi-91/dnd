# Utrulling av D&D kampguide

Appen kjører på `https://dnd.3lin.no`. Nginx sender alt til Node (Fastify) på port 8032, og Node serverer også den bygde nettsiden. Pm2 kjører prosessen `dnd`. Push til `main` ruller ut via GitHub Actions (`.github/workflows/deploy.yml`).

Repoet er offentlig, og det er Actions-loggene også. Skriv aldri ut `.env` eller secrets i skript.

## 1. Mapper og rettigheter

```bash
sudo mkdir -p /var/www/dnd/img
sudo chown -R <DEPLOY_RUN_AS_USER>:<DEPLOY_RUN_AS_USER> /var/www/dnd
```

Oppbygging:

| Sti                          | Innhold                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `/var/www/dnd/.env`          | Miljøvariabler. Lages for hånd, og utrullingen overskriver den aldri          |
| `/var/www/dnd/client/`       | Bygd nettside (`apps/web/dist`)                                               |
| `/var/www/dnd/server/`       | `index.js`, `migrate.js`, `package.json`, `package-lock.json`, `node_modules` |
| `/var/www/dnd/img/`          | Opplastede bilder. Utrullingen rører den ikke                                 |
| `client_old/`, `server_old/` | Forrige versjon, brukes til rollback                                          |

Kjøringsbrukeren (`DEPLOY_RUN_AS_USER`) må kunne lese `.env`. Deploy-brukeren (`SERVER_USER`) må kunne kjøre `sudo` uten passord, som i de andre prosjektene.

## 2. `/var/www/dnd/.env`

Lag filen selv, med `chmod 600` og eier `DEPLOY_RUN_AS_USER`. Fyll inn verdiene.

```
PORT=8032
NODE_ENV=production
DB_HOST=
DB_PORT=
DB_USER=3lin_web
DB_PASSWORD=
DB_NAME=prodbase
GOOGLE_CLIENT_ID=
SESSION_TTL_DAYS=60
DDB_CACHE_SECONDS=
WEB_DIR=/var/www/dnd/client
IMAGE_DIR=/var/www/dnd/img
```

`DEV_LOGIN_EMAIL` skal ikke settes i produksjon.

## 3. Nginx og certbot

Filen `deploy/nginx/dnd.3lin.no` er en kopi. Den virkelige filen ligger på serveren i `/etc/nginx/sites-available/dnd.3lin.no`.

```bash
sudo cp dnd.3lin.no /etc/nginx/sites-available/dnd.3lin.no
sudo ln -s /etc/nginx/sites-available/dnd.3lin.no /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d dnd.3lin.no
```

Peker DNS-posten for `dnd.3lin.no` til serveren først. Certbot legger TLS-oppsettet inn i filen. Kopier gjerne den ferdige filen tilbake til `deploy/nginx/`.

## 4. Pm2

Utrullingen starter prosessen første gang, men oppsettet kan også gjøres for hånd som `DEPLOY_RUN_AS_USER`:

```bash
pm2 start /var/www/dnd/server/index.js --name dnd \
  --cwd /var/www/dnd/server --node-args="--env-file=/var/www/dnd/.env"
pm2 save
pm2 startup   # kjør kommandoen den skriver ut, som root (bare første gang på serveren)
```

Utrullingen kjører `pm2 save` etter hver restart. Sjekk at `pm2 startup` allerede er satt opp for brukeren hvis de andre appene kjører under samme bruker.

## 5. Secrets i GitHub

Under Settings, Secrets and variables, Actions i `simmi-91/dnd`:

- `SERVER_HOST`
- `SERVER_USER`
- `SERVER_SSH_KEY`
- `DEPLOY_RUN_AS_USER`

Ingen andre secrets trengs. Google client ID hentes fra serveren (`GET /api/auth/config`).

## 6. OAuth-klient i Google Cloud

Under APIs and Services, Credentials: lag en OAuth client ID av typen Web application, med Authorized JavaScript origins:

- `https://dnd.3lin.no`
- `http://localhost:5173`

Legg client ID-en i `GOOGLE_CLIENT_ID` i `.env`. Ingen redirect-URI trengs (ID-token-flyten).

## 7. Første utrulling

1. Ha mapper, `.env`, nginx og secrets på plass.
2. Push til `main`, eller start workflowen manuelt (Actions, Deploy D&D, Run workflow).
3. Workflowen kjører `check` (lint, typecheck, prettier, test mot MySQL 8.0), så `deploy`.
4. `deploy` bygger, sender `client/` og `server/` til `/tmp/dnd-deploy-<run_id>`, bytter `server` til `server_old` og `client` til `client_old`, flytter inn de nye mappene, kjører `npm ci --omit=dev`, kjører migreringen, starter pm2 og helsesjekker `http://127.0.0.1:8032/api/health`.
5. Ved feil i et steg etter byttet av mapper (rettigheter, `npm ci`, migrering, pm2 eller helsesjekk) rulles koden tilbake til `*_old`, og jobben feiler. `pm2 save` stopper ikke utrullingen. Appens logger skrives ikke til Actions-loggene (de er offentlige): se dem på serveren med `pm2 logs dnd`. Ved første utrulling finnes ingen forrige versjon, så prosessen bare stoppes.
6. Til slutt ryddes `/tmp/dnd-deploy-<run_id>`.

**Migreringen kan ikke rulles tilbake.** Den kjører etter at den nye koden ligger på plass, men før pm2 restartes. Feiler helsesjekken etterpå, går koden tilbake, men databaseskjemaet beholder endringene. Skriv derfor migreringer som den forrige versjonen tåler (legg til kolonner og tabeller, ikke fjern eller gi nytt navn i samme utrulling).

## 8. Rollback

Automatisk ved feilet migrering, `npm ci` eller helsesjekk. For manuell rollback på serveren:

```bash
sudo bash /var/www/dnd/rollback.sh <DEPLOY_RUN_AS_USER>
```

Brukeren må oppgis. Uten den avbryter skriptet, så pm2 ikke kjøres som root (feil pm2-daemon).

Skriptet (kopier det fra `deploy/rollback.sh` til `/var/www/dnd/rollback.sh` første gang, og `chmod +x`) bytter `server`/`client` til `server_old`/`client_old`, beholder den feilende versjonen som `server_bad`/`client_bad`, restarter pm2 og helsesjekker. Det rører ikke databasen.

## 9. Sperre og åpne en bruker

Alle med Google-konto kan logge inn. Sperring gjøres med SQL og virker med en gang, siden `blocked` sjekkes på hvert kall:

```sql
UPDATE dd_users SET blocked = 1 WHERE email = 'person@example.com';
-- Oppheve sperringen:
UPDATE dd_users SET blocked = 0 WHERE email = 'person@example.com';
```

## 10. Delt database

Databasen `prodbase` deles med andre prosjekter. Alle tabeller i dette prosjektet har prefikset `dd_`, og migreringen (`dd_migrations`, `dd_migrations_lock`) skal bare røre `dd_`-tabeller.

Hva vernet dekker, ærlig sagt:

- Migratoren nekter tabellnavn uten `dd_` og rå SQL. Det er en sikring mot feil, ikke en garanti. Kode med databasetilgang kan fortsatt gjøre mer enn vernet fanger opp.
- Les migreringene (`apps/server/src/db/`) før de kjøres mot `prodbase`. Utrullingen kjører dem automatisk ved push til `main`.
- Brukeren `3lin_web` deles med andre prosjekter og har trolig brede rettigheter, så databasen hindrer ingenting.

**Anbefaling: en egen MySQL-bruker for dette prosjektet** (bruk den som `DB_USER` i `.env`), som bare får rettigheter på `dd_`-tabellene. MySQL har ikke jokertegn for tabellnavn i `GRANT`: `%` og `_` virker bare i databasenavn (`db_navn`.`*`), ikke i tabellnavn. Det finnes derfor to ryddige løsninger:

1. Rettigheter per tabell, med en liste over `dd_`-tabellene. Tabellene kan få rettigheter før de finnes, men listen må utvides for hver ny tabell en migrering lager (og migratoren trenger `CREATE`, `ALTER`, `DROP`, `INDEX`, `REFERENCES` på dem):

   ```sql
   CREATE USER 'dd_app'@'localhost' IDENTIFIED BY '<passord>';
   GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES
     ON prodbase.dd_users TO 'dd_app'@'localhost';
   GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES
     ON prodbase.dd_auth_sessions TO 'dd_app'@'localhost';
   GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES
     ON prodbase.dd_migrations TO 'dd_app'@'localhost';
   GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES
     ON prodbase.dd_migrations_lock TO 'dd_app'@'localhost';
   -- ...en linje per ny dd_-tabell
   ```

2. En egen database (for eksempel `dnd`) med `GRANT ALL ON dnd.* TO 'dd_app'@'localhost'`, som planteapp2 gjør. Da er skillet fullstendig og listen slipper å vedlikeholdes, men `DB_NAME` må endres, og tabellene i `prodbase` flyttes ikke av seg selv.

Verifiser etterpå med `SHOW GRANTS FOR 'dd_app'@'localhost';`.
