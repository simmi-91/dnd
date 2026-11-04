# D&D 5e Kampguide (2024-regler)

- **Utviklingsplan:** `docs/UTVIKLINGSPLAN.md` (beslutninger, datamodell, API, faser).
- **Referanse & Design:** Prototyp i `reference/prototype/` (rør ikke). Designskisser i `docs/design/` (Variant B «Pergament»).
- **Språk:** Norsk i appen, engelske D&D-regelord. Brukeren skriver norsk[cite: 1].
- **Database:** Prefiks `dd_` på alle tabeller (delt DB)[cite: 1]. Lokal MySQL i Docker via WSL[cite: 1].
- **Utrulling:** Følg mønster i `deploy/`[cite: 1]. GitHub Actions ruller ut fra `main`[cite: 1].
- **Prosess & Orkestrering:** Se `docs/PROSESS.md` (kun for hovedagent).

## Kommandoer & Konvensjoner

- **Node (WSL):** `wsl.exe -d Ubuntu-24.04 -- bash -ic 'cd ~/_server_/dnd && <kommando>'` (Node 22 via nvm)[cite: 1].
- **Skript (rota):** `npm run dev` (server 8032, Vite 5173), `lint`, `typecheck`, `test`, `build`, `prettier --check`, `format`, `migrate`[cite: 1].
  - Pakke-filter: `-w @dnd/server`, `-w @dnd/web`, `-w @dnd/rules`, `-w @dnd/shared`[cite: 1].
- **Krav før ferdigstilling:** `lint`, `typecheck`, `test`, `build` og `prettier --check` skal være grønne[cite: 1].
- **Miljø:** Lokal i `apps/server/.env` (se `.env.example`)[cite: 1]. Prod: `/var/www/dnd/.env`[cite: 1]. Tester bruker `TEST_DB_NAME` (`dnd_test`), aldri `DB_NAME`[cite: 1].
- **Innlogging:** Dev-login på `/api/auth/dev-login` når `DEV_LOGIN_EMAIL` er satt[cite: 1].
- **API:** Kontrakt i `packages/shared`[cite: 1]. Skrivende kall krever `X-Requested-With: dnd`[cite: 1].
- **Sikkerhet:** Offentlig repo – ingen hemmeligheter, `.env`-innhold eller ekte D&D Beyond-ID-er[cite: 1].

## Regler for workers og token-hygiene

1. **Én tråd/worktree per oppgave:** Bare én tråd endrer filer om gangen[cite: 1]. Bruk egne worktrees ved parallelt arbeid[cite: 1].
2. **Korte svar & Diffs:** Svar så kort som mulig. Returner kodedifferanser framfor å skrive om hele filer uoppfordret. Ikke print lange test-utskrifter til chatten; referer til filnavn og linjenummer.
3. **Kontekstnullstilling:** Kjør `/compact` eller be hovedagenten om ny tråd så snart en isolert sub-oppgave er ferdig.
4. **Status & Commit:** Oppdater `UTVIKLINGSPLAN.md` og `AVKLARINGER.md` når en fase er ferdig[cite: 1]. Ikke commit eller push uten eksplisitt tillatelse fra brukeren[cite: 1].
