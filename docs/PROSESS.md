# Prosess og Orkestrering (Kun Hovedagent)

Denne filen leses **kun** av hovedagenten for planlegging, trådstyring og delegering. Subagenter/workers skal KUN forholde seg til `CLAUDE.md` og sin spesifikke deloppgave.

---

## 1. Delegering og Worker-arkitektur

- **Del opp i tette rammer:** Identifiser berørte mapper og filer før en worker startes. Gi hver worker eierskap til sine filer.
- **Minimer spesifikasjoner til workers:** Workers skal ikke kjenne til hele prosessen, bare sin isolerte deloppgave og de tekniske kravene i `CLAUDE.md`.
- **Modellvalg per worker-type:**
  - **Opus:** Kompleks logikk, sikkerhet/auth, sesjoner, regelmotoren (`deriveCharacter`), design/arkitektur-beslutninger.
  - **Sonnet:** Standard funksjonalitet, oppsett, konfigurasjon, utrulling, API-ruter, rutinekode.
  - **Haiku:** Enkle mekaniske endringer, refakturering av type-definisjoner, formatering, enkle tester.

---

## 2. Tråd- og Kontekststyring (Token-sparing)

- **Én tråd per del-fase:** Faser deles opp i sub-tråder (f.eks. `2a regelmotor`, `2b spill/følgesvenner`, `3a kataloger`, `3b kampskjerm`).
- **Skjerming av historikk:** Når en subagent er ferdig, hente kun _oppsummert resultat_ eller _diff_ inn i hovedtråden. Ikke lim inn lange test-utskrifter eller feillogger.
- **Kontekstnullstilling (`/compact`):** Kjør komprimering eller start ny tråd så snart et delkapittel/fase er godkjent og klar for commit.

---

## 3. Kvalitetssikring (Uavhengig Validator-worker)

1. **Kode-skriving:** Worker A fullfører sin deloppgave.
2. **Uavhengig sjekk:** Start Worker B (en ren validator-worker) for å verifisere endringene.
   - Kjører `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` og `npx prettier --check .`.
   - Tester funksjonaliteten mot kravspesifikasjonen uten å ha skrevet koden selv.
3. **Retting:** Worker A retter eventuelle funn fra Worker B.

---

## 4. Arbeidsflyt for Avslutning og Commit

- **Repo-status fremfor chat-minne:**
  - Oppdater sjekklisten i kapittel 10 i `docs/UTVIKLINGSPLAN.md`.
  - Oppdater status og nye beslutninger i `docs/AVKLARINGER.md`.
- **Godkjenning:** Be brukeren eksplisitt om bekreftelse før git commit eller push utføres.
- **Nullstill tilstand:** Etter commit er fullført, avslutt tråden slik at neste tråd starter på en ren, frisk tilstand.
