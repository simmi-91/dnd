# Elowens kampguide – designvalg og byggebeskrivelse

Nov 3, 2026 · @Elin

## Formål

Appen er et kampark for en nybegynner som spiller D&D 5e (2024-reglene) med fysiske terninger. Den skal svare på ett spørsmål ved bordet: hva kan jeg gjøre nå, og hva skal jeg si til DM?

Dokumentet beskriver valgene i prototypen som ligger som en artifact i Claude, slik at en ny versjon kan bygges for egen server og brukes på mobil og PC. Prototypen er laget for én karakter, Elowen Windstrider (Wood Elf Gloom Stalker Ranger, nivå 4), med to isbjørner og en ugle, men all utregning er generell og leser D&D Beyond-data.

Krav som styrte valgene:

- Ingen tall skrevet inn for hånd. Alt regnes ut fra D&D Beyond, så arket følger med ved level up.
- Spilleren ruller med ekte terninger og skriver inn tallet. Appen legger til bonuser og summerer.
- Valg som ikke lenger er mulige i turen blir grå og kan ikke trykkes.
- Én fane per deltaker i kampen, så man slipper å bla.
- Egne trekk på følgesvenner som D&D Beyond ikke støtter.

## Funksjoner i dagens versjon

Appen har fire hovedfaner: Kamp, Ark, Bjørner og Tips. I tillegg kommer en henteknapp for D&D Beyond øverst.

| Del | Hva den gjør |
| --- | --- |
| Toppfelt | Navn, rase, subclass, nivå og seks nøkkeltall: HP, AC, initiative, speed, darkvision og passiv perception |
| Oppdater fra D&D Beyond | Henter karakteren på nytt og regner alt ut igjen. Viser et kort med nye evner når nivået har gått opp |
| Kamp: oppsett | Skriv inn initiative for hver deltaker. Bryter for mørke (Umbral Sight) og for om ugla er med |
| Kamp: runde | Rundenummer, «Ny runde» og «Avslutt kamp». Faner per deltaker, sortert etter initiative, med ✓ for den som har spilt |
| Kamp: Elowens fane | HP med skade og helbreding, ressurser, action-økonomi, valg for bonus action og action, angrepsflyt med treff og skade |
| Kamp: bjørnefane | HP, Animal Handling-sjekk om den har det trekket, Multiattack med to angrep |
| Kamp: uglefane | Help (advantage på Elowens neste angrep) eller noe annet |
| Kamplogg | Alle kast og handlinger i runden, lukket som standard |
| Ark | Evneverdier, saves, alle skills, våpen, spells, evner og «Hva skjer på neste nivå» |
| Bjørner | Statblokk med trekk regnet inn, notatet fra D&D Beyond, legge til og fjerne trekk, med i kamp av/på |
| Tips | Umbral Sight, Sharpshooter, advantage med ekte terninger, setninger å si til DM, Long Rest |

## Datakilden: D&D Beyond

