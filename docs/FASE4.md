# Forberedelse av fase 4 – Kampanjebok

5. november 2026. Utkast. Ingen kode før fase 3 er ferdig og committet. Når fasen starter, flyttes beslutningene herfra til `AVKLARINGER.md` («Beslutninger under fase 4»), og fila slettes.

Grunnlag: kapittel 4, 5.1, 8 og 10 i `UTVIKLINGSPLAN.md`, skissene i `docs/design/kampanjebok.html` og mønstrene fra fase 2b (`games/repo.ts`, `stateSync.ts`).

## 1. Avhengigheter til fase 3

| Hva | Hvorfor |
| --- | --- |
| Migrering `0003` (`dd_combats`) | Fase 4 blir `0004_campaign_book`. Må være bakoverkompatibel (bare nye tabeller) |
| Menyen i `GameLayout`/`Shell` | Fase 3 legger til «Kamp». Fase 4 legger til «Kampanjebok» (bunnmeny: Kamp · Ark · Følge · Bok, sidemeny med gruppe KAMPANJEBOK). Ta det etter fase 3 for å unngå konflikt |
| Kampskjermen | Hurtignotatet (flytende knapp på mobil, felt i høyre kolonne på laptop) kan først bygges når skjermen finnes. Egen deloppgave til slutt (4e) |

## 2. Tekniske funn

- **FULLTEXT og migreringsvernet:** Kysely 0.29 har ikke FULLTEXT-indekser (`createIndex` har bare `unique` og `using`), og `prefix-guard.ts` nekter rå SQL utenom tillatelseslisten. Vernet må utvides med en fast hjelper for `CREATE FULLTEXT INDEX` som fortsatt sjekker `dd_`-prefikset på tabellen. Dette er sikkerhetskode og skal ha tester (Opus).
- **Søk:** `innodb_ft_min_token_size` = 3 i prod, og InnoDB bruker en engelsk stoppordliste. Forslag: `MATCH … AGAINST (? IN BOOLEAN MODE)` med `ord*` per ord og operatorene (`+-<>()~*"@`) fjernet fra brukerens tekst. Ord under 3 tegn faller tilbake til `LIKE`.
- **Kollasjon:** `utf8mb4_unicode_ci` gjør `UNIQUE(game_id, kind, name)` uavhengig av store/små bokstaver. Det er ønsket («brann holt» = «Brann Holt»). Den behandler også `å` og `a` likt, så «Grålia» og «Gralia» kolliderer. Godtas, med en tydelig 409-melding.
- **Lagringsformat:** `@[Navn](e:42)`, `#[Navn](e:7)`, `![Navn](e:9)`. Prefikset bestemmer typen. Teksten tolkes ikke som Markdown, så `![…](…)` krasjer ikke med bildesyntaks.
- **Tolkeren** (tekst → tokens, tokens → `dd_mentions`) er ren kode uten D&D-regler. Den legges i `packages/shared` med tester, slik at web (visning) og server (lagring) bruker den samme.
- **Samme mønster som `dd_game_state`:** `version` på `dd_sessions` og `dd_entries`, `UPDATE … WHERE version = ?`, og 409 med gjeldende data.

## 3. Beslutninger som trengs (anbefaling først)

