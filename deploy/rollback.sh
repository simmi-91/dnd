#!/bin/bash
# Manuell rollback for D&D-appen: bytter tilbake til server_old og client_old.
# Bruk på serveren (brukeren er påkrevd):
#   sudo bash /var/www/dnd/rollback.sh <bruker-som-kjører-pm2>
#
# Advarsel: databasemigreringer rulles IKKE tilbake. Den gamle koden må tåle
# det nye skjemaet.
set -euo pipefail

APP_DIR="/var/www/dnd"
ENV_FILE="$APP_DIR/.env"
PM2_NAME="dnd"
DEPLOY_USER="${1:-}"

# Uten bruker ville pm2 kjørt som root, altså mot feil pm2-daemon
if [ -z "$DEPLOY_USER" ]; then
  echo "Bruk: $0 <bruker-som-kjører-pm2>" >&2
  echo "Brukeren må oppgis (samme som DEPLOY_RUN_AS_USER)." >&2
  exit 1
fi

# Kjør pm2 som riktig bruker
pm2_run() {
  sudo -u "$DEPLOY_USER" pm2 "$@"
}

cd "$APP_DIR"

if [ ! -d server_old ] || [ ! -d client_old ]; then
  echo "Feil: server_old eller client_old finnes ikke, så det er ingenting å rulle tilbake til."
  exit 1
fi

echo "Ruller tilbake..."
pm2_run stop "$PM2_NAME" || true

# Den feilende versjonen beholdes som *_bad for feilsøking
rm -rf server_bad client_bad
mv server server_bad
mv client client_bad
mv server_old server
mv client_old client

pm2_run restart "$PM2_NAME" \
  || pm2_run start "$APP_DIR/server/index.js" --name "$PM2_NAME" \
    --cwd "$APP_DIR/server" --node-args="--env-file=$ENV_FILE"

# Helsesjekk
HEALTHY=false
for i in $(seq 1 10); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8032/api/health || true)
  if [ "$STATUS" = "200" ]; then
    HEALTHY=true
    break
  fi
  echo "Forsøk $i/10: fikk ${STATUS:-000}, prøver igjen om 5 s..."
  sleep 5
done

if [ "$HEALTHY" != "true" ]; then
  echo "Helsesjekken feilet etter rollback. Se: pm2 logs $PM2_NAME"
  exit 1
fi

pm2_run save
echo "Rollback ferdig. Den feilende versjonen ligger i server_bad og client_bad."
echo "Slett dem når du er fornøyd: rm -rf $APP_DIR/server_bad $APP_DIR/client_bad"
