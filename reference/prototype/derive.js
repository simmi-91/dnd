// Utregning fra D&D Beyond character-service JSON (v5) til et kompakt ark.
// Ren funksjon: ingen DOM, ingen nettverk. Brukes både av siden og for testing.

var DDB = (function () {
  var AB = ["str", "dex", "con", "int", "wis", "cha"];
  var ABN = { str: "strength", dex: "dexterity", con: "constitution", int: "intelligence", wis: "wisdom", cha: "charisma" };
  var SKILLS = [
    ["acrobatics", "Acrobatics", "dex"], ["animal-handling", "Animal Handling", "wis"], ["arcana", "Arcana", "int"],
    ["athletics", "Athletics", "str"], ["deception", "Deception", "cha"], ["history", "History", "int"],
    ["insight", "Insight", "wis"], ["intimidation", "Intimidation", "cha"], ["investigation", "Investigation", "int"],
    ["medicine", "Medicine", "wis"], ["nature", "Nature", "int"], ["perception", "Perception", "wis"],
    ["performance", "Performance", "cha"], ["persuasion", "Persuasion", "cha"], ["religion", "Religion", "int"],
    ["sleight-of-hand", "Sleight of Hand", "dex"], ["stealth", "Stealth", "dex"], ["survival", "Survival", "wis"],
  ];
  // D&D Beyond sine skill-id-er for monstre
  var CREATURE_SKILL = { 2: "Athletics", 3: "Acrobatics", 4: "Sleight of Hand", 5: "Stealth", 6: "Arcana", 7: "History", 8: "Investigation", 9: "Nature", 10: "Religion", 11: "Animal Handling", 12: "Insight", 13: "Medicine", 14: "Perception", 15: "Survival", 16: "Deception", 17: "Intimidation", 18: "Performance", 19: "Persuasion" };
  var MASTERY = {
    Slow: "Målet får −10 ft speed til starten av din neste tur.",
    Nick: "Ekstra-angrepet fra Light kan gjøres som del av Action i stedet for bonus action.",
    Vex: "Ved treff får du advantage på neste angrep mot samme mål.",
    Sap: "Ved treff får målet disadvantage på sitt neste angrep.",
    Push: "Ved treff kan du dytte målet 10 ft unna deg.",
    Topple: "Ved treff må målet klare en CON save, ellers blir det Prone.",
    Graze: "Ved bom gjør du likevel skade lik modifikatoren din.",
    Cleave: "Ved treff kan du angripe en annen fiende innen 5 ft én gang per tur.",
  };
  var WORDNUM = { one: 1, two: 2, three: 3, four: 4, five: 5 };

  function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] || 0; return s; }
  function norm(s) { return String(s || "").replace(/[’‘]/g, "'").trim(); }
  function strip(html) { return String(html || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&mdash;/g, "—").replace(/&ndash;/g, "–").replace(/\s+/g, " ").trim(); }
  function modOf(score) { return Math.floor((score - 10) / 2); }

  function deriveCharacter(raw) {
    var d = raw && raw.data ? raw.data : raw;
    if (!d || !d.stats || !d.classes) throw new Error("Dette ser ikke ut som en D&D Beyond-karakter.");

    var mods = [];
    Object.keys(d.modifiers || {}).forEach(function (k) { (d.modifiers[k] || []).forEach(function (m) { if (m) mods.push(Object.assign({ group: k }, m)); }); });
    function modsOf(type, subType) { return mods.filter(function (m) { return m.type === type && m.subType === subType; }); }

    // Evneverdier
    var scores = {};
    AB.forEach(function (a, i) {
      var id = i + 1;
      var find = function (arr) { var o = (arr || []).find(function (s) { return s.id === id; }); return o ? o.value : null; };
      var s = (find(d.stats) || 10) + (find(d.bonusStats) || 0);
      s += sum(modsOf("bonus", ABN[a] + "-score").map(function (m) { return m.value; }));
      var sets = modsOf("set", ABN[a] + "-score").map(function (m) { return m.value || 0; });
      if (sets.length) s = Math.max.apply(null, [s].concat(sets));
      var ov = find(d.overrideStats);
      scores[a] = ov != null ? ov : s;
    });
    var mod = {}; AB.forEach(function (a) { mod[a] = modOf(scores[a]); });

    var level = sum(d.classes.map(function (c) { return c.level; }));
    var pb = 2 + Math.floor((level - 1) / 4);
    var main = d.classes.find(function (c) { return c.isStartingClass; }) || d.classes[0];
    var classLevel = main.level;

    // Evner (class + subclass), sortert etter nivå
    var featById = {};
    d.classes.forEach(function (c) {
      var lists = [c.definition && c.definition.classFeatures, c.subclassDefinition && c.subclassDefinition.classFeatures];
      lists.forEach(function (list, li) {
        (list || []).forEach(function (f) {
          if (featById[f.id]) return;
          featById[f.id] = { id: f.id, name: norm(f.name), level: f.requiredLevel, sub: li === 1 && !(c.definition.classFeatures || []).some(function (x) { return x.id === f.id; }), cls: c.definition.name, desc: strip(f.description).slice(0, 600) };
        });
      });
    });
    var allFeatures = Object.keys(featById).map(function (k) { return featById[k]; }).sort(function (a, b) { return a.level - b.level; });
    var features = allFeatures.filter(function (f) { return f.level <= classLevel; });
    var upcoming = allFeatures.filter(function (f) { return f.level > classLevel && f.level <= classLevel + 3; });
    function has(name) { return features.some(function (f) { return f.name.toLowerCase() === name.toLowerCase(); }); }

    var feats = (d.feats || []).map(function (f) { return norm(f.definition && f.definition.name); }).filter(Boolean);
    var hasFeat = function (n) { return feats.indexOf(n) >= 0; };

    // Ferdigheter og saves
    var prof = {}, exp = {};
    modsOf("proficiency").forEach(function () {});
    mods.forEach(function (m) { if (m.type === "proficiency") prof[m.subType] = true; if (m.type === "expertise") exp[m.subType] = true; });
    var skills = SKILLS.map(function (s) {
      var p = exp[s[0]] ? 2 : prof[s[0]] ? 1 : 0;
      var b = mod[s[2]] + p * pb + sum(modsOf("bonus", s[0]).map(function (m) { return m.value; }));
      return { key: s[0], name: s[1], ab: s[2], prof: p, bonus: b };
    });
    var skill = function (k) { return skills.find(function (s) { return s.key === k; }).bonus; };
    var saves = {};
    AB.forEach(function (a) { var p = !!prof[ABN[a] + "-saving-throws"]; saves[a] = { prof: p, bonus: mod[a] + (p ? pb : 0) }; });

    // HP
    var hpMax = d.overrideHitPoints != null ? d.overrideHitPoints
      : d.baseHitPoints + (d.bonusHitPoints || 0) + level * mod.con
        + level * sum(modsOf("bonus", "hit-points-per-level").map(function (m) { return m.value; }))
        + sum(modsOf("bonus", "hit-points").map(function (m) { return m.value; }));

    // Utstyr
    var equipped = (d.inventory || []).filter(function (i) { return i.equipped; });
    var armor = equipped.find(function (i) { return i.definition.filterType === "Armor" && i.definition.armorTypeId && i.definition.armorTypeId < 4; });
    var shield = equipped.find(function (i) { return i.definition.armorTypeId === 4; });
    var itemBonus = function (item, sub) { return sum(((item && item.definition.grantedModifiers) || []).filter(function (m) { return m.type === "bonus" && m.subType === sub; }).map(function (m) { return m.value; })); };
    var ac;
    if (armor) {
      var t = armor.definition.armorTypeId;
      var dexPart = t === 1 ? mod.dex : t === 2 ? Math.min(2, mod.dex) : 0;
      ac = armor.definition.armorClass + dexPart + itemBonus(armor, "armor-class");
    } else ac = 10 + mod.dex;
    if (shield) ac += (shield.definition.armorClass || 2) + itemBonus(shield, "armor-class");
    ac += sum(mods.filter(function (m) { return m.type === "bonus" && m.subType === "armor-class" && m.group !== "item"; }).map(function (m) { return m.value; }));

    // Speed og sanser
    var race = d.race || {};
    var speed = (race.weightSpeeds && race.weightSpeeds.normal && race.weightSpeeds.normal.walk) || 30;
    var setSpeed = modsOf("set", "innate-speed-walking").map(function (m) { return m.value; });
    if (setSpeed.length) speed = Math.max.apply(null, setSpeed);
    var speedBonus = sum(mods.filter(function (m) { return m.type === "bonus" && (m.subType === "speed" || m.subType === "speed-walking" || m.subType === "unarmored-movement"); }).map(function (m) { return m.value; }));
    if (has("Roving") && !speedBonus && !(armor && armor.definition.armorTypeId === 3)) speedBonus = 10;
    speed += speedBonus;
    var dvBase = Math.max.apply(null, [0].concat(modsOf("set-base", "darkvision").map(function (m) { return m.value; })));
    var darkvision = dvBase + sum(modsOf("sense", "darkvision").map(function (m) { return m.value; }));

    // Initiativ
    var initiative = mod.dex + sum(modsOf("bonus", "initiative").map(function (m) {
      if (m.value != null) return m.value;
      if (m.statId) return mod[AB[m.statId - 1]];
      return has("Dread Ambusher") ? mod.wis : 0;
    }));

    // Våpen
    var masteries = mods.filter(function (m) { return m.type === "weapon-mastery"; }).map(function (m) {
      var mm = String(m.friendlySubtypeName || "").match(/^(\w+)\s*\(([^,)]+)/);
      return mm ? { mastery: mm[1], weapon: mm[2].trim() } : null;
    }).filter(Boolean);
    var rangedBonus = sum(modsOf("bonus", "ranged-weapon-attacks").map(function (m) { return m.value; }));
    var meleeBonus = sum(modsOf("bonus", "melee-weapon-attacks").map(function (m) { return m.value; }));
    var count = {};
    var weapons = equipped.filter(function (i) { return i.definition.filterType === "Weapon" && i.definition.damage; }).map(function (i) {
      var w = i.definition;
      var props = (w.properties || []).map(function (p) { return p.name; });
      var ranged = w.attackType === 2;
      var finesse = props.indexOf("Finesse") >= 0;
      var ab = ranged ? "dex" : finesse ? (mod.dex >= mod.str ? "dex" : "str") : "str";
      var type = w.type || w.name;
      var slug = type.toLowerCase().replace(/[^a-z]+/g, "-");
      var proficient = !!(prof[w.categoryId === 2 ? "martial-weapons" : "simple-weapons"] || prof[slug]);
      var magic = itemBonus(i, "magic");
      var hit = mod[ab] + (proficient ? pb : 0) + (ranged ? rangedBonus : meleeBonus) + magic;
      var m = masteries.find(function (x) { return x.weapon.toLowerCase() === type.toLowerCase(); });
      count[type] = (count[type] || 0) + 1;
      return {
        key: "w" + i.id, name: w.name + (count[type] > 1 ? " #" + count[type] : ""), type: type,
        hit: hit, count: w.damage.diceCount || 1, sides: w.damage.diceValue || 1, mod: mod[ab] + magic, abMod: mod[ab],
        dmgType: String(w.damageType || "").toLowerCase(), ranged: ranged,
        range: ranged || props.indexOf("Thrown") >= 0 ? w.range + "/" + w.longRange + " ft" : (w.range || 5) + " ft",
        light: props.indexOf("Light") >= 0, thrown: props.indexOf("Thrown") >= 0, heavy: props.indexOf("Heavy") >= 0,
        mastery: m ? m.mastery : null, masteryText: m ? MASTERY[m.mastery] || "" : null,
      };
    });

    // Magi
    var rules = (main.definition && main.definition.spellRules) || {};
    var slotRow = (rules.levelSpellSlots || [])[classLevel] || [];
    var slots = {};
    slotRow.forEach(function (n, i) { if (n > 0) slots[i + 1] = n; });
    var castAb = main.definition && main.definition.spellCastingAbilityId ? AB[main.definition.spellCastingAbilityId - 1] : "wis";
    var spells = [];
    var seen = {};
    function addSpell(s, source) {
      var def = s.definition || {};
      var name = norm(def.name);
      var lu = s.limitedUse;
      var key = name + "|" + source + "|" + (lu ? "lu" : "");
      if (!name || seen[key]) return;
      seen[key] = true;
      spells.push({ name: name, level: def.level || 0, source: source, free: lu ? lu.maxUses || 1 : 0, concentration: !!def.concentration, ritual: !!def.ritual, time: def.activation ? def.activation.activationType : null });
    }
    Object.keys(d.spells || {}).forEach(function (k) { (d.spells[k] || []).forEach(function (s) { addSpell(s, k); }); });
    (d.classSpells || []).forEach(function (c) { (c.spells || []).forEach(function (s) { if (s.prepared || s.alwaysPrepared || (s.definition && s.definition.level === 0)) addSpell(s, "class"); }); });
    // Slå sammen dubletter (samme navn), behold info om gratis-kast
    var byName = {};
    spells.forEach(function (s) { var e = byName[s.name]; if (!e) byName[s.name] = s; else e.free = Math.max(e.free, s.free); });
    spells = Object.keys(byName).map(function (k) { return byName[k]; }).sort(function (a, b) { return a.level - b.level || a.name.localeCompare(b.name); });

    // Begrensede ressurser fra D&D Beyond (maks og brukt)
    var limited = {};
    Object.keys(d.actions || {}).forEach(function (k) {
      (d.actions[k] || []).forEach(function (a) {
        var lu = a.limitedUse; if (!lu) return;
        var max = lu.maxUses || 0;
        if (lu.statModifierUsesId) max = Math.max(1, mod[AB[lu.statModifierUsesId - 1]]);
        if (lu.useProficiencyBonus) max = pb;
        limited[norm(a.name)] = { max: max, used: lu.numberUsed || 0 };
      });
    });
    var hm = limited["Hunter's Mark"] || { max: 0, used: 0 };
    var ds = limited["Dreadful Strike"] || { max: has("Dread Ambusher") ? Math.max(1, mod.wis) : 0, used: 0 };

    var lineageOpt = ((d.options && d.options.race) || []).map(function (o) { return norm(o.definition && o.definition.name); }).find(function (n) { return /Lineage$/.test(n); });

    // Følgesvenner (Extras)
    var notesById = {};
    (d.characterValues || []).forEach(function (v) { if (v.typeId === 47 && v.value) notesById[String(v.valueId)] = (notesById[String(v.valueId)] ? notesById[String(v.valueId)] + " " : "") + v.value; });
    var pets = (d.creatures || []).map(function (c) {
      var def = c.definition || {};
      var st = {};
      (def.stats || []).forEach(function (s) { st[AB[s.statId - 1]] = s.value; });
      var actionsText = strip(def.actionsDescription);
      var attacks = [];
      var re = /([A-Z][A-Za-z' ]{1,30})\.\s*(Melee|Ranged)(?: or Ranged)? (?:Weapon )?Attack(?: Roll)?:\s*\+(\d+),\s*(?:reach|range) ([^.]*?ft)\.?.*?Hit:\s*(\d+)\s*\((\d+)d(\d+)\s*(?:([+−-])\s*(\d+))?\)\s*(\w+) damage/g;
      var mm;
      while ((mm = re.exec(actionsText))) {
        var dm = mm[9] ? (mm[8] === "+" ? 1 : -1) * +mm[9] : 0;
        attacks.push({ name: mm[1].trim(), melee: mm[2] === "Melee", hit: +mm[3], reach: mm[4], count: +mm[6], sides: +mm[7], mod: dm, dmgType: mm[10].toLowerCase() });
      }
      var multi = actionsText.match(/makes (one|two|three|four|five|\d) ([A-Z][A-Za-z']+)/);
      var speeds = (def.movements || []).map(function (m) { return { id: m.movementId, speed: m.speed }; });
      return {
        id: String(c.id), name: norm(c.name), kind: norm(def.name), typeId: def.typeId,
        ac: def.armorClass, hpMax: def.averageHitPoints, hitDice: def.hitPointDice ? def.hitPointDice.diceCount : 0,
        hpRemoved: c.removedHitPoints || 0, tempHp: c.temporaryHitPoints || 0,
        stats: st, speeds: speeds,
        skills: (def.skills || []).map(function (s) { return { name: CREATURE_SKILL[s.skillId] || "Skill " + s.skillId, bonus: s.value }; }),
        senses: (def.senses || []).map(function (s) { return s.notes; }),
        attacks: attacks,
        multiattack: multi ? { count: WORDNUM[multi[1]] || +multi[1], attack: multi[2] } : null,
        actionsText: actionsText.slice(0, 1200),
        traitsText: strip(def.specialTraitsDescription).slice(0, 800),
        notes: notesById[String(c.id)] || strip(c.description) || "",
      };
    });

    return {
      v: 1, id: d.id, name: d.name, avatar: d.decorations && d.decorations.avatarUrl,
      race: race.fullName || race.baseName, lineage: lineageOpt ? lineageOpt.replace(/ Lineage$/, "") : null,
      cls: main.definition.name, subclass: main.subclassDefinition ? main.subclassDefinition.name : null,
      level: level, classLevel: classLevel, pb: pb, xp: d.currentXp,
      scores: scores, mod: mod, saves: saves, skills: skills,
      passive: { perception: 10 + skill("perception"), insight: 10 + skill("insight"), investigation: 10 + skill("investigation") },
      hpMax: hpMax, hpRemoved: d.removedHitPoints || 0, tempHp: d.temporaryHitPoints || 0,
      hitDie: main.definition.hitDice, ac: ac, armor: armor ? armor.definition.name : null,
      speed: speed, darkvision: darkvision, initiative: initiative,
      weapons: weapons, feats: feats,
      sharpshooter: hasFeat("Sharpshooter"),
      attacksPerAction: has("Extra Attack") ? 2 : 1,
      castAb: castAb, spellDc: 8 + pb + mod[castAb], spellAttack: pb + mod[castAb],
      slots: slots, spells: spells,
      hm: { max: hm.max, used: hm.used, die: has("Foe Slayer") ? 10 : 6, known: spells.some(function (s) { return s.name === "Hunter's Mark"; }) },
      ds: has("Dread Ambusher") ? { max: ds.max, used: ds.used, dice: has("Stalker's Flurry") ? 8 : 6 } : null,
      ambusherLeap: has("Dread Ambusher"), umbralSight: has("Umbral Sight"),
      familiar: spells.some(function (s) { return s.name === "Find Familiar"; }),
      features: features.map(function (f) { return { name: f.name, level: f.level, sub: f.sub, desc: f.desc }; }),
      upcoming: upcoming.map(function (f) { return { name: f.name, level: f.level, sub: f.sub, desc: f.desc }; }),
      nextSlots: (function () { var r = (rules.levelSpellSlots || [])[classLevel + 1] || []; var o = {}; r.forEach(function (n, i) { if (n > 0) o[i + 1] = n; }); return o; })(),
      pets: pets,
      dateModified: d.dateModified,
    };
  }

  // Lag start-trekk for en følgesvenn ut fra notatet i D&D Beyond
  function seedPetTraits(notes) {
    var t = [];
    var n = String(notes || "");
    var re = /([+-]\s*\d+)\s*(str|dex|con|int|wis|cha)\b/gi, m;
    while ((m = re.exec(n))) t.push({ id: "t" + t.length + Math.random().toString(36).slice(2, 6), kind: "ability", stat: m[2].toLowerCase(), delta: parseInt(m[1].replace(/\s/g, ""), 10) });
    if (/crit/i.test(n) && /monstros/i.test(n) && /max/i.test(n)) t.push({ id: "tcrit", kind: "maxCrit" });
    if (/animal handling/i.test(n)) t.push({ id: "tobey", kind: "obey", dc: 10 });
    return t;
  }

  // Bruk trekk på en følgesvenn
  function applyPetTraits(p, traits) {
    var stats = Object.assign({}, p.stats);
    var atk = 0, dmg = 0, ac = 0, hp = 0, speed = 0;
    var flags = { maxCrit: false, obey: null };
    (traits || []).forEach(function (t) {
      if (t.kind === "ability" && stats[t.stat] != null) stats[t.stat] += t.delta || 0;
      if (t.kind === "attack") atk += t.delta || 0;
      if (t.kind === "damage") dmg += t.delta || 0;
      if (t.kind === "ac") ac += t.delta || 0;
      if (t.kind === "hp") hp += t.delta || 0;
      if (t.kind === "speed") speed += t.delta || 0;
      if (t.kind === "maxCrit") flags.maxCrit = true;
      if (t.kind === "obey") flags.obey = t.dc || 10;
    });
    var dStr = modOf(stats.str) - modOf(p.stats.str);
    var dDex = modOf(stats.dex) - modOf(p.stats.dex);
    var dCon = modOf(stats.con) - modOf(p.stats.con);
    var attacks = p.attacks.map(function (a) {
      var dA = a.melee ? dStr : dDex;
      return Object.assign({}, a, { hit: a.hit + dA + atk, mod: a.mod + dA + dmg });
    });
    var mods = {}; AB.forEach(function (a) { mods[a] = modOf(stats[a] || 10); });
    return {
      stats: stats, mod: mods, attacks: attacks,
      ac: p.ac + ac + dDex * 0, hpMax: p.hpMax + dCon * (p.hitDice || 0) + hp,
      speeds: p.speeds.map(function (s) { return { id: s.id, speed: s.speed + speed }; }),
      initiative: mods.dex, flags: flags,
    };
  }

  return { deriveCharacter: deriveCharacter, seedPetTraits: seedPetTraits, applyPetTraits: applyPetTraits, modOf: modOf, AB: AB };
})();