1. **Hvilken tekst vises for en kobling?** Anbefalt: teksten som ble skrevet (`!finne karavanen` leses naturlig i en setning), lenket til oppføringen via ID. Detaljkortet viser det gjeldende navnet. Alternativ: alltid gjeldende navn.
2. **«Opprett «…»» i autofullføringen.** Anbefalt: lagres som `@[Navn](new)`, og serveren oppretter oppføringen ved lagring og svarer med teksten der `new` er byttet ut med ID-en. Web tar inn serverens tekst bare hvis brukeren ikke har skrevet videre i mellomtiden, ellers ved neste lagring.
3. **409 på fritekst.** Å kaste det brukeren har skrevet er verre enn i `game_state`. Anbefalt: web beholder sin tekst, henter ny `version` og viser «Økta ble endret på en annen enhet» med valgene *Behold min* / *Bruk den andre*.
4. **«Økta i dag».** Anbefalt: åpnes dagboka og det ikke finnes en økt med dagens dato, vises en tom skriveflate. Økta opprettes ved første lagring, med `number` = høyeste + 1. Hurtignotatet gjør det samme.
5. **Skriveflaten.** Skissen viser fargede koblinger mens man skriver. Alternativer: (a) `textarea` med fargelag bak (lett, naturlig tastatur på mobil, men koblingene vises som `@Navn` uten lenke mens man skriver), (b) TipTap/ProseMirror med Mention-utvidelse (fargede brikker, tyngre, må serialisere til formatet over). Anbefalt: en kort prøve i starten av 4c på mobil, med (a) som standard hvis den holder.
6. **Slettet oppføring som er nevnt i tekst.** Anbefalt: lenken vises som vanlig tekst, og `dd_mentions` ryddes med `ON DELETE CASCADE`. Arkivering (`archived`) er standardvalget i UI-et, sletting ligger bak en bekreftelse.
7. **Typen `other`** har ingen tegn i dagboka. Anbefalt: opprettes bare fra oppslagsverket.

## 4. Deloppgaver

| Del | Innhold | Filer (eierskap) | Modell |
| --- | --- | --- | --- |
| **4a** Grunnlag | Migrering `0004` (`dd_sessions`, `dd_entries`, `dd_mentions`, FULLTEXT). FULLTEXT-hjelper i vernet med tester. Zod-skjemaer og typer. Tolkeren med tester (format, `new`, navn med mellomrom og `]`, ugyldige ID-er) | `apps/server/src/db/**`, `packages/shared/src/campaign.ts`, `packages/shared/src/mentions.ts` | Opus |
| **4b** API | Repo og ruter fra 5.1: økter, oppføringer, `search`, `suggest`. Lagring i én transaksjon: tolk, opprett manglende, bygg `dd_mentions` på nytt. Sjekk at `fields`-ID-er og `e:ID` hører til samme spill og bruker. 409, CSRF, 404 for andres spill | `apps/server/src/campaign/**`, `apps/server/src/routes/campaign.ts`, `app.ts` (registrering) | Sonnet |
| **4c** Dagbok | Skriveflate, `@ # !`-knapper, autofullføring, visning med farger, listen over økter, registeret til høyre på laptop, autolagring med versjon | `apps/web/src/pages/book/Journal*`, `apps/web/src/api/campaign.ts`, `apps/web/src/state/` (ny synk for tekst) | Opus (editor og synk) |
| **4d** Oppslagsverk | Faner Quester/Personer/Steder/Økter med antall, liste, detaljkort med felter, «Nevnt i økter», søk, ny/endre/arkiver, rutene, menypunktet | `apps/web/src/pages/book/Entries*`, `Search*`, `App.tsx`, `GameLayout`/`Shell` | Sonnet |
| **4e** Hurtignotat | Knappen i kamp som legger tekst til økta i dag | Kampskjermen fra fase 3 | Sonnet |

Rekkefølge: 4a → 4b → (4c ‖ 4d i hver sin worktree) → 4e. Etter hver del kjører en validator-worker lint, typecheck, test, build og `prettier --check`, og tester mot «Ferdig når» uten å ha skrevet koden.

**Ruter (forslag):** `/spill/:id/bok` (oppslagsverk, fanen i `?fane=`), `/spill/:id/bok/:entryId`, `/spill/:id/dagbok`, `/spill/:id/dagbok/:sessionId`.

## 5. Ferdig når (fra planen, gjort testbar)

Validatoren skriver i dagboka for «Icewind Dale»: `@Brann Holt`, `#Eldmark` og `!finne karavanen` (alle nye). Uten flere steg skal oppslagsverket vise én person, ett sted og én quest, hver med «Nevnt i økter: Økt N». Søk på «karavan» finner både økta og questen. Dette skal også virke etter omlasting og fra en annen enhet.