All karakterdata kommer fra D&D Beyonds interne character-service. D&D Beyond har ikke et offisielt, dokumentert API, så formatet kan endres uten varsel ([D&D Beyond-forum](https://www.dndbeyond.com/forums/d-d-beyond-general/general-discussion/192944-api-questions)).

- Adresse: `https://character-service.dndbeyond.com/character/v5/character/{id}`. Elowens ID er 123456789.
- Krav: karakteren må være satt til Public under Character Privacy. Ellers svarer tjenesten 403.
- Svaret er JSON på ca. 330 000 tegn: `{"success":true,"data":{…}}`. Det meste er regeltekst.
- Dataene er byggeklosser, ikke ferdige tall. AC, angrepsbonuser og saves finnes ikke i svaret og må regnes ut.
- Svaret har også bruk av ressurser (`limitedUse.numberUsed`), skade tatt (`removedHitPoints`) og følgesvenner (`creatures`).

### Slik hentes dataene i prototypen

En nettside kan ikke hente adressen direkte, fordi nettleseren blokkerer kall til andre domener (CORS) og Claude-artifacts har en streng innholdspolicy. Prototypen bruker derfor nettleseren i Claude desktop-appen:

1. Siden ber appens nettleser åpne adressen i en ny fane (`preview_start`).
2. Siden leser sideteksten (`get_page_text`) og klipper ut JSON-en mellom første `{` og siste `}`.
3. Dataene regnes om til et kompakt ark på ca. 11 kB, og bare det lagres.

Reserven er å lime inn: brukeren åpner adressen, kopierer alt og limer det inn i et tekstfelt.

### Slik bør egen server gjøre det

På egen server er det enklest å hente dataene fra serveren selv, ikke fra nettleseren. Da slipper man CORS helt.

- Lag et endepunkt, for eksempel `GET /api/ddb/:id`, som henter fra character-service og sender JSON videre.
- Bufre svaret i noen minutter, og ikke hent oftere enn nødvendig. Tjenesten er ikke ment for andre, så vær forsiktig med trafikken.
- Kjør utregningen på serveren eller i nettleseren. `derive.js` er en ren funksjon uten avhengigheter og kan brukes begge steder.
- Håndter 403 (privat karakter), 404 (feil ID) og endret format med tydelige feilmeldinger.
- Behold lim inn-reserven, siden tjenesten kan stenges eller endres.

## Utregningen fra rådata til ark

Utregningen ligger i `derive.js` som funksjonen `deriveCharacter(raw)`. Den tar hele D&D Beyond-svaret og gir et kompakt ark. Alle modifikatorer samles først fra `data.modifiers` (gruppene race, class, background, item, feat og condition) i én liste.

| Verdi | Regel | Elowen nå |
| --- | --- | --- |
| Evneverdier | `stats` + `bonusStats` + alle `bonus`/`<evne>-score`. `set`-modifikatorer gir minst den verdien. `overrideStats` vinner over alt | STR 10, DEX 16, CON 17, INT 12, WIS 16, CHA 8 |
| Modifikator | (verdi − 10) / 2, rundet ned | DEX +3, CON +3, WIS +3 |
| Nivå og PB | Sum av klassenivåer. PB = 2 + (nivå − 1) / 4, rundet ned | Nivå 4, PB +2 |
| Maks HP | `overrideHitPoints`, ellers `baseHitPoints` + `bonusHitPoints` + nivå × CON-mod + HP-bonuser | 28 + 4 × 3 = 40 |
| AC | Rustning på: rustningens AC + DEX (light: full, medium: maks 2, heavy: 0). Uten: 10 + DEX. Skjold +2. Pluss AC-bonuser | Leather 11 + 3 = 14 |
| Speed | Rasens `walk`, eller `set`/`innate-speed-walking`. Pluss speed-bonuser. Roving +10 på nivå 6 hvis ingen bonus finnes fra før | 35 ft |
| Darkvision | Høyeste `set-base`/darkvision + summen av `sense`/darkvision | 60 + 60 = 120 ft |
| Initiative | DEX-mod + `bonus`/`initiative`. Har modifikatoren `statId` uten verdi, brukes den evnens modifikator | 3 + WIS 3 = +6 |
| Skills | Evne-mod + PB × (1 for proficiency, 2 for expertise) + skill-bonuser | Perception +7, Animal Handling +5 |
| Saves | Evne-mod + PB hvis `<evne>-saving-throws` er proficient | DEX +5, CON +3 |
| Våpen | Utrustede våpen. Ranged bruker DEX, finesse den beste av STR og DEX. PB hvis simple/martial er proficient. Ranged får `ranged-weapon-attacks` (Archery +2) | Longbow +7, 1d8+3 |
| Weapon Mastery | Fra `weapon-mastery`-modifikatorer, for eksempel «Slow (Longbow)», koblet på våpentype | Longbow: Slow, Scimitar: Nick |
| Spell slots | Klassens `spellRules.levelSpellSlots[klassenivå]` | 3 slots på nivå 1 |
| Begrensede ressurser | `actions[].limitedUse`: `maxUses`, eller evne-mod ved `statModifierUsesId`, eller PB. `numberUsed` er brukt | Hunter's Mark 2 gratis, Dreadful Strike 3 |
| Evner | Klassens og subclassens `classFeatures` med `requiredLevel` ≤ klassenivå. Evner opptil 3 nivåer fram vises som «kommer» | Extra Attack på nivå 5 |
| Spells | `spells` (race, class, feat, item) + forberedte `classSpells`, slått sammen på navn | Hunter's Mark, Longstrider, Find Familiar m.fl. |
| Følgesvenner | `creatures`: statblokk, AC, HP, speed, skills. Angrep tolkes fra `actionsDescription` med regex. Notater fra `characterValues` med `typeId` 47 og `valueId` lik dyrets ID | 2 Polar Bear, 2× Rend +7 |

Enkelte evner slås av og på ved navn, fordi D&D Beyond ikke gir dem som tall: Extra Attack (2 angrep), Dread Ambusher (Dreadful Strike og Ambusher's Leap), Umbral Sight, Stalker's Flurry (Dreadful Strike blir 2d8) og Foe Slayer (Hunter's Mark blir d10).

Utregningen er kjørt på de ekte dataene, og tallene i kolonnen til høyre er resultatet. Sammenlign dem med D&D Beyond-arket etter neste level up.

## Spillregler i kampflyten

Elowens tur følger action-økonomien i 2024-reglene. Turen holdes i et objekt som nullstilles hver runde: `actionType`, `attacksLeft`, `bonus`, `dsUsed`, `lightFrom`, `extraUsed`, `dash`. Hvert valg sjekker objektet og blir grått ut med en grunn når det ikke går.

| Regel | Slik er den kodet |
| --- | --- |
| Action | Én per tur. Attack, Dash, Dodge, Disengage og Hide bruker den |
| Extra Attack | Attack-actionen gir `attacksPerAction` angrep (1, eller 2 fra nivå 5). Første angrep setter `actionType`, resten teller ned `attacksLeft` |
| Bonus action | Én per tur. Hunter's Mark, flytt Hunter's Mark, og ekstra Light-angrep uten Nick |
| Light | Etter et angrep med et Light-våpen kan man ta étt ekstra angrep med et annet Light-våpen. Ingen evnemodifikator på skaden, med mindre den er negativ |
| Nick | Har våpenet som gjør ekstra-angrepet Nick, er angrepet del av Action og bruker ikke bonus action. Derfor tipset om å ta dagger først og scimitar etterpå |
| Sharpshooter | Ranged-angrep i nærkamp får ikke disadvantage. Teksten sier fra i nærkamp-modus |
| Hunter's Mark | Gratis-kast brukes først, så laveste ledige spell slot. +1d6 force per treff mens den er aktiv |
| Dreadful Strike | Én gang per tur, WIS-mod ganger per Long Rest. +2d6 psychic |
| Ambusher's Leap | +10 ft speed i runde 1 |
| Advantage | Kilder: mørke (Umbral Sight), uglas Help, Hide og «annen fordel». Advantage og disadvantage opphever hverandre. Uglas Help og Hide brukes opp på neste angrep |
| Kritisk treff | Naturlig 20 går rett til skade, og alle skadeterninger dobles. Naturlig 1 er bom |
| Konsentrasjon | Tar Elowen skade mens Hunter's Mark er aktiv, ber appen om en CON save mot DC = størst av 10 og halve skaden. Bom avslutter Hunter's Mark |
| Hide | Stealth mot DC 15. Klarer hun det, får hun advantage på neste angrep |

Et angrep går alltid i samme rekkefølge:

1. Velg våpen. Appen viser bonus, skade, rekkevidde og mastery.
2. Skriv inn d20. Ved advantage står det «rull 2d20 og skriv inn den høyeste». Action-økonomien oppdateres først nå, så «Avbryt» før kastet koster ingenting.
3. Appen viser totalen og teksten til DM. Spilleren trykker Traff eller Bom.
4. Velg ekstra skade (Hunter's Mark, Dreadful Strike), skriv inn summen per terninggruppe.
5. Appen viser skaden per type og setningen til DM, med mastery-effekten (for eksempel Slow).

## Bjørnene og egne trekk

Bjørnene hentes fra Extras på D&D Beyond, men trekkene deres lagres bare i appen. D&D Beyond kan ikke endre en monsterstatblokk, så notatfeltet der brukes som kilde for første oppsett.

| Bjørn | Notat på D&D Beyond | Trekk i appen |
| --- | --- | --- |
| Kvitebjørn (stupid) | «Stupid. Use animal handling to determine. -1 wis, +1 str» | −1 WIS, +1 STR, må adlyde med Animal Handling DC 10 |
| Salomon (crit) | «Crit hit on monstrosity – do not dmg take maximum on those dice (d6 = 6)» | Krit mot monstrosity: all skade maks |

Første gang en bjørn dukker opp, leser `seedPetTraits` notatet: `+1 str` blir et evnetrekk, ord som «crit», «monstrosity» og «maximum» blir maks-krit, og «animal handling» blir adlydsjekk. Etter det eier appen trekkene, og en ny henting rører dem ikke.

Trekktyper og virkning (`applyPetTraits`):

| Trekk | Virkning |
| --- | --- |
| Evneverdi ±n | Endrer verdien. Endres STR- eller DEX-modifikatoren, endres treff og skade på nærkamp- eller avstandsangrep like mye. CON endrer maks HP med endringen × antall hit dice |
| Treff-bonus, skade-bonus, AC, maks HP, speed | Legges rett til |
| Krit mot monstrosity: all skade maks | Ved naturlig 20 kommer bryteren «Målet er en monstrosity». På betyr ingen rulling: alle dobbelte terninger teller fullt |
| Må adlyde: Animal Handling | Før hver tur skriver spilleren inn Elowens Animal Handling-kast mot DC. Bom betyr at bjørnen ikke adlyder, og DM bestemmer |
| Notat | Bare tekst |

Det er brukerens tolkning av egne husregler som er kodet her: Salomons regel er tolket som at all skade er maks ved krit mot monstrosity, og Kvitebjørn må sjekkes hver tur.

Bjørnene har egen tur i initiativ, slik bordet spiller. Hver tur er Multiattack (2 × Rend, +7, 1d8+5 slashing) eller «noe annet». Bjørnenes HP lagres for seg og fylles opp ved Long Rest.

## Valg i brukergrensesnittet

Grensesnittet er laget for én hånd på mobil ved bordet, og fungerer likt på PC. Hvert valg under kom fra brukerens tilbakemeldinger.

| Valg | Hvorfor |
| --- | --- |
| Fysiske terninger først | Spilleren ruller ekte terninger. Hvert kast er et tallfelt (d20) eller én linje per terninggruppe (skade). «Eller rull i appen» er en liten lenke som reserve |
| Innskriving sjekkes | En d20 må være 1–20, en 2d6 må være 2–12. Ugyldige tall gir en rød melding |
| Faner per deltaker | Elowen, hver bjørn og ugla har sin fane, sortert etter initiative. Fanene står fast øverst ved blaing. Panelene skjules i stedet for å fjernes, så et angrep som er halvveis beholdes ved fanebytte |
| «Ferdig → neste» | Knappen hopper til neste deltaker som ikke har spilt. Den som har spilt får ✓. Når alle har spilt, kommer «Start runde N+1» |
| Låste valg | Valg som ikke er mulige blir grå med grunnen under, for eksempel «Action er brukt denne turen». Da lærer nybegynneren reglene underveis |
| Avstand eller nærkamp | To knapper filtrerer valgene. Nærkamp viser nærkampvåpen, Disengage og ekstra-angrep |
| «Anbefalt»-merke | Det vanlige valget for en Gloom Stalker er markert: Hunter's Mark, så Longbow |
| «Si til DM» | Etter hvert kast står setningen spilleren kan si, med tallene i |
| Avslutt kamp øverst | Brukeren ville ikke lete etter den nederst. Den står ved rundenummeret |
| Kamplogg lukket | Loggen tok plass. Den er nå en sammenleggbar boks |

### Design

- Mørkt tema som standard, med lyst tema når enheten bruker lyst. Alle farger er CSS-variabler.
- Farger har mening: gull for bonus action og Hunter's Mark, blå for action, lilla for psychic og Dreadful Strike, grønn for treff og ledig, rød for bom og skade.
- Skrift: Spectral for overskrifter, IBM Plex Sans for tekst, IBM Plex Mono for terningtall.
- Én kolonne, maks 640 px bred, minst 16 px marg, ingen sideveis blaing på 400 px skjerm.

## Lagring og tilstand

Alt som skal huskes ligger i ett dokument, `app/state`. Kampen selv er midlertidig og forsvinner når siden lukkes.

| Lagres (varig) | Midlertidig (bare i kampen) |
| --- | --- |
| `char`: det utregnede arket, ca. 11 kB | Runde, hvem sin tur, hvem som har spilt |
| `charId` og `importedAt` | Initiative-resultater |
| `elowen.hpRemoved`: skade Elowen har tatt | Turobjektet (action, bonus action, angrep igjen) |
| `res`: brukte gratis Hunter's Mark, Dreadful Strike og slots per nivå | Hunter's Mark aktiv, konsentrasjonssjekk |
| `pets[id]`: trekk, skade tatt, med i kamp | Mørke, uglas Help, skjult |
| `owl`: om ugla er med | Kamplogg |

Lagringen skjer 0,7 sekunder etter siste endring, én skriving om gangen. Hver fane får en tilfeldig `writer`-ID, slik at siden ignorerer ekkoet av sin egen skriving.

Ved ny henting fra D&D Beyond slås dataene sammen slik:

- `char` byttes alltid ut.
- HP og brukte ressurser hentes bare når brukeren slår på «Hent også HP og brukte ressurser», eller ved første henting. Appen holder styr på dem selv under spill.
- Nye bjørner får trekk fra notatet. Bjørner som finnes fra før beholder trekkene sine.
- Har nivået gått opp, vises evnene med høyere nivå enn det gamle.

På egen server bør kampen også lagres, slik at en oppdatering av siden eller bytte mellom mobil og PC midt i kampen ikke nullstiller runden.

## Anbefalt arkitektur for egen server

Anbefalingen er én liten server som både serverer nettsiden og har to API-endepunkter. Den viktigste endringen fra prototypen er at serveren henter fra D&D Beyond, slik at appen virker i alle nettlesere og ikke bare i Claude desktop-appen.

&#91;embedded content: arkitektur for egen server · 3 deler på serveren\]

Mobil og PC bruker samme nettside. Serveren henter og regner ut arket, og lagrer alt i én database, så begge enhetene ser det samme.

| Del | Forslag | Merknad |
| --- | --- | --- |
| Frontend | Behold React og `app.jsx`, eller bygg med Vite | Bytt `window.claude.use("db")` og `use("mcp")` mot `fetch` til eget API |
| Mobil | PWA: manifest og service worker | Kan legges på hjemskjermen og virke uten nett for ark og kamp |
| Server | Node med Express eller Fastify | Samme `derive.js` kan brukes uendret |
| Lagring | SQLite, eller én JSON-fil per karakter | Dataene er små: under 20 kB per karakter |
| Synk mellom enheter | Lagre med versjonsnummer, siste skriving vinner | Hent på nytt når appen får fokus |
| Tilgang | Innlogging eller en hemmelig lenke hvis serveren er på internett | Hjemme-nett alene kan klare seg uten |

## Begrensninger og neste steg

Utregningen dekker Elowens bygg godt, men er ikke en full D&D-motor. Dette bør man vite før man bygger videre:

- **Uoffisiell datakilde.** character-service kan endre format eller stenge. Hold lim inn-reserven og en versjonssjekk på svaret.
- **Evner etter navn.** Extra Attack, Dread Ambusher, Stalker's Flurry, Foe Slayer og Roving gjenkjennes på navnet. Andre klasser trenger egne regler.
- **Overstyrt CON.** D&D Beyond har CON satt manuelt til 17. Appen følger det, så HP blir 40. Sjekk om det er riktig.
- **Dark Bargain** er en feat fra DM-en som ikke regnes inn i noe. Gir den en bonus, må den legges til.
- **Magiske gjenstander** med bonuser er bare delvis støttet (magic-bonus på våpen og AC-bonus på rustning).
- **Multiclass** er ikke testet. Spell slots og evner leses fra første klasse.
- **Ugla** har initiative +1 skrevet inn for hånd, fordi den ikke ligger i dataene.
- **Nick-tolkningen.** Appen lar Nick gjelde når våpenet som gjør ekstra-angrepet har Nick. Sjekk med DM om bordet tolker det likt.
- **Kampen lagres ikke** i prototypen. Se Lagring.
- **Bare én karakter** per installasjon.

Forslag til neste steg på egen server:

- [ ] Serverendepunkt som henter fra D&D Beyond (se Datakilden)
- [ ] Lagre kampen, ikke bare arket, så mobil og PC kan bytte midt i en runde
- [ ] PWA med «Legg til på hjemskjermen» og offline-støtte for ark og kamp
- [ ] Flere karakterer, valgt med karakter-ID
- [ ] Enkel innlogging hvis serveren er åpen på internett
- [ ] Tester for `deriveCharacter` med lagrede D&D Beyond-svar for flere nivåer

## Vedlegg: kildefiler og datastruktur

Kildefilene sendes med i samtalen. Prototypen er React 18 uten byggesystem: JSX kompileres med esbuild og legges rett inn i én HTML-fil.

| Fil | Innhold |
| --- | --- |
| `derive.js` | `deriveCharacter`, `seedPetTraits`, `applyPetTraits`. Ren JavaScript uten avhengigheter, kan kjøres i nettleser og Node |
| `app.jsx` | Hele appen: lagring, terninginnskriving, angrep, bjørnetur, henting, faner, ark, bjørnekort |
| `shell.html` | Tittel, fonter, CSS med fargevariabler for mørkt og lyst tema, React fra cdnjs |
| `build.sh` | Kompilerer `app.jsx` og setter `derive.js` + appen inn i `shell.html` |

I prototypen må to ting byttes ut på egen server:

- `window.claude.use("db")` (Claudes lagring) → eget API, for eksempel `GET/PUT /api/state`.
- `window.claude.use("mcp")` med appens nettleser → serverendepunktet `GET /api/ddb/:id`.

Lagret dokument, forkortet:

```json
{
  "v": 1,
  "charId": "123456789",
  "importedAt": "2026-11-03T20:10:00.000Z",
  "char": {
    "name": "Elowen Windstrider", "level": 4, "pb": 2,
    "scores": { "str": 10, "dex": 16, "con": 17, "int": 12, "wis": 16, "cha": 8 },
    "hpMax": 40, "ac": 14, "speed": 35, "initiative": 6, "darkvision": 120,
    "weapons": [{ "name": "Longbow", "hit": 7, "count": 1, "sides": 8, "mod": 3, "mastery": "Slow" }],
    "slots": { "1": 3 },
    "hm": { "max": 2, "die": 6 }, "ds": { "max": 3, "dice": 6 },
    "attacksPerAction": 1,
    "features": [], "upcoming": [], "spells": [], "skills": [],
    "pets": [{ "id": "25974574", "name": "Kvitebjørn (stupid)", "ac": 12, "hpMax": 42,
               "stats": { "str": 20, "wis": 13 },
               "attacks": [{ "name": "Rend", "hit": 7, "count": 1, "sides": 8, "mod": 5 }],
               "multiattack": { "count": 2, "attack": "Rend" }, "notes": "…" }]
  },
  "elowen": { "hpRemoved": 9 },
  "res": { "hmUsed": 1, "dsUsed": 0, "slotsUsed": {} },
  "pets": {
    "25974574": { "traits": [{ "kind": "ability", "stat": "wis", "delta": -1 },
                             { "kind": "ability", "stat": "str", "delta": 1 },
                             { "kind": "obey", "dc": 10 }],
                  "hpRemoved": 8, "inCombat": true },
    "25974575": { "traits": [{ "kind": "maxCrit" }], "hpRemoved": 8, "inCombat": true }
  },
  "owl": true
}
```

## Kilder

- [D&D Beyond-forum: API questions](https://www.dndbeyond.com/forums/d-d-beyond-general/general-discussion/192944-api-questions)
- [D&D Beyond-forum: D&D Beyond API](https://www.dndbeyond.com/forums/d-d-beyond-general/d-d-beyond-feedback/188822-d-d-beyond-api/unread)
