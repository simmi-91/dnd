# D&D kampguide

Kampguide og kampanjebok for D&D 5e (2024-reglene). Brukes på mobil og laptop ved spillebordet.

- **Start med `docs/UTVIKLINGSPLAN.md`.** Den har beslutningene, datamodellen, API-et og fasene.
- Prototypen ligger i `reference/prototype/` og er bare referanse. Den skal ikke bygges eller endres.
- Designskisser ligger i `docs/design/`. Variant B «Pergament» er valgt.
- Brukeren skriver norsk. Teksten i appen er norsk, med engelske regelord fra D&D.
- Databasen er delt med andre prosjekter. Alle tabeller skal ha prefikset `dd_`, og ingen migrering skal røre andre tabeller.
- Utrulling, Node-kjøring og Google-innlogging skal følge mønsteret i brukerens andre prosjekter i WSL.
- Utviklingen skjer mot en lokal MySQL i Docker. WSL har ikke tilgang til produksjonsserveren. Serverkonfigurasjon lages som filer i `deploy/`, og brukeren installerer dem selv.

## Arbeidsmåte (gjelder alt arbeid i prosjektet)

1. **Del opp i workers.** Hovedagenten planlegger og deler oppgaven i avgrensede deler med tydelige grenser (hvilke mapper og filer hver del eier, og hvilke navn, skript og miljøvariabler de deler). Hver del gjøres av en egen worker (subagent).
2. **Velg modell etter oppgaven.** Opus for vanskelig logikk, sikkerhet (innlogging, sesjoner), regelmotoren og design. Sonnet for oppsett, konfigurasjon, utrulling og rutinekode. Haiku for enkle, mekaniske endringer.
3. **Uavhengig test.** Når arbeidet er gjort, går en annen worker, som ikke skrev koden, gjennom det mot planen og kjører lint, typecheck, test, build og en ekte kjøring. Funn rettes og testes på nytt.
4. **Først da** kan hovedagenten si at noe er klart for commit. Ikke commit eller push uten at brukeren ber om det.

## Tråder og overlevering

- **Én tråd per fase.** Store faser deles: 2a regelmotoren (`deriveCharacter`), 2b spill, ark og følgesvenner, 3a kataloger og `turReducer`, 3b kampskjermene og synk. Feilretting og nye ønsker får egne, korte tråder.
- **Status ligger i repoet, ikke i chatten.** Ny tråd leser `CLAUDE.md`, `docs/UTVIKLINGSPLAN.md` og `docs/AVKLARINGER.md`, lager en kort plan og venter på godkjenning.
- **Når en fase er ferdig:** kryss av i kapittel 10 i `UTVIKLINGSPLAN.md`, oppdater «Status» i `AVKLARINGER.md`, og før inn nye beslutninger der. Så commit når brukeren ber om det, slik at neste tråd starter på en ren tilstand.
- **Bare én tråd endrer filer om gangen.** Skal noe gjøres parallelt, får den andre tråden sin egen worktree.
