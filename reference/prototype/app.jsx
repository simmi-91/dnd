/* global React, ReactDOM, DDB */
const { useState, useEffect, useRef, useCallback } = React;

const SESSION = Math.random().toString(36).slice(2);
const DOC = "app/state";
const HOST = "host:claude_browser";
const AB = ["str", "dex", "con", "int", "wis", "cha"];
const ABL = { str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA" };
const MOVE = { 1: "gå", 2: "grave", 3: "klatre", 4: "fly", 5: "svømme" };

const EMPTY = () => ({ v: 1, charId: "", char: null, importedAt: null, elowen: { hpRemoved: 0, tempHp: 0 }, res: { hmUsed: 0, dsUsed: 0, slotsUsed: {} }, pets: {}, owl: true });

// ─── Hjelpere ───────────────────────────────────────────────────────────────
const rollDie = (s) => Math.floor(Math.random() * s) + 1;
const rollDice = (n, s) => Array.from({ length: n }, () => rollDie(s));
const sum = (a) => a.reduce((x, y) => x + y, 0);
const sign = (n) => (n >= 0 ? "+" + n : "−" + Math.abs(n));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ddbUrl = (id) => "https://character-service.dndbeyond.com/character/v5/character/" + id;
const parseId = (s) => { const m = String(s || "").match(/(\d{5,})/); return m ? m[1] : ""; };
const fmtTime = (iso) => { try { return new Date(iso).toLocaleString("nb-NO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } };

function extractJson(txt) {
  if (!txt) return null;
  const i = txt.indexOf("{"), j = txt.lastIndexOf("}");
  if (i < 0 || j < i) return null;
  try { return JSON.parse(txt.slice(i, j + 1)); } catch (e) { return null; }
}
function resultText(r) {
  if (!r) return "";
  if (typeof r.payload === "string") return r.payload;
  return (r.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
}

async function fetchFromBrowser(charId) {
  const mcp = await window.claude?.use?.("mcp");
  if (!mcp) throw { code: "no_mcp" };
  const r1 = await mcp.callTool(HOST, "preview_start", { url: ddbUrl(charId) }, { cache: false });
  const m = resultText(r1).match(/tabId\s+([A-Za-z0-9_-]+)/);
  const tabId = m ? m[1] : undefined;
  let last = "";
  for (let i = 0; i < 5; i++) {
    await sleep(i === 0 ? 1200 : 2000);
    const r2 = await mcp.callTool(HOST, "get_page_text", tabId ? { tabId, max_chars: 3000000 } : { max_chars: 3000000 }, { cache: false });
    last = resultText(r2);
    const j = extractJson(last);
    if (j) {
      if (j.success === false || !j.data) throw { code: "private" };
      return j;
    }
  }
  if (/403|forbidden|private/i.test(last)) throw { code: "private" };
  throw { code: "parse" };
}

const FETCH_ERR = {
  no_mcp: "Automatisk henting virker bare når siden er åpnet i Claude desktop-appen. Bruk «Lim inn» under.",
  server_not_connected: "Automatisk henting virker bare når siden er åpnet i Claude desktop-appen. Bruk «Lim inn» under.",
  not_in_manifest: "Siden fikk ikke lov til å bruke nettleseren i appen. Trykk «Hent» igjen og velg Tillat.",
  approval_required: "Hentingen trenger at du godkjenner den. Trykk «Hent» igjen og velg Tillat.",
  consent_required: "Hentingen trenger at du godkjenner den. Trykk «Hent» igjen og velg Tillat.",
  cancelled: "Hentingen ble avbrutt.",
  private: "D&D Beyond svarte at karakteren ikke er offentlig. Sett Character Privacy til Public på D&D Beyond og prøv igjen.",
  parse: "Fikk ikke lest dataene fra D&D Beyond. Bruk «Lim inn» under.",
  server_unavailable: "Fikk ikke kontakt med nettleseren i appen. Prøv igjen om litt.",
  blocked_by_policy: "Organisasjonen din har slått av nettleseren for sider. Bruk «Lim inn» under.",
};

function mergeImport(prev, char, takeUsage) {
  const first = !prev.char;
  const next = Object.assign({}, prev, { char, charId: String(char.id), importedAt: new Date().toISOString() });
  if (takeUsage || first) {
    next.elowen = { hpRemoved: char.hpRemoved, tempHp: char.tempHp };
    next.res = { hmUsed: char.hm.used, dsUsed: char.ds ? char.ds.used : 0, slotsUsed: {} };
  }
  const pets = Object.assign({}, prev.pets);
  char.pets.forEach((p) => {
    if (!pets[p.id]) pets[p.id] = { traits: DDB.seedPetTraits(p.notes), hpRemoved: p.hpRemoved, inCombat: true };
    else if (takeUsage) pets[p.id] = Object.assign({}, pets[p.id], { hpRemoved: p.hpRemoved });
  });
  next.pets = pets;
  return next;
}

// ─── Lagring (db) ───────────────────────────────────────────────────────────
function usePersisted() {
  const [s, setS] = useState(null);
  const [status, setStatus] = useState("loading");
  const dbRef = useRef(null);
  const timer = useRef(null);
  const chain = useRef(Promise.resolve());
  const latest = useRef(null);

  useEffect(() => {
    let unsub = null;
    const slow = setTimeout(() => setStatus((st) => (st === "loading" ? "slow" : st)), 10000);
    (async () => {
      const db = window.claude && window.claude.use ? await window.claude.use("db") : null;
      if (!db) { clearTimeout(slow); setS((p) => p || EMPTY()); setStatus("nodb"); return; }
      dbRef.current = db;
      unsub = db.doc(DOC).onSnapshot(
        (snap) => {
          if (!snap.metadata.fromCache) clearTimeout(slow);
          setStatus("ready");
          const data = snap.exists ? snap.data() : null;
          if (data && data.writer === SESSION) return;
          setS((prev) => (data ? Object.assign(EMPTY(), JSON.parse(JSON.stringify(data))) : prev || EMPTY()));
        },
        () => { clearTimeout(slow); setStatus("error"); setS((p) => p || EMPTY()); }
      );
    })();
    return () => { if (unsub) unsub(); clearTimeout(slow); };
  }, []);

  const update = useCallback((fn) => {
    setS((prev) => {
      const next = fn(prev);
      latest.current = next;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const db = dbRef.current;
        if (!db) return;
        const body = Object.assign({}, latest.current, { writer: SESSION, savedAt: new Date().toISOString() });
        delete body.v; body.v = 1;
        chain.current = chain.current.then(() => db.doc(DOC).set(body)).then(() => setStatus("ready")).catch(() => setStatus("saveerror"));
      }, 700);
      return next;
    });
  }, []);

  return [s, update, status];
}

// ─── Små komponenter ────────────────────────────────────────────────────────
const Badge = ({ t, children }) => <span className={"badge " + t}>{children}</span>;
const Tip = ({ children, tone }) => <div className={"tip " + (tone || "")}>{children}</div>;
const Toggle = ({ on, onClick, disabled, children, id }) => (
  <button id={id} type="button" className={"toggle" + (on ? " on" : "")} onClick={onClick} disabled={disabled} aria-pressed={on}>
    {on ? "✓ " : ""}{children}
  </button>
);
const Die = ({ v, sides, hl, dim }) => {
  let c = "die";
  if (sides === 20 && v === 20) c += " nat20";
  if (sides === 20 && v === 1) c += " nat1";
  if (hl) c += " hl";
  if (dim) c += " dim";
  return <span className={c}>{v}</span>;
};
const Pips = ({ n, max, tone }) => (
  <span className="pips" aria-label={n + " av " + max}>
    {Array.from({ length: max }, (_, i) => <span key={i} className={"pip " + tone + (i < n ? " full" : "")} />)}
  </span>
);
const Res = ({ label, n, max, tone }) => (
  <div className="res">
    <div className="lbl">{label}</div>
    <div className="res-row"><Pips n={n} max={max} tone={tone} /><span className="num">{n}/{max}</span></div>
  </div>
);
const Econ = ({ label, used, info }) => <span className={"econ" + (used ? " used" : "") + (info ? " info" : "")}>{used ? "✗ " : info ? "" : "● "}{label}</span>;
const Option = ({ title, sub, disabled, reason, rec, onClick }) => (
  <button type="button" className={"opt" + (rec && !disabled ? " rec" : "")} disabled={disabled} onClick={onClick}>
    <span className="opt-title">{title}{rec && !disabled && <span className="chip-rec">Anbefalt</span>}</span>
    {sub && <span className="opt-sub">{sub}</span>}
    {disabled && reason && <span className="opt-why">{reason}</span>}
  </button>
);
const Section = ({ badge, title, hint, children }) => (
  <section className="sect">
    <div className="sect-head"><Badge t={badge}>{title}</Badge>{hint && <span className="hint">{hint}</span>}</div>
    <div className="stack">{children}</div>
  </section>
);
const Stat = ({ label, value }) => (
  <div className="stat"><div className="lbl">{label}</div><div className="val">{value}</div></div>
);

// ─── Innskriving av fysiske terninger ───────────────────────────────────────
// d20: du skriver inn det terningen viste, appen legger til bonusen.
function D20Entry({ id, label, bonus, mode, dc, onResult, compact }) {
  const [v, setV] = useState("");
  const n = parseInt(v, 10);
  const ok = n >= 1 && n <= 20;
  const how = mode === "adv" ? "Rull 2d20 og skriv inn den høyeste." : mode === "dis" ? "Rull 2d20 og skriv inn den laveste." : "Rull 1d20.";
  const submit = () => { if (ok) onResult(n, [n]); };
  const auto = () => {
    const d = mode === "adv" || mode === "dis" ? [rollDie(20), rollDie(20)] : [rollDie(20)];
    const nat = mode === "adv" ? Math.max(...d) : mode === "dis" ? Math.min(...d) : d[0];
    onResult(nat, d);
  };
  return (
    <div className={"entry" + (compact ? " compact" : "")}>
      {label && <label className="entry-label" htmlFor={id}>{label}</label>}
      {!compact && <p className="small dim">{how}{dc ? " Du trenger " + dc + " eller mer totalt." : ""}</p>}
      <form className="entry-row" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <input id={id} className="input d20in" type="number" inputMode="numeric" min="1" max="20" value={v} onChange={(e) => setV(e.target.value)} placeholder="d20" aria-label={(label || "Terning") + ": hva viste terningen"} />
        <span className="op">{sign(bonus)}</span>
        <span className="op">=</span>
        <span className={"total" + (ok ? "" : " dim")}>{ok ? n + bonus : "?"}</span>
        <button type="submit" className="btn" disabled={!ok}>OK</button>
      </form>
      {v && !ok && <p className="why">Skriv et tall fra 1 til 20.</p>}
      <button type="button" className="link dim" onClick={auto}>eller rull i appen</button>
    </div>
  );
}

// Skade: én linje per terninggruppe, du skriver inn summen du rullet.
function DiceEntry({ idp, groups, onDone }) {
  const [v, setV] = useState({});
  const val = (k) => parseInt(v[k], 10);
  const valid = (g) => { const n = val(g.key); return n >= g.count && n <= g.count * g.sides; };
  const all = groups.every(valid);
  const total = all ? sum(groups.map((g) => Math.max(0, val(g.key) + g.mod))) : null;
  const auto = () => { const o = {}; groups.forEach((g) => { o[g.key] = String(sum(rollDice(g.count, g.sides))); }); setV(o); };
  return (
    <div className="stack">
      <p className="small">Rull terningene og skriv inn summen på hver linje.</p>
      {groups.map((g) => (
        <div key={g.key} className="dice-line">
          <label htmlFor={idp + g.key} className={"small " + (g.tone || "")}><b>{g.label}</b><br />rull {g.count}d{g.sides}{g.mod ? ", " + sign(g.mod) + " legges til" : ""}</label>
          <input id={idp + g.key} className={"input dicein" + (v[g.key] && !valid(g) ? " bad" : "")} type="number" inputMode="numeric" value={v[g.key] || ""} onChange={(e) => setV(Object.assign({}, v, { [g.key]: e.target.value }))} placeholder={g.count + "–" + g.count * g.sides} />
        </div>
      ))}
      {groups.filter((g) => v[g.key] && !valid(g)).map((g) => <p key={g.key} className="why">{g.label}: {g.count}d{g.sides} gir mellom {g.count} og {g.count * g.sides}.</p>)}
      <div className="dmgsum"><span>Total skade</span><span className={"total" + (total == null ? " dim" : "")}>{total == null ? "?" : total}</span></div>
      <button type="button" className="btn big bad" disabled={!all} onClick={() => { const o = {}; groups.forEach((g) => { o[g.key] = val(g.key); }); onDone(o); }}>Ferdig</button>
      <button type="button" className="link dim" onClick={auto}>eller rull i appen</button>
    </div>
  );
}

// ─── Angrep (brukes av Elowen og bjørnene) ──────────────────────────────────
function Attack({ idp, title, hit, count, sides, mod, dmgType, note, autoAdv, extras, maxCritAllowed, onRolled, onLog, onDone, onCancel }) {
  const [stage, setStage] = useState("aim");
  const [mAdv, setMAdv] = useState(false);
  const [mDis, setMDis] = useState(false);
  const [roll, setRoll] = useState(null);
  const [on, setOn] = useState(() => { const o = {}; (extras || []).forEach((e) => { o[e.key] = !!e.defaultOn; }); return o; });
  const [critMax, setCritMax] = useState(false);
  const [dmg, setDmg] = useState(null);
  const sources = (autoAdv || []).concat(mAdv ? ["annen fordel"] : []);
  const mode = sources.length && !mDis ? "adv" : mDis && !sources.length ? "dis" : "normal";

  const gotD20 = (nat, d) => {
    const total = nat + hit, crit = nat === 20, fumble = nat === 1;
    setRoll({ d, nat, total, crit, fumble });
    if (onRolled) onRolled();
    onLog(title + ": " + nat + " " + sign(hit) + " = " + total + (mode === "adv" ? " (advantage)" : mode === "dis" ? " (disadvantage)" : "") + (crit ? " – KRITISK TREFF!" : fumble ? " – naturlig 1, bom" : ""));
    setStage(crit ? "dmg" : fumble ? "miss" : "rolled");
  };

  const m = roll && roll.crit ? 2 : 1;
  const active = (extras || []).filter((e) => on[e.key] && e.available);
  const groups = [{ key: "w", label: title, count: count * m, sides, mod, type: dmgType, tone: "" }].concat(
    active.map((e) => ({ key: e.key, label: e.label, count: e.count * m, sides: e.sides, mod: 0, type: e.type, tone: e.tone }))
  );
  const maxAll = !!(roll && roll.crit && maxCritAllowed && critMax);

  const finish = (vals) => {
    const parts = groups.map((g) => ({ label: g.label + " " + g.count + "d" + g.sides, rolled: vals[g.key], mod: g.mod, total: Math.max(0, vals[g.key] + g.mod), type: g.type, tone: g.tone }));
    active.forEach((e) => { if (e.onUse) e.onUse(); });
    const total = sum(parts.map((p) => p.total));
    setDmg({ parts, total });
    onLog("Skade: " + parts.map((p) => p.total + " " + p.type).join(" + ") + " = " + total + (maxAll ? " (maks-krit)" : roll.crit ? " (kritisk)" : ""));
    setStage("done");
  };
  const finishMax = () => { const o = {}; groups.forEach((g) => { o[g.key] = g.count * g.sides; }); finish(o); };

  return (
    <div className="card hl attack">
      <div className="card-title">{title}</div>
      <div className="meta">{sign(hit)} for å treffe · {count}d{sides}{mod ? sign(mod) : ""} {dmgType}</div>

      {stage === "aim" && (
        <>
          <div className="wrap">
            <Toggle on={mAdv} onClick={() => setMAdv(!mAdv)}>Annen fordel</Toggle>
            <Toggle on={mDis} onClick={() => setMDis(!mDis)}>Disadvantage</Toggle>
          </div>
          {mode === "adv" && <p className="small"><b className="t-good">Advantage</b>: {sources.join(", ")}.</p>}
          {mode === "dis" && <p className="small"><b className="t-bad">Disadvantage</b>.</p>}
          {mode === "normal" && sources.length > 0 && mDis && <p className="small">Advantage og disadvantage opphever hverandre.</p>}
          <D20Entry id={idp + "-hit"} label="Rull for å treffe" bonus={hit} mode={mode} onResult={gotD20} />
          {onCancel && <button type="button" className="btn ghost sm" onClick={onCancel}>Avbryt</button>}
        </>
      )}

      {roll && (
        <div className="rollrow">
          {roll.d.map((v, i) => <Die key={i} v={v} sides={20} hl={roll.d.length > 1 && i === roll.d.indexOf(roll.nat)} dim={roll.d.length > 1 && i !== roll.d.indexOf(roll.nat)} />)}
          <span className="op">{sign(hit)} =</span>
          <span className={"total" + (roll.crit ? " t-good" : roll.fumble ? " t-bad" : "")}>{roll.total}</span>
        </div>
      )}

      {stage === "rolled" && (
        <>
          <Tip tone="say">Si til DM: <q>Jeg fikk {roll.total} for å treffe.</q> Traff det?</Tip>
          <div className="two">
            <button type="button" className="btn big good" onClick={() => setStage("dmg")}>Traff ✓</button>
            <button type="button" className="btn big bad" onClick={() => { onLog("Bom"); setStage("miss"); }}>Bom ✗</button>
          </div>
        </>
      )}

      {stage === "dmg" && (
        <>
          {roll.crit && <p className="crit">Kritisk treff! Du ruller dobbelt så mange skadeterninger.</p>}
          {maxCritAllowed && roll.crit && <div className="wrap"><Toggle on={critMax} onClick={() => setCritMax(!critMax)}>Målet er en monstrosity: all skade maks</Toggle></div>}
          {(extras || []).length > 0 && (
            <>
              <p className="small">Ekstra skade på dette treffet:</p>
              <div className="wrap">
                {extras.map((e) => (
                  <Toggle key={e.key} on={on[e.key] && e.available} disabled={!e.available} onClick={() => setOn(Object.assign({}, on, { [e.key]: !on[e.key] }))}>
                    {e.label} +{e.count}d{e.sides}{e.left != null ? " (" + e.left + " igjen)" : ""}
                  </Toggle>
                ))}
              </div>
              {extras.filter((e) => !e.available && e.reason).map((e) => <p key={e.key} className="why">{e.reason}</p>)}
            </>
          )}
          {maxAll ? (
            <>
              <p className="small">Ingen rulling: alle terningene teller fullt.</p>
              <button type="button" className="btn big bad" onClick={finishMax}>Regn ut maks skade</button>
            </>
          ) : (
            <DiceEntry key={groups.map((g) => g.key + g.count).join("|")} idp={idp + "-dmg-"} groups={groups} onDone={finish} />
          )}
        </>
      )}

      {stage === "done" && dmg && (
        <>
          <div className="dmgbox">
            {dmg.parts.map((p, i) => (
              <div key={i} className="dmgrow">
                <span className={"small " + p.tone}>{p.label}</span>
                <span className="small dim">{p.rolled}{p.mod ? " " + sign(p.mod) : ""}</span>
                <span className={"part-total " + p.tone}>{p.total} {p.type}</span>
              </div>
            ))}
            <div className="dmgsum"><span>Total skade</span><span className="total">{dmg.total}</span></div>
          </div>
          <Tip tone="say">Si til DM: <q>{dmg.total} skade: {dmg.parts.map((p) => p.total + " " + p.type).join(", ")}.</q>{note ? <><br />{note}</> : null}</Tip>
          <button type="button" className="btn big" onClick={onDone}>Ferdig</button>
        </>
      )}

      {stage === "miss" && (
        <>
          <p className="t-bad strong">Bom.</p>
          <button type="button" className="btn big" onClick={onDone}>Ferdig</button>
        </>
      )}
    </div>
  );
}

// ─── Bjørnens tur ───────────────────────────────────────────────────────────
function PetTurn({ pet, ap, ahBonus, onLog, onDone }) {
  const n = pet.multiattack ? pet.multiattack.count : 1;
  const atk = ap.attacks.find((a) => !pet.multiattack || a.name === pet.multiattack.attack) || ap.attacks[0];
  const [stage, setStage] = useState(ap.flags.obey ? "obey" : "choose");
  const [ob, setOb] = useState(null);
  const [i, setI] = useState(0);
  const short = pet.name.replace(/\s*\(.*\)\s*$/, "");

  const gotObey = (d) => {
    const total = d + ahBonus, ok = total >= ap.flags.obey;
    setOb({ d, total, ok });
    onLog(short + " – Animal Handling: " + d + " " + sign(ahBonus) + " = " + total + " mot DC " + ap.flags.obey + " → " + (ok ? "adlyder" : "adlyder ikke"));
  };

  if (!atk) return <Tip>Fant ingen angrep for {pet.name} i dataene.</Tip>;

  return (
    <div className="stack">
      {stage === "obey" && (
        <div className="card hl">
          <div className="card-title">Adlyder {short}?</div>
          <p className="small">Elowen ruller Animal Handling. Klarer du DC {ap.flags.obey}, gjør bjørnen det du ber om.</p>
          {!ob && <D20Entry id={"obey-" + pet.id} label="Animal Handling" bonus={ahBonus} dc={ap.flags.obey} onResult={gotObey} />}
          {ob && (
            <>
              <div className="rollrow"><Die v={ob.d} sides={20} /><span className="op">{sign(ahBonus)} =</span><span className={"total " + (ob.ok ? "t-good" : "t-bad")}>{ob.total}</span></div>
              {ob.ok ? (
                <button type="button" className="btn big good" onClick={() => setStage("choose")}>Den adlyder → velg handling</button>
              ) : (
                <>
                  <Tip tone="warn">Bjørnen adlyder ikke denne runden. DM bestemmer hva den gjør.</Tip>
                  <button type="button" className="btn big" onClick={onDone}>Ferdig med turen →</button>
                </>
              )}
            </>
          )}
        </div>
      )}

      {stage === "choose" && (
        <Section badge="act" title="Action" hint="én per tur">
          <Option title={n > 1 ? "Multiattack: " + n + "× " + atk.name : atk.name} rec sub={sign(atk.hit) + " · " + atk.count + "d" + atk.sides + sign(atk.mod) + " " + atk.dmgType + " · rekkevidde " + atk.reach + (ap.flags.maxCrit ? " · maks skade ved krit mot monstrosity" : "")} onClick={() => setStage("attack")} />
          <Option title="Noe annet (Dash, Dodge, flytte seg)" sub={"Speed " + ap.speeds.map((s) => s.speed + " ft " + (MOVE[s.id] || "")).join(", ")} onClick={() => { onLog(short + ": gjorde noe annet enn å angripe"); onDone(); }} />
        </Section>
      )}

      {stage === "attack" && (
        <>
          {n > 1 && <p className="small strong">Angrep {i + 1} av {n}</p>}
          <Attack
            key={i}
            idp={"pet-" + pet.id + "-" + i}
            title={short + ": " + atk.name}
            hit={atk.hit} count={atk.count} sides={atk.sides} mod={atk.mod} dmgType={atk.dmgType}
            maxCritAllowed={ap.flags.maxCrit}
            onLog={onLog}
            onDone={() => { if (i + 1 < n) setI(i + 1); else setStage("finished"); }}
          />
        </>
      )}

      {stage === "finished" && <button type="button" className="btn big" onClick={onDone}>Ferdig med {short}s tur →</button>}
    </div>
  );
}
// ─── Hent / lim inn ─────────────────────────────────────────────────────────
function ImportPanel({ s, update, onImported, startOpen }) {
  const [open, setOpen] = useState(!!startOpen);
  const [idText, setIdText] = useState(s.charId || "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [paste, setPaste] = useState("");
  const [takeUsage, setTakeUsage] = useState(!s.char);
  const id = parseId(idText);

  const apply = (raw) => {
    const char = DDB.deriveCharacter(raw);
    const prevLevel = s.char ? s.char.level : null;
    update((prev) => mergeImport(prev, char, takeUsage));
    onImported(char, prevLevel);
    setMsg({ ok: true, text: "Hentet " + char.name + ", nivå " + char.level + "." });
    setPaste("");
  };
  const auto = async () => {
    if (!id) { setMsg({ ok: false, text: "Skriv inn karakter-ID-en eller lenken til karakteren først." }); return; }
    setBusy(true); setMsg({ ok: true, text: "Henter fra D&D Beyond …" });
    try { apply(await fetchFromBrowser(id)); }
    catch (e) {
      const code = e && e.code;
      setMsg({ ok: false, text: FETCH_ERR[code] || (code === "tool_error" && e.message) || (e && e.message) || "Hentingen feilet. Bruk «Lim inn» under." });
    }
    setBusy(false);
  };
  const fromPaste = () => {
    const j = extractJson(paste);
    if (!j) { setMsg({ ok: false, text: "Teksten er ikke gyldige data. Kopier alt på siden med Ctrl+A og Ctrl+C (Cmd på Mac), og lim inn på nytt." }); return; }
    try { apply(j); } catch (e) { setMsg({ ok: false, text: e.message }); }
  };

  if (!open) {
    return (
      <div className="syncbar">
        <span className="small">{s.importedAt ? "Hentet fra D&D Beyond " + fmtTime(s.importedAt) : "Ikke hentet ennå"}</span>
        <button type="button" className="btn sm" onClick={() => setOpen(true)}>Oppdater fra D&D Beyond</button>
      </div>
    );
  }
  return (
    <div className="card import">
      <div className="card-title">Hent fra D&D Beyond</div>
      <p className="small">Har du gått opp i nivå eller endret noe på D&D Beyond? Hent på nytt, så regnes alt ut på nytt. Bjørnetrekkene dine blir værende.</p>
      <label className="lbl" htmlFor="charid">Karakter-ID eller lenke</label>
      <input id="charid" className="input" value={idText} onChange={(e) => setIdText(e.target.value)} placeholder="f.eks. dndbeyond.com/characters/123456789" />
      <div className="wrap">
        <Toggle id="takeusage" on={takeUsage} onClick={() => setTakeUsage(!takeUsage)}>Hent også HP og brukte ressurser</Toggle>
      </div>
      <button type="button" className="btn big" onClick={auto} disabled={busy}>{busy ? "Henter …" : "⤓ Hent automatisk"}</button>
      <p className="small dim">Virker i Claude desktop-appen. Første gang spør appen om lov til å åpne D&D Beyond. Karakteren må være satt til Public.</p>
      {msg && <Tip tone={msg.ok ? "" : "warn"}>{msg.text}</Tip>}
      <details className="paste">
        <summary>Lim inn i stedet</summary>
        <ol className="small steps">
          <li>{id ? <a href={ddbUrl(id)} target="_blank" rel="noopener noreferrer">Åpne dataene dine</a> : "Skriv inn ID-en over, så dukker lenken opp her"}.</li>
          <li>Merk alt med Ctrl+A og kopier med Ctrl+C (Cmd på Mac).</li>
          <li>Lim inn her og trykk «Les inn».</li>
        </ol>
        <textarea id="paste" className="input" rows={3} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Lim inn her" />
        <button type="button" className="btn" onClick={fromPaste} disabled={!paste.trim()}>Les inn</button>
      </details>
      {s.char && <button type="button" className="btn ghost sm" onClick={() => setOpen(false)}>Lukk</button>}
    </div>
  );
}

// ─── Hovedside ──────────────────────────────────────────────────────────────
const TABS = [["kamp", "Kamp"], ["elowen", "Ark"], ["pets", "Bjørner"], ["tips", "Tips"]];
const OWL_INIT = 1; // Owl: DEX 13
const shortName = (n) => String(n || "").replace(/\s*\(.*\)\s*$/, "");

function App() {
  const [s, update, status] = usePersisted();
  const [tab, setTab] = useState("kamp");
  const [fighting, setFighting] = useState(false);
  const [round, setRound] = useState(0);
  const [who, setWho] = useState("elowen");
  const [done, setDone] = useState({});
  const [inits, setInits] = useState({});
  const [mode, setMode] = useState("ranged");
  const [turn, setTurn] = useState(null);
  const [atk, setAtk] = useState(null);
  const [check, setCheck] = useState(null);
  const [hmOn, setHmOn] = useState(false);
  const [dark, setDark] = useState(false);
  const [owlHelp, setOwlHelp] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [hpInput, setHpInput] = useState("");
  const [conc, setConc] = useState(null);
  const [log, setLog] = useState([]);
  const [levelUp, setLevelUp] = useState(null);
  const roundRef = useRef(0);
  roundRef.current = round;

  const addLog = useCallback((text) => setLog((l) => [{ id: Math.random(), r: roundRef.current, text }].concat(l).slice(0, 100)), []);

  if (!s) {
    return <div className="page"><div className="empty"><p>Laster arket …</p>{status === "slow" && <p className="small">Får ikke kontakt med lagringen ennå. Sjekk nettet.</p>}</div></div>;
  }

  const c = s.char;
  const onImported = (char, prevLevel) => {
    if (prevLevel && char.level > prevLevel) setLevelUp({ from: prevLevel, to: char.level, feats: char.features.filter((f) => f.level > prevLevel) });
  };

  if (!c) {
    return (
      <div className="page">
        <header className="top"><h1>Kampguide</h1><p className="sub">Hent karakteren din fra D&D Beyond for å komme i gang.</p></header>
        {status === "nodb" && <Tip tone="warn">Lagring er ikke tilgjengelig her, så det du gjør blir ikke husket.</Tip>}
        <ImportPanel s={s} update={update} onImported={onImported} startOpen />
        <div className="card ghostcard">
          <div className="card-title">Dette får du</div>
          <ul className="small list">
            <li>En fane per deltaker i kampen, i initiativ-rekkefølge.</li>
            <li>Du ruller med ekte terninger og skriver inn tallet. Appen legger til bonusene.</li>
            <li>Bjørnene dine med egne trekk og egne regler.</li>
            <li>Alle tall regnes ut fra nivået, så arket følger med når du går opp i nivå.</li>
          </ul>
        </div>
      </div>
    );
  }

  // ── Utledede verdier ──
  const hpMax = c.hpMax;
  const hp = Math.max(0, hpMax - (s.elowen.hpRemoved || 0));
  const hmLeft = Math.max(0, c.hm.max - (s.res.hmUsed || 0));
  const slotLevels = Object.keys(c.slots).map(Number).sort((a, b) => a - b);
  const slotLeft = (l) => Math.max(0, c.slots[l] - ((s.res.slotsUsed || {})[l] || 0));
  const anySlot = slotLevels.find((l) => slotLeft(l) > 0);
  const dsLeft = c.ds ? Math.max(0, c.ds.max - (s.res.dsUsed || 0)) : 0;
  const ah = (c.skills.find((k) => k.key === "animal-handling") || { bonus: 0 }).bonus;
  const stealth = (c.skills.find((k) => k.key === "stealth") || { bonus: 0 }).bonus;
  const pets = c.pets.map((p) => {
    const st = s.pets[p.id] || { traits: [], hpRemoved: p.hpRemoved, inCombat: true };
    const ap = DDB.applyPetTraits(p, st.traits);
    return { p, st, ap, hp: Math.max(0, ap.hpMax - (st.hpRemoved || 0)) };
  });
  const activePets = pets.filter((x) => x.st.inCombat !== false);
  const owlOn = c.familiar && s.owl;
  const t = turn || {};
  const turnSpeed = c.speed + (round === 1 && c.ambusherLeap ? 10 : 0);
  const speedNow = t.dash ? turnSpeed * 2 : turnSpeed;
  const busy = !!atk || !!check;

  const setRes = (fn) => update((prev) => Object.assign({}, prev, { res: fn(Object.assign({ slotsUsed: {} }, prev.res)) }));
  const setPetState = (id, fn) => update((prev) => {
    const cur = prev.pets[id] || { traits: [], hpRemoved: 0, inCombat: true };
    return Object.assign({}, prev, { pets: Object.assign({}, prev.pets, { [id]: fn(cur) }) });
  });

  // ── Deltakere i initiativ-rekkefølge ──
  const base = [{ id: "elowen", name: c.name.split(" ")[0], bonus: c.initiative }]
    .concat(owlOn ? [{ id: "owl", name: "Ugla", bonus: OWL_INIT, optional: true }] : [])
    .concat(activePets.map((x) => ({ id: x.p.id, name: shortName(x.p.name), bonus: x.ap.initiative, x })));
  const order = base.map((b, i) => Object.assign({ i }, b)).sort((a, b) => {
    const A = inits[a.id], B = inits[b.id];
    if (A != null && B != null) return B.total - A.total || a.i - b.i;
    if (A != null) return -1;
    if (B != null) return 1;
    return a.i - b.i;
  });
  const allDone = fighting && order.every((o) => done[o.id]);
  const nextAfter = (id) => {
    const idx = order.findIndex((o) => o.id === id);
    const after = order.slice(idx + 1).concat(order.slice(0, idx)).find((o) => !done[o.id] && o.id !== id);
    return after ? after.id : null;
  };
  const markDone = (id) => {
    setDone((d) => Object.assign({}, d, { [id]: true }));
    const nx = nextAfter(id);
    if (nx) setWho(nx);
    try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch (e) { /* ingen scroll */ }
  };
  const nextName = (id) => { const nx = nextAfter(id); const o = order.find((x) => x.id === nx); return o ? o.name : null; };

  // ── HP ──
  const applyHp = (dir) => {
    const n = parseInt(hpInput, 10);
    if (!n || n < 0) return;
    update((prev) => Object.assign({}, prev, { elowen: Object.assign({}, prev.elowen, { hpRemoved: Math.min(hpMax, Math.max(0, (prev.elowen.hpRemoved || 0) + (dir < 0 ? n : -n))) }) }));
    addLog(dir < 0 ? "Elowen tok " + n + " skade" : "Elowen helbredet " + n + " HP");
    if (dir < 0 && hmOn) setConc({ dc: Math.max(10, Math.floor(n / 2)) });
    setHpInput("");
  };
  const gotConc = (d) => {
    const total = d + c.saves.con.bonus, ok = total >= conc.dc;
    setConc(Object.assign({}, conc, { d, total, ok }));
    if (!ok) setHmOn(false);
    addLog("Konsentrasjon (DC " + conc.dc + "): " + d + " " + sign(c.saves.con.bonus) + " = " + total + " → " + (ok ? "holder Hunter's Mark" : "mistet Hunter's Mark"));
  };
  const longRest = () => {
    update((prev) => {
      const petsNext = {};
      Object.keys(prev.pets).forEach((k) => { petsNext[k] = Object.assign({}, prev.pets[k], { hpRemoved: 0 }); });
      return Object.assign({}, prev, { elowen: { hpRemoved: 0, tempHp: 0 }, res: { hmUsed: 0, dsUsed: 0, slotsUsed: {} }, pets: petsNext });
    });
    setHmOn(false); setConc(null);
    addLog("Long Rest: alt er fylt opp igjen");
  };

  // ── Kampflyt ──
  const freshTurn = () => ({ actionType: null, attacksLeft: 0, bonus: false, dsUsed: false, lightFrom: null, extraUsed: false, dash: false, note: null });
  const gotInit = (o) => (d) => {
    const total = d + o.bonus;
    setInits((m) => Object.assign({}, m, { [o.id]: { d, total } }));
    addLog("Initiative " + o.name + ": " + d + " " + sign(o.bonus) + " = " + total);
  };
  const startCombat = () => {
    setFighting(true); setRound(1); roundRef.current = 1; setTurn(freshTurn()); setAtk(null); setCheck(null); setDone({});
    setWho(order[0].id);
    addLog("Kampen starter – runde 1");
  };
  const endCombat = () => {
    setFighting(false); setRound(0); setTurn(null); setAtk(null); setCheck(null); setInits({}); setDone({});
    setOwlHelp(false); setHidden(false); setLog([]); setWho("elowen");
  };
  const nextRound = () => {
    const r = round + 1;
    setRound(r); roundRef.current = r; setTurn(freshTurn()); setAtk(null); setCheck(null); setDone({});
    setWho(order[0].id);
    addLog("— Runde " + r + " —");
    try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch (e) { /* ingen scroll */ }
  };

  const castHm = () => {
    if (hmLeft > 0) setRes((r) => Object.assign(r, { hmUsed: (r.hmUsed || 0) + 1 }));
    else setRes((r) => Object.assign(r, { slotsUsed: Object.assign({}, r.slotsUsed, { [anySlot]: (r.slotsUsed[anySlot] || 0) + 1 }) }));
    setHmOn(true);
    setTurn((x) => Object.assign({}, x, { bonus: true, note: null }));
    addLog("Bonus action: Hunter's Mark (" + (hmLeft > 0 ? "gratis-kast" : "spell slot nivå " + anySlot) + ")");
  };
  const moveHm = () => { setTurn((x) => Object.assign({}, x, { bonus: true, note: null })); addLog("Bonus action: flyttet Hunter's Mark"); };
  const simple = (name, note, extra) => { setTurn((x) => Object.assign({}, x, { actionType: "other", note }, extra || {})); addLog("Action: " + name); };
  const gotHide = (d) => {
    const total = d + stealth, ok = total >= 15;
    if (ok) setHidden(true);
    setCheck(null);
    simple("Hide", "Hide: " + d + " " + sign(stealth) + " = " + total + " mot DC 15 → " + (ok ? "Du er skjult. Advantage på neste angrep." : "Ikke skjult."));
  };

  const startAttack = (w, kind) => setAtk({ id: Math.random().toString(36).slice(2, 8), w, kind });
  const economy = (a) => {
    setTurn((x) => {
      const n = Object.assign({}, x, { note: null });
      if (a.kind === "main") {
        if (!n.actionType) { n.actionType = "attack"; n.attacksLeft = c.attacksPerAction - 1; } else n.attacksLeft = Math.max(0, n.attacksLeft - 1);
        if (a.w.light && !n.lightFrom) n.lightFrom = a.w.key;
      } else if (a.kind === "nick") n.extraUsed = true;
      else if (a.kind === "bonus") { n.extraUsed = true; n.bonus = true; }
      return n;
    });
    if (owlHelp) setOwlHelp(false);
    if (hidden) setHidden(false);
  };

  const canAttack = !t.actionType || (t.actionType === "attack" && t.attacksLeft > 0);
  const attackReason = busy ? "Gjør ferdig det du holder på med først" : !canAttack ? (t.actionType === "attack" ? "Du har brukt alle angrepene i Attack-actionen" : "Action er brukt denne turen") : null;
  const actionReason = busy ? "Gjør ferdig det du holder på med først" : t.actionType ? "Action er brukt denne turen" : null;
  const bonusReason = busy ? "Gjør ferdig det du holder på med først" : t.bonus ? "Bonus action er brukt denne turen" : null;
  const hmCastReason = bonusReason || (hmOn ? "Allerede aktiv. Bruk «Flytt Hunter's Mark» hvis målet døde." : null) || (hmLeft === 0 && !anySlot ? "Ingen gratis-kast eller spell slots igjen" : null);
  const hmMoveReason = bonusReason || (!hmOn ? "Hunter's Mark er ikke aktiv" : null);

  const autoAdv = [dark && c.umbralSight && "mørke (Umbral Sight)", owlHelp && "uglas Help", hidden && "du er skjult"].filter(Boolean);
  const attackFor = (a) => {
    const w = a.w;
    const off = a.kind !== "main";
    const mod = off ? w.mod - w.abMod + Math.min(0, w.abMod) : w.mod;
    const extras = [];
    if (c.hm.known) extras.push({ key: "hm", label: "Hunter's Mark", count: 1, sides: c.hm.die, type: "force", tone: "t-gold", available: hmOn, defaultOn: true, reason: hmOn ? null : "Hunter's Mark er ikke aktiv." });
    if (c.ds) extras.push({
      key: "ds", label: "Dreadful Strike", count: 2, sides: c.ds.dice, type: "psychic", tone: "t-psy", left: dsLeft,
      available: dsLeft > 0 && !t.dsUsed, defaultOn: true,
      reason: t.dsUsed ? "Dreadful Strike er brukt denne turen (1 per tur)." : dsLeft === 0 ? "Ingen Dreadful Strike igjen før Long Rest." : null,
      onUse: () => { setRes((r) => Object.assign(r, { dsUsed: (r.dsUsed || 0) + 1 })); setTurn((x) => Object.assign({}, x, { dsUsed: true })); },
    });
    let note = w.masteryText ? w.mastery + ": " + w.masteryText : null;
    if (off) note = (note ? note + " " : "") + "Ekstra-angrepet får ikke evnemodifikatoren på skaden.";
    return (
      <Attack key={a.id} idp={"el-" + a.id} title={w.name} hit={w.hit} count={w.count} sides={w.sides} mod={mod} dmgType={w.dmgType} note={note}
        autoAdv={autoAdv} extras={extras} onRolled={() => economy(a)} onLog={addLog} onDone={() => setAtk(null)} onCancel={() => setAtk(null)} />
    );
  };

  const ranged = c.weapons.filter((w) => w.ranged);
  const melee = c.weapons.filter((w) => !w.ranged);
  const lightExtras = t.lightFrom && !t.extraUsed ? c.weapons.filter((w) => w.light && !w.ranged && w.key !== t.lightFrom) : [];

  // ── Felles biter ──
  const header = (
    <header className="top">
      <div className="who">
        <h1>{c.name}</h1>
        <p className="sub">{[c.lineage || c.race, c.subclass, c.cls].filter(Boolean).join(" ")} · nivå {c.level}</p>
      </div>
      <div className="statgrid">
        <Stat label="HP" value={hp + "/" + hpMax} />
        <Stat label="AC" value={c.ac} />
        <Stat label="Initiative" value={sign(c.initiative)} />
        <Stat label="Speed" value={c.speed + " ft"} />
        <Stat label="Darkvision" value={c.darkvision + " ft"} />
        <Stat label="Passiv Perc." value={c.passive.perception} />
      </div>
    </header>
  );

  const levelBanner = levelUp && (
    <div className="card hl levelup">
      <div className="card-title">Nivå {levelUp.to}! 🎉</div>
      <p className="small">Arket er regnet ut på nytt.{levelUp.feats.length ? " Nye evner:" : ""}</p>
      {levelUp.feats.length > 0 && <ul className="small list">{levelUp.feats.map((f) => <li key={f.name}><b>{f.name}</b> (nivå {f.level})</li>)}</ul>}
      <button type="button" className="btn sm" onClick={() => setLevelUp(null)}>OK</button>
    </div>
  );

  const hpBox = (
    <div className="card hpbox">
      <div className="hp-row">
        <div><span className="lbl">Elowen HP</span> <span className={"hp-num " + (hp > hpMax / 2 ? "t-good" : hp > hpMax / 4 ? "t-gold" : "t-bad")}>{hp}</span><span className="dim"> / {hpMax}</span></div>
        {hp === 0 && <span className="t-bad small strong">0 HP: si fra til DM (death saves)</span>}
      </div>
      <div className="wrap">
        <input id="hpin" className="input num-in" type="number" inputMode="numeric" min="0" value={hpInput} onChange={(e) => setHpInput(e.target.value)} placeholder="Antall" aria-label="Antall HP" />
        <button type="button" className="btn sm bad" onClick={() => applyHp(-1)}>Tok skade</button>
        <button type="button" className="btn sm good" onClick={() => applyHp(1)}>Helbred</button>
      </div>
      {conc && (
        <div className="conc">
          <div className="strong t-gold">Konsentrasjon på Hunter's Mark</div>
          {conc.d == null ? (
            <D20Entry id="conc" label={"CON save mot DC " + conc.dc} bonus={c.saves.con.bonus} dc={conc.dc} onResult={gotConc} />
          ) : (
            <div className="rollrow"><Die v={conc.d} sides={20} /><span className="op">{sign(c.saves.con.bonus)} =</span><b>{conc.total}</b><span className={conc.ok ? "t-good" : "t-bad"}>{conc.ok ? "Holder Hunter's Mark" : "Mistet Hunter's Mark"}</span><button type="button" className="btn sm ghost" onClick={() => setConc(null)}>OK</button></div>
          )}
        </div>
      )}
    </div>
  );

  const resRow = (
    <>
      <div className="resgrid">
        {slotLevels.map((l) => <Res key={l} label={"Spell slots nv. " + l} n={slotLeft(l)} max={c.slots[l]} tone="acc" />)}
        {c.hm.max > 0 && <Res label="Gratis Hunter's Mark" n={hmLeft} max={c.hm.max} tone="gold" />}
        {c.ds && <Res label="Dreadful Strike" n={dsLeft} max={c.ds.max} tone="psy" />}
      </div>
      <div className="wrap">
        {c.umbralSight && <Toggle id="dark" on={dark} onClick={() => setDark(!dark)}>Jeg står i mørke</Toggle>}
        {hmOn && <span className="chip gold">🎯 Hunter's Mark aktiv <button type="button" className="link" onClick={() => setHmOn(false)}>avslutt</button></span>}
        {owlHelp && <span className="chip good">🦉 Advantage venter</span>}
        {hidden && <span className="chip good">Skjult: advantage venter</span>}
      </div>
    </>
  );

  // ── Elowens tur ──
  const elowenPanel = (
    <div className="stack panel">
      {hpBox}
      {resRow}
      <div className="card hl">
        <div className="wrap">
          <Econ label={c.attacksPerAction > 1 && t.actionType === "attack" ? "Angrep igjen: " + t.attacksLeft : "Action"} used={!!t.actionType && !(t.actionType === "attack" && t.attacksLeft > 0)} />
          <Econ label="Bonus action" used={t.bonus} />
          <Econ label={"Bevegelse " + speedNow + " ft"} info />
        </div>
        {round === 1 && c.ambusherLeap && !done.elowen && <Tip tone="psy"><b>Ambusher's Leap:</b> +10 ft speed denne turen. Klassisk åpning: Hunter's Mark (bonus action), så Longbow (action), så Dreadful Strike ved treff.</Tip>}
        {t.note && <Tip>{t.note}</Tip>}
      </div>

      {done.elowen && <Tip>Elowen har spilt runde {round}. Du kan fortsatt skrive inn skade i HP-boksen.</Tip>}

      {!done.elowen && (
        <>
          {atk && attackFor(atk)}
          {check && (
            <div className="card hl">
              <div className="card-title">Hide</div>
              <p className="small">Krever dekning eller tungt mørke. DC 15.</p>
              <D20Entry id="hide" label="Stealth" bonus={stealth} dc={15} onResult={gotHide} />
              <button type="button" className="btn ghost sm" onClick={() => setCheck(null)}>Avbryt</button>
            </div>
          )}

          <div className="two modes">
            <button type="button" className={"mode" + (mode === "ranged" ? " on" : "")} onClick={() => setMode("ranged")} aria-pressed={mode === "ranged"}>🏹 Avstand</button>
            <button type="button" className={"mode" + (mode === "melee" ? " on" : "")} onClick={() => setMode("melee")} aria-pressed={mode === "melee"}>⚔️ Fiende inntil meg</button>
          </div>

          <Section badge="ba" title="Bonus action" hint="én per tur">
            {c.hm.known && <Option title="Hunter's Mark" rec={!hmOn}
              sub={"Merk et mål: +1d" + c.hm.die + " skade per treff. Konsentrasjon. " + (hmLeft > 0 ? "Bruker gratis-kast (" + hmLeft + " igjen)." : anySlot ? "Bruker spell slot nivå " + anySlot + " (" + slotLeft(anySlot) + " igjen)." : "")}
              disabled={!!hmCastReason} reason={hmCastReason} onClick={castHm} />}
            {c.hm.known && <Option title="Flytt Hunter's Mark" sub="Når det merkede målet faller til 0 HP. Koster ingen ressurser." disabled={!!hmMoveReason} reason={hmMoveReason} onClick={moveHm} />}
            {mode === "melee" && lightExtras.filter((w) => w.mastery !== "Nick").map((w) => (
              <Option key={w.key} title={"Ekstra angrep: " + w.name} sub={"Light-regelen. " + sign(w.hit) + " · " + w.count + "d" + w.sides + " uten evnemodifikator."}
                disabled={!!bonusReason} reason={bonusReason} onClick={() => startAttack(w, "bonus")} />
            ))}
          </Section>

          <Section badge="act" title="Action" hint={c.attacksPerAction > 1 ? c.attacksPerAction + " angrep per Attack-action" : "én per tur"}>
            {(mode === "ranged" ? ranged : ranged.concat(melee)).map((w) => (
              <Option key={w.key} title={"Angrip med " + w.name} rec={w.ranged}
                sub={sign(w.hit) + " · " + w.count + "d" + w.sides + sign(w.mod) + " " + w.dmgType + " · " + w.range + (w.mastery ? " · " + w.mastery : "") + (mode === "melee" && w.ranged && c.sharpshooter ? " · Sharpshooter: ingen disadvantage selv om fienden står inntil deg" : mode === "melee" && w.ranged ? " · disadvantage når fienden står inntil deg" : "")}
                disabled={!!attackReason} reason={attackReason} onClick={() => startAttack(w, "main")} />
            ))}
            {mode === "melee" && lightExtras.filter((w) => w.mastery === "Nick").map((w) => (
              <Option key={"n" + w.key} title={"Nick: " + w.name + " (del av Action)"} sub={"Ekstra-angrep etter Light-våpen. " + sign(w.hit) + " · " + w.count + "d" + w.sides + " uten evnemodifikator. Bonus action er fortsatt ledig."}
                disabled={busy} reason="Gjør ferdig det du holder på med først" onClick={() => startAttack(w, "nick")} />
            ))}
            {mode === "melee" && !t.lightFrom && melee.some((w) => w.mastery === "Nick") && <p className="small dim">Tips: angrip med Dagger først. Da kan du ta Scimitar som Nick-angrep uten å bruke bonus action.</p>}
            {mode === "ranged" && <Option title="Hide" sub={"Stealth " + sign(stealth) + " mot DC 15. Krever dekning eller tungt mørke. Gir advantage på neste angrep."} disabled={!!actionReason} reason={actionReason} onClick={() => setCheck({ kind: "hide" })} />}
            {mode === "melee" && <Option title="Disengage" sub="Gå unna uten opportunity attacks." disabled={!!actionReason} reason={actionReason} onClick={() => simple("Disengage", "Disengage: du kan gå unna uten opportunity attacks denne turen.")} />}
            <Option title="Dash" sub="Dobbel bevegelse denne turen." disabled={!!actionReason} reason={actionReason} onClick={() => simple("Dash", "Dash: dobbel bevegelse denne turen.", { dash: true })} />
            <Option title="Dodge" sub="Angrep mot deg får disadvantage til din neste tur." disabled={!!actionReason} reason={actionReason} onClick={() => simple("Dodge", "Dodge: angrep mot deg har disadvantage til starten av din neste tur. Advantage på DEX saves.")} />
          </Section>

          <Tip>Du kan dele opp bevegelsen ({speedNow} ft) før og etter angrepet. Skyt, og gå så i dekning.</Tip>
          <button type="button" className="btn big" onClick={() => { setAtk(null); setCheck(null); markDone("elowen"); }} disabled={busy}>
            {busy ? "Gjør ferdig det du holder på med først" : "Ferdig med Elowens tur" + (nextName("elowen") ? " → " + nextName("elowen") : "")}
          </button>
        </>
      )}
    </div>
  );

  // ── Uglas tur ──
  const owlPanel = (
    <div className="stack panel">
      {done.owl ? <Tip>Ugla har spilt runde {round}.</Tip> : (
        <Section badge="act" title="Uglas action" hint="kan ikke angripe">
          <Option title="Help" rec sub="Ugla flyr inn til en fiende og ut igjen (Flyby: ingen opportunity attack). Elowen får advantage på neste angrep mot den fienden." onClick={() => { setOwlHelp(true); addLog("Ugla: Help → advantage på neste angrep"); markDone("owl"); }} />
          <Option title="Speide eller noe annet" sub="Ugla har Darkvision 120 ft og flyr 60 ft." onClick={() => { addLog("Ugla: gjorde noe annet"); markDone("owl"); }} />
        </Section>
      )}
    </div>
  );

  // ── Bjørnenes tur ──
  const petPanel = (x) => {
    const id = x.p.id;
    return (
      <div className="stack panel">
        <PetHp x={x} setPetState={setPetState} addLog={addLog} />
        {done[id] ? <Tip>{shortName(x.p.name)} har spilt runde {round}.</Tip> : (
          <PetTurn key={id + "-" + round} pet={x.p} ap={x.ap} ahBonus={ah} onLog={addLog} onDone={() => markDone(id)} />
        )}
      </div>
    );
  };

  // ── Kamp-fanen ──
  const setup = (
    <div className="stack">
      <div className="card hl">
        <span className="badge new">Ny kamp</span>
        <div className="card-title">Klar for kamp?</div>
        <div className="wrap">
          {c.umbralSight && <Toggle id="dark0" on={dark} onClick={() => setDark(!dark)}>Elowen står i mørke</Toggle>}
          {c.familiar && <Toggle id="owl" on={s.owl} onClick={() => update((p) => Object.assign({}, p, { owl: !p.owl }))}>Ugla er med</Toggle>}
        </div>
        <p className="small">Rull initiative med ekte terninger når DM ber om det, og skriv inn hva terningen viste. Fanene sorteres etter resultatet.</p>
      </div>
      {base.map((o) => (
        <div key={o.id} className="card init-card">
          <div className="init-head">
            <span className="card-title">{o.name}</span>
            {inits[o.id] && <span className="init-res">{inits[o.id].total}<button type="button" className="link dim" onClick={() => setInits((m) => { const n = Object.assign({}, m); delete n[o.id]; return n; })}>endre</button></span>}
          </div>
          {!inits[o.id] && <D20Entry id={"init-" + o.id} label={"Initiative" + (o.optional ? " (valgfritt)" : "")} bonus={o.bonus} compact onResult={gotInit(o)} />}
        </div>
      ))}
      <button type="button" className="btn big" onClick={startCombat}>Start runde 1 →</button>
    </div>
  );

  const fight = (
    <div className="stack">
      <div className="roundbar">
        <div className="round"><span className="round-n">Runde {round}</span></div>
        <div className="wrap">
          <button type="button" className="btn sm" onClick={nextRound}>Ny runde →</button>
          <button type="button" className="btn sm bad ghost" onClick={endCombat}>Avslutt kamp</button>
        </div>
      </div>
      <nav className="whotabs" aria-label="Hvem sin tur">
        {order.map((o) => (
          <button key={o.id} type="button" className={"whotab" + (who === o.id ? " on" : "") + (done[o.id] ? " done" : "")} onClick={() => setWho(o.id)} aria-pressed={who === o.id}>
            <span className="whotab-name">{done[o.id] ? "✓ " : ""}{o.name}{o.id === "elowen" && conc && conc.d == null ? " !" : ""}</span>
            <span className="whotab-meta">{inits[o.id] ? "init " + inits[o.id].total : "–"}</span>
          </button>
        ))}
      </nav>
      {allDone && (
        <div className="card hl">
          <div className="card-title">Alle har spilt runde {round}</div>
          <button type="button" className="btn big" onClick={nextRound}>Start runde {round + 1} →</button>
        </div>
      )}
      <div hidden={who !== "elowen"}>{elowenPanel}</div>
      {owlOn && <div hidden={who !== "owl"}>{owlPanel}</div>}
      {activePets.map((x) => <div key={x.p.id} hidden={who !== x.p.id}>{petPanel(x)}</div>)}
    </div>
  );

  const kamp = (
    <>
      {fighting ? fight : setup}
      {log.length > 0 && (
        <details className="card logcard">
          <summary>Kamplogg ({log.length})</summary>
          <div className="log">{log.map((e) => <div key={e.id} className="log-row">{e.r > 0 && <span className="log-r">R{e.r}</span>}{e.text}</div>)}</div>
        </details>
      )}
    </>
  );

  // ── Ark ──
  const nextLevel = c.classLevel + 1;
  const nextFeats = c.upcoming.filter((f) => f.level === nextLevel);
  const laterFeats = c.upcoming.filter((f) => f.level > nextLevel);
  const pbNext = 2 + Math.floor(c.level / 4);
  const ark = (
    <>
      <div className="card">
        <div className="card-title">Evneverdier</div>
        <div className="abgrid">
          {AB.map((a) => (
            <div key={a} className="ab">
              <div className="lbl">{ABL[a]}</div>
              <div className="ab-mod">{sign(c.mod[a])}</div>
              <div className="small dim">{c.scores[a]}</div>
              <div className={"small" + (c.saves[a].prof ? " strong" : " dim")}>save {sign(c.saves[a].bonus)}{c.saves[a].prof ? " ●" : ""}</div>
            </div>
          ))}
        </div>
        <p className="small dim">Proficiency bonus {sign(c.pb)} · Spell save DC {c.spellDc} · Spell attack {sign(c.spellAttack)} · ● = proficient</p>
      </div>

      <div className="card">
        <div className="card-title">Skills</div>
        <div className="skills">
          {c.skills.map((k) => (
            <div key={k.key} className={"skill" + (k.prof ? " prof" : "")}>
              <span>{k.prof === 2 ? "◆ " : k.prof ? "● " : ""}{k.name} <span className="dim small">{ABL[k.ab]}</span></span>
              <span className="num">{sign(k.bonus)}</span>
            </div>
          ))}
        </div>
        <p className="small dim">● proficient · ◆ expertise</p>
      </div>

      <div className="card">
        <div className="card-title">Våpen</div>
        <div className="tablewrap">
          <table className="tbl">
            <thead><tr><th>Våpen</th><th>Treff</th><th>Skade</th><th>Mastery</th></tr></thead>
            <tbody>{c.weapons.map((w) => <tr key={w.key}><td>{w.name}<div className="small dim">{w.range}</div></td><td className="num">{sign(w.hit)}</td><td className="num">{w.count}d{w.sides}{sign(w.mod)} {w.dmgType}</td><td>{w.mastery || "–"}</td></tr>)}</tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Spells</div>
        <div className="stack tight">
          {c.spells.map((sp) => (
            <div key={sp.name} className="spell">
              <span><b>{sp.name}</b> <span className="small dim">{sp.level === 0 ? "cantrip" : "nivå " + sp.level}{sp.concentration ? " · konsentrasjon" : ""}{sp.ritual ? " · ritual" : ""}</span></span>
              {sp.free > 0 && <span className="chip">{sp.free} gratis/LR</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="card hl">
        <span className="badge new">Neste nivå</span>
        <div className="card-title">Hva skjer på nivå {nextLevel}?</div>
        <ul className="small list">
          <li>HP: +1d{c.hitDie} {sign(c.mod.con)} (eller fast {Math.floor(c.hitDie / 2) + 1 + c.mod.con})</li>
          {pbNext > c.pb && <li>Proficiency bonus går til {sign(pbNext)}: alle angrep, skills og spell DC går opp med 1.</li>}
          {Object.keys(c.nextSlots).filter((l) => c.nextSlots[l] !== (c.slots[l] || 0)).map((l) => <li key={l}>Spell slots nivå {l}: {c.slots[l] || 0} → {c.nextSlots[l]}</li>)}
          {nextFeats.map((f) => <li key={f.name}><b>{f.name}</b>{f.desc ? ": " + f.desc.slice(0, 220) + (f.desc.length > 220 ? " …" : "") : ""}</li>)}
        </ul>
        {laterFeats.length > 0 && <p className="small dim">Senere: {laterFeats.map((f) => f.name + " (" + f.level + ")").join(", ")}</p>}
        <Tip>Gå opp i nivå på D&D Beyond først, og trykk så «Oppdater fra D&D Beyond» øverst. Da regnes alt her ut på nytt.</Tip>
      </div>

      <div className="card">
        <div className="card-title">Evner du har</div>
        <div className="stack tight">
          {c.features.filter((f) => !/^Core .* Traits$|Subclass$|Ability Score Improvement$/.test(f.name)).map((f) => (
            <details key={f.name} className="feat"><summary><b>{f.name}</b> <span className="small dim">nivå {f.level}</span></summary><p className="small">{f.desc}</p></details>
          ))}
        </div>
        <p className="small dim">Feats: {c.feats.join(", ")}</p>
      </div>
    </>
  );

  // ── Bjørner ──
  const TRAIT_KINDS = { ability: "Evneverdi", attack: "Treff-bonus", damage: "Skade-bonus", ac: "AC", hp: "Maks HP", speed: "Speed", maxCrit: "Krit mot monstrosity: all skade maks", obey: "Må adlyde: Animal Handling", note: "Notat" };
  const traitLabel = (tr) => tr.kind === "ability" ? sign(tr.delta) + " " + ABL[tr.stat] : tr.kind === "obey" ? "Animal Handling DC " + tr.dc + " for å adlyde" : tr.kind === "maxCrit" ? TRAIT_KINDS.maxCrit : tr.kind === "note" ? tr.text : sign(tr.delta) + " " + TRAIT_KINDS[tr.kind];
  const petsTab = (
    <>
      {pets.length === 0 && <div className="card"><p className="small">Ingen følgesvenner i dataene. Legg dem til under Extras på D&D Beyond og hent på nytt.</p></div>}
      {pets.map((x) => <PetCard key={x.p.id} x={x} ah={ah} traitLabel={traitLabel} kinds={TRAIT_KINDS} setPetState={setPetState} addLog={addLog} />)}
      <Tip>Trekkene lagres bare her og blir værende når du henter fra D&D Beyond på nytt. Notatet fra D&D Beyond vises på hver bjørn.</Tip>
    </>
  );

  // ── Tips ──
  const lb = c.weapons.find((w) => w.ranged);
  const tips = (
    <>
      {c.umbralSight && (
        <div className="card hl">
          <span className="badge new">Usynlig i mørket</span>
          <div className="card-title">Umbral Sight</div>
          <p className="small">I mørke er du usynlig for skapninger som bruker Darkvision for å se deg.</p>
          <div className="kv"><span>Dine angrep</span><b>Advantage</b><span>Angrep mot deg</span><b>Disadvantage</b><span>Fiender som sikter på deg</span><b>Må gjette hvor du er</b></div>
          <Tip><b>Virker ikke</b> i lys (fakler, Light, dagslys) eller mot fiender med Blindsight, Tremorsense eller Truesight. Be gruppen holde faklene unna deg. Din Darkvision er {c.darkvision} ft.</Tip>
        </div>
      )}
      {c.sharpshooter && lb && (
        <div className="card">
          <div className="card-title">Sharpshooter</div>
          <p className="small">Ingen disadvantage på lang avstand (opptil {lb.range.split("/")[1]}) eller når fienden står inntil deg, og du ignorerer half og three-quarters cover. Du trenger nesten aldri å bytte til nærkampvåpen.</p>
        </div>
      )}
      <div className="card">
        <div className="card-title">Advantage med ekte terninger</div>
        <p className="small">Advantage: rull to d20 og bruk den høyeste. Disadvantage: rull to og bruk den laveste. Har du begge deler, ruller du bare én. Ved kritisk treff (naturlig 20) ruller du dobbelt så mange skadeterninger, men legger bare til bonusen én gang.</p>
      </div>
      <div className="card">
        <div className="card-title">Si til DM</div>
        <ul className="say-list small">
          <li><q>Jeg ruller initiative med {sign(c.initiative)}.</q></li>
          {c.umbralSight && <li><q>Er det mørkt? Da er jeg usynlig via Umbral Sight.</q></li>}
          {c.hm.known && <li><q>Bonus action: Hunter's Mark på [fiende].</q></li>}
          {lb && <li><q>{lb.name}-skudd, jeg fikk [tall] for å treffe.</q></li>}
          {c.ds && <li><q>Treff! Jeg bruker Dreadful Strike, [tall] skade.</q></li>}
          {lb && lb.mastery === "Slow" && <li><q>Fienden får Slow, minus 10 ft speed.</q></li>}
          <li><q>Perception?</q> Du har {sign(c.skills.find((k) => k.key === "perception").bonus)} (passiv {c.passive.perception}).</li>
          <li><q>Survival for å følge sporene.</q> {sign(c.skills.find((k) => k.key === "survival").bonus)}</li>
          <li><q>Animal Handling på bjørnen.</q> {sign(ah)}</li>
        </ul>
      </div>
      <div className="card">
        <div className="card-title">Hvile</div>
        <p className="small">Long Rest fyller opp HP, spell slots, gratis Hunter's Mark, Dreadful Strike og bjørnenes HP.</p>
        <button type="button" className="btn big good" onClick={longRest}>🌙 Long Rest</button>
      </div>
    </>
  );

  return (
    <div className="page">
      {header}
      <ImportPanel key={s.importedAt || "x"} s={s} update={update} onImported={onImported} />
      {status === "saveerror" && <Tip tone="warn">Klarte ikke å lagre den siste endringen. Sjekk nettet, så lagres neste endring.</Tip>}
      {status === "nodb" && <Tip tone="warn">Lagring er ikke tilgjengelig her, så endringer blir ikke husket.</Tip>}
      {levelBanner}
      <nav className="tabs" aria-label="Faner">
        {TABS.map(([id, label]) => <button key={id} type="button" className={"tab" + (tab === id ? " on" : "")} onClick={() => setTab(id)} aria-pressed={tab === id}>{label}</button>)}
      </nav>
      {tab === "kamp" && kamp}
      {tab === "elowen" && ark}
      {tab === "pets" && petsTab}
      {tab === "tips" && tips}
    </div>
  );
}

// HP-linje for en bjørn i kamp
function PetHp({ x, setPetState, addLog }) {
  const { p, ap, hp } = x;
  const [v, setV] = useState("");
  const change = (dir) => {
    const n = parseInt(v, 10); if (!n || n < 0) return;
    setPetState(p.id, (cur) => Object.assign({}, cur, { hpRemoved: Math.min(ap.hpMax, Math.max(0, (cur.hpRemoved || 0) + (dir < 0 ? n : -n))) }));
    addLog(shortName(p.name) + (dir < 0 ? " tok " + n + " skade" : " helbredet " + n + " HP"));
    setV("");
  };
  return (
    <div className="card hpbox">
      <div className="hp-row">
        <div><span className="lbl">{shortName(p.name)} HP</span> <span className={"hp-num " + (hp > ap.hpMax / 2 ? "t-good" : hp > ap.hpMax / 4 ? "t-gold" : "t-bad")}>{hp}</span><span className="dim"> / {ap.hpMax}</span></div>
        <span className="small dim">AC {ap.ac} · {ap.speeds.map((s) => s.speed + " ft " + (MOVE[s.id] || "")).join(", ")}</span>
      </div>
      <div className="wrap">
        <input id={"phc-" + p.id} className="input num-in" type="number" inputMode="numeric" min="0" value={v} onChange={(e) => setV(e.target.value)} placeholder="Antall" aria-label={"HP for " + p.name} />
        <button type="button" className="btn sm bad" onClick={() => change(-1)}>Tok skade</button>
        <button type="button" className="btn sm good" onClick={() => change(1)}>Helbred</button>
      </div>
      {hp === 0 && <p className="small t-bad strong">{shortName(p.name)} er nede på 0 HP.</p>}
    </div>
  );
}
function PetCard({ x, ah, traitLabel, kinds, setPetState, addLog }) {
  const { p, st, ap, hp } = x;
  const [kind, setKind] = useState("ability");
  const [stat, setStat] = useState("str");
  const [delta, setDelta] = useState("1");
  const [dc, setDc] = useState("10");
  const [text, setText] = useState("");
  const [hpIn, setHpIn] = useState("");
  const pid = p.id;

  const add = () => {
    const tr = { id: "t" + Math.random().toString(36).slice(2, 8), kind };
    if (kind === "ability") { tr.stat = stat; tr.delta = parseInt(delta, 10) || 0; }
    else if (kind === "obey") tr.dc = parseInt(dc, 10) || 10;
    else if (kind === "note") { if (!text.trim()) return; tr.text = text.trim(); }
    else if (kind !== "maxCrit") tr.delta = parseInt(delta, 10) || 0;
    if ((kind === "maxCrit" || kind === "obey") && (st.traits || []).some((t) => t.kind === kind)) {
      setPetState(pid, (cur) => Object.assign({}, cur, { traits: cur.traits.map((t) => (t.kind === kind ? Object.assign({}, t, tr, { id: t.id }) : t)) }));
    } else setPetState(pid, (cur) => Object.assign({}, cur, { traits: (cur.traits || []).concat([tr]) }));
    setText("");
  };
  const remove = (id) => setPetState(pid, (cur) => Object.assign({}, cur, { traits: cur.traits.filter((t) => t.id !== id) }));
  const hpChange = (dir) => {
    const n = parseInt(hpIn, 10); if (!n || n < 0) return;
    setPetState(pid, (cur) => Object.assign({}, cur, { hpRemoved: Math.min(ap.hpMax, Math.max(0, (cur.hpRemoved || 0) + (dir < 0 ? n : -n))) }));
    addLog(p.name + (dir < 0 ? " tok " + n + " skade" : " helbredet " + n + " HP"));
    setHpIn("");
  };
  const atk = ap.attacks[0];

  return (
    <div className="card pet">
      <div className="pet-head">
        <div>
          <div className="card-title">{p.name}</div>
          <div className="meta">{p.kind} · AC {ap.ac} · {ap.speeds.map((s) => s.speed + " ft " + (MOVE[s.id] || "")).join(", ")}</div>
        </div>
        <Toggle on={st.inCombat !== false} onClick={() => setPetState(pid, (cur) => Object.assign({}, cur, { inCombat: cur.inCombat === false }))}>Med i kamp</Toggle>
      </div>

      <div className="hp-row"><div><span className="lbl">HP</span> <span className={"hp-num " + (hp > ap.hpMax / 2 ? "t-good" : hp > ap.hpMax / 4 ? "t-gold" : "t-bad")}>{hp}</span><span className="dim"> / {ap.hpMax}</span></div></div>
      <div className="wrap">
        <input id={"hp-" + pid} className="input num-in" type="number" inputMode="numeric" min="0" value={hpIn} onChange={(e) => setHpIn(e.target.value)} placeholder="Antall" aria-label={"HP for " + p.name} />
        <button type="button" className="btn sm bad" onClick={() => hpChange(-1)}>Tok skade</button>
        <button type="button" className="btn sm good" onClick={() => hpChange(1)}>Helbred</button>
      </div>

      <div className="abgrid">
        {AB.map((a) => {
          const changed = ap.stats[a] !== p.stats[a];
          return (
            <div key={a} className={"ab" + (changed ? " changed" : "")}>
              <div className="lbl">{ABL[a]}</div>
              <div className="ab-mod">{sign(ap.mod[a])}</div>
              <div className="small">{changed ? <><s className="dim">{p.stats[a]}</s> {ap.stats[a]}</> : p.stats[a]}</div>
            </div>
          );
        })}
      </div>
      {atk && <p className="small">{p.multiattack ? "Multiattack: " + p.multiattack.count + "× " : ""}<b>{atk.name}</b> {sign(atk.hit)} · {atk.count}d{atk.sides}{sign(atk.mod)} {atk.dmgType} · {atk.reach}</p>}
      {p.skills.length > 0 && <p className="small dim">{p.skills.map((k) => k.name + " " + sign(k.bonus)).join(" · ")} · Darkvision {p.senses.join(", ")}</p>}
      {p.notes && <Tip>Notat fra D&D Beyond: <q>{p.notes}</q></Tip>}

      <div className="sect-head"><Badge t="new">Trekk</Badge></div>
      <div className="stack tight">
        {(st.traits || []).length === 0 && <p className="small dim">Ingen trekk ennå.</p>}
        {(st.traits || []).map((tr) => (
          <div key={tr.id} className="trait"><span>{traitLabel(tr)}</span><button type="button" className="link" onClick={() => remove(tr.id)} aria-label={"Fjern " + traitLabel(tr)}>fjern</button></div>
        ))}
      </div>
      <div className="addtrait">
        <select id={"kind-" + pid} className="input" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type trekk">
          {Object.keys(kinds).map((k) => <option key={k} value={k}>{kinds[k]}</option>)}
        </select>
        {kind === "ability" && (
          <select id={"stat-" + pid} className="input" value={stat} onChange={(e) => setStat(e.target.value)} aria-label="Evneverdi">
            {AB.map((a) => <option key={a} value={a}>{ABL[a]}</option>)}
          </select>
        )}
        {["ability", "attack", "damage", "ac", "hp", "speed"].indexOf(kind) >= 0 && <input id={"delta-" + pid} className="input num-in" type="number" value={delta} onChange={(e) => setDelta(e.target.value)} aria-label="Endring" />}
        {kind === "obey" && <input id={"dc-" + pid} className="input num-in" type="number" value={dc} onChange={(e) => setDc(e.target.value)} aria-label="DC" />}
        {kind === "note" && <input id={"note-" + pid} className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Skriv notat" aria-label="Notat" />}
        <button type="button" className="btn sm" onClick={add}>Legg til</button>
      </div>
      {ap.flags.obey && <p className="small dim">Før hver tur ruller Elowen Animal Handling ({sign(ah)}) mot DC {ap.flags.obey}.</p>}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
