/* ==========================================================================
   EVONY PVE BOSS PREDICTOR — v4.0
   Battle engine ported from the Game-EvonyTKR Monster Simulator (see
   METHODOLOGY.md). Deterministic. No randomness, no network calls, no
   backend. Same inputs always produce the same outputs.

   DATA SOURCE:
   The ONLY monster/boss database used by this app is BOSS_DATA, defined in
   data.js (loaded before this file). It contains the full monster list,
   every lookup table (troop base stats, tier-vs-boss modifiers, world-boss
   modifiers, alliance-boss modifiers) and every constant the engine needs.
   There is no other boss list and no duplicate battle engine anywhere in
   this project.

   ENGINE MODEL NOTE (see METHODOLOGY.md):
   This is a single-exchange calculator, not a multi-round simulation:
     - "Boss Attack/Defense Debuff %" reduce the monster's attack/defense.
     - The monster's HP is never debuffed anywhere in the reference
       engine — the "Boss HP Debuff %" field is kept
       in the UI for input continuity but, per the reference engine, has
       no effect on the calculation.
     - "min_troops_to_kill" and "expected_wounds" are both computed
       directly from closed-form formulas — no binary search.
   This app additionally derives a Victory/Defeat call, a wounded troop
   count/percentage, and a Confidence label from those two figures so the
   results table can present it:
     - Victory  = your march size >= min_troops_to_kill for that monster.
     - Wounded  = expected_wounds (capped to your march size) on a Victory;
                  your whole march on a Defeat.
   ========================================================================== */

/* ----------------------------- CONSTANTS -------------------------------- */

const REF         = BOSS_DATA.referenceTables;
const CONST        = BOSS_DATA.constants;
const MONSTERS     = BOSS_DATA.monsters;

const TIER_VALUES         = CONST.tierValues;                   // ["T1",...,"T17"]
const WORLD_BOSS_ORDERS    = CONST.worldBossOrders;                // { "321": "Lord of Lava", ... }
const ALLIANCE_BOSS_ORDERS = new Set(CONST.allianceBossOrders);   // [693,694,695]

const VERY_HIGH_CONFIDENCE_WOUND_THRESHOLD = 0.001; // <=0.1% wounded on a Victory

function tierToNumber(tier){
  const m = /^T(\d+)$/i.exec(tier || "");
  return m ? Number(m[1]) : 0;
}

function isWorldBoss(order){
  return Object.prototype.hasOwnProperty.call(WORLD_BOSS_ORDERS, String(order));
}
function isAllianceBoss(order){
  return ALLIANCE_BOSS_ORDERS.has(order);
}

/* ---------------------------- CORE ENGINE --------------------------------
   Port of the reference simulator's simulate() routine.
   The player's own buff inputs are entered in this UI as a single combined
   percentage per stat (no basic/march/monster/misc/rally breakdown, and no
   march_type selector) — so total_*_buff_pct is just that percentage, with
   no troop-side debuffs applied (this UI has none), matching the "solo"
   march-type case with all optional categories at 0.
   -------------------------------------------------------------------------- */

function getBaseStat(table, tier, troopType){
  const row = table[tier];
  return row ? (row[troopType] ?? 0) : 0;
}

/** Troop modifier, evaluated in this exact branch order. */
function troopModifierFor(monster, tier, troopType){
  if (isWorldBoss(monster.order)){
    const name = WORLD_BOSS_ORDERS[String(monster.order)];
    const mods = REF.worldBossModifiers[name];
    return mods ? (mods[troopType] ?? 1.0) : 1.0;
  }
  if (isAllianceBoss(monster.order)){
    // No alliance_boss_modifier selector exists in this UI, so the optional
    // +/-20% adjustment never applies — same as the
    // reference simulator's current behavior.
    const mods = REF.allianceBossModifiers[tier];
    return mods ? (mods[troopType] ?? 1.0) : 1.0;
  }
  if (monster.monsterType === "common"){
    const tierNum = tierToNumber(tier);
    if (tierNum <= 10) return 1.0;
    if (troopType === "mounted") return 1.1;
    if (troopType === "siege") return 0.5;
    return 1.0;
  }
  if (monster.monsterType === "boss"){
    const mods = REF.tierModifiersVsBoss[tier];
    return mods ? (mods[troopType] ?? 1.0) : 1.0;
  }
  // Fallback: summon / collection / resource / pyramid / unknown.
  return (monster.troopModifiers && monster.troopModifiers[troopType]) ?? 1.0;
}

/**
 * Runs the full single-exchange calculation for one monster.
 * Mirrors the reference simulator's simulate() routine,
 * with buffs/debuffs mapped from this UI's simplified inputs.
 */
function simulateMonster(monster, inputs){
  const tier = inputs.tier;
  const troopType = inputs.troopType;

  const baseAttack  = getBaseStat(REF.troopBaseAttack,  tier, troopType);
  const baseDefense = getBaseStat(REF.troopBaseDefense, tier, troopType);
  const baseHp      = getBaseStat(REF.troopBaseHp,      tier, troopType);

  const totalAttackBuffPct  = (Number(inputs.attackPct)  || 0) / 100;
  const totalDefenseBuffPct = (Number(inputs.defensePct) || 0) / 100;
  const totalHpBuffPct      = (Number(inputs.hpPct)       || 0) / 100;

  // Player final per-troop stats . No flat buffs in this UI.
  const playerAttack  = baseAttack  * (1 + totalAttackBuffPct);
  const playerDefense = baseDefense * (1 + totalDefenseBuffPct);
  const playerHp       = baseHp      * (1 + totalHpBuffPct);

  const clampPct = (v) => Math.max(0, Math.min(100, Number(v) || 0)) / 100;
  const monsterAttackDebuff  = clampPct(inputs.bossAtkDebuff);
  const monsterDefenseDebuff = clampPct(inputs.bossDefDebuff);

  // Monster final stats . HP is never debuffed.
  const monsterAttack  = monster.attack  * (1 - monsterAttackDebuff);
  const monsterDefense = monster.defense * (1 - monsterDefenseDebuff);
  const monsterHp      = monster.hp;

  const troopModifier = troopModifierFor(monster, tier, troopType);

  // Damage output .
  const damagePerTroop = playerAttack * troopModifier;
  const denom = playerAttack + monsterDefense;
  const effectiveDamage = denom > 0 ? damagePerTroop * (playerAttack / denom) : 0;

  // Minimum troops to kill .
  let minTroopsToKill = 0;
  if (effectiveDamage > 0 && monster.troopCount){
    minTroopsToKill = Math.floor((monsterHp * monster.troopCount) / effectiveDamage) + 1;
  }

  // Expected wounds .
  let expectedWounds = 0;
  if (playerHp > 0 && monsterAttack > 0){
    expectedWounds = Math.floor((monsterAttack * (monster.troopCount || 0)) / playerHp);
  }

  return {
    playerAttack, playerDefense, playerHp,
    monsterAttack, monsterDefense, monsterHp,
    troopModifier, damagePerTroop, effectiveDamage,
    minTroopsToKill, expectedWounds,
  };
}

function confidenceLabel(victory, woundedFraction){
  if (!victory) return { text: "None", cls: "tag-defeat" };
  if (woundedFraction <= VERY_HIGH_CONFIDENCE_WOUND_THRESHOLD) return { text: "Very High", cls: "tag-victory" };
  if (woundedFraction <= 0.15) return { text: "High", cls: "tag-victory" };
  if (woundedFraction <= 0.35) return { text: "Medium", cls: "tag-warn" };
  return { text: "Low", cls: "tag-warn" };
}

/**
 * Derives the results-table row (Victory/Defeat, wounded, recommended
 * march, confidence) from the simulateMonster() output.
 */
function predictMonster(monster, inputs){
  const sim = simulateMonster(monster, inputs);
  const marchSize = inputs.marchSize;

  const recommendedMarch = sim.minTroopsToKill > 0 ? sim.minTroopsToKill : null;
  let victory;
  if (recommendedMarch !== null){
    victory = marchSize >= recommendedMarch;
  } else if (!monster.troopCount){
    // Monster has no troops to fight — trivially already defeated.
    victory = marchSize > 0;
  } else {
    // effectiveDamage is 0 — this march can never damage the monster.
    victory = false;
  }

  let wounded, woundedFraction;
  if (victory){
    wounded = Math.max(0, Math.min(marchSize, sim.expectedWounds));
    woundedFraction = marchSize > 0 ? wounded / marchSize : 0;
  } else {
    wounded = marchSize;
    woundedFraction = marchSize > 0 ? 1 : 0;
  }

  return {
    boss: monster,
    sim,
    victory,
    wounded,
    woundPct: woundedFraction * 100,
    woundedFraction,
    recommendedMarch,
    confidence: confidenceLabel(victory, woundedFraction),
  };
}

/* -------------------------------- UI ------------------------------------- */

const els = {};
["troopType","troopTier","marchSize","attackPct","defensePct","hpPct",
 "bossAtkDebuff","bossDefDebuff","bossHpDebuff",
 "statForm","resultsPanel","resultsSummary","resultsBody","resultsTable","resultsCards",
 "dashboard","dashTotal","dashVictories","dashDefeats","dashAvgWounded","dashHighest","dashLowest",
 "bossSearch","filterVictory","filterDefeat","filterConfidence","clearFiltersBtn","filterEmptyMsg",
 "detailPanel","detailTitle","detailBody","logForm","logResult","logWounded","issueBtn",
 "logBody","exportLogBtn","clearLogBtn"
].forEach(id => els[id] = document.getElementById(id));

let lastResults = [];
let currentDetail = null;
let sortState = { key: null, dir: 1 };
let filterState = { search: "", showVictory: true, showDefeat: true, confidence: "all" };

function populateTierSelect(){
  els.troopTier.innerHTML = "";
  const frag = document.createDocumentFragment();
  TIER_VALUES.forEach(tier => {
    const opt = document.createElement("option");
    opt.value = tier;
    opt.textContent = tier;
    if (tier === "T13") opt.selected = true;
    frag.appendChild(opt);
  });
  els.troopTier.appendChild(frag);
}

function readInputs(){
  return {
    troopType: els.troopType.value,
    tier: els.troopTier.value,
    marchSize: Number(els.marchSize.value) || 0,
    attackPct: Number(els.attackPct.value) || 0,
    defensePct: Number(els.defensePct.value) || 0,
    hpPct: Number(els.hpPct.value) || 0,
    bossAtkDebuff: Number(els.bossAtkDebuff.value) || 0,
    bossDefDebuff: Number(els.bossDefDebuff.value) || 0,
    bossHpDebuff: Number(els.bossHpDebuff.value) || 0,
  };
}

function runPrediction(inputs){
  return MONSTERS.map(monster => predictMonster(monster, inputs));
}

/** Default ordering: victories first, then defeats; within each group,
 *  easiest (lowest wounded) first. */
function defaultSort(results){
  return [...results].sort((a, b) => {
    if (a.victory !== b.victory) return a.victory ? -1 : 1;
    return a.woundedFraction - b.woundedFraction;
  });
}

function sortResults(results, key, dir){
  const val = (r) => {
    switch (key){
      case "name": return r.boss.name.toLowerCase();
      case "victory": return r.victory ? 1 : 0;
      case "wounded": return r.wounded;
      case "woundPct": return r.woundPct;
      case "recommendedMarch": return r.recommendedMarch === null ? Infinity : r.recommendedMarch;
      case "confidence": return r.confidence.text;
      default: return 0;
    }
  };
  return [...results].sort((a, b) => {
    const av = val(a), bv = val(b);
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
}

function fmt(n){
  if (n === null || n === undefined || !isFinite(n)) return "—";
  return Math.round(n).toLocaleString();
}

/* ---------------------------- FILTERING (UI only) --------------------------
   Pure presentation-layer filtering over the already-computed predictions.
   Never touches predictMonster/simulateMonster output or their values —
   it only decides which already-computed rows are displayed. */
function applyFilters(results){
  const q = filterState.search.trim().toLowerCase();
  return results.filter(r => {
    if (r.victory && !filterState.showVictory) return false;
    if (!r.victory && !filterState.showDefeat) return false;
    if (filterState.confidence !== "all" && r.confidence.text !== filterState.confidence) return false;
    if (q && !(r.boss.displayName || r.boss.name).toLowerCase().includes(q)) return false;
    return true;
  });
}

/* ------------------------------- DASHBOARD --------------------------------- */

function renderDashboard(results){
  const total = results.length;
  const victories = results.filter(r => r.victory);
  const defeats = total - victories.length;
  const avgWounded = total ? results.reduce((sum, r) => sum + r.wounded, 0) / total : 0;

  let highest = null, lowest = null;
  if (total){
    highest = results.reduce((a, b) => (b.woundedFraction > a.woundedFraction ? b : a));
    lowest = results.reduce((a, b) => (b.woundedFraction < a.woundedFraction ? b : a));
  }

  els.dashTotal.textContent = fmt(total);
  els.dashVictories.textContent = fmt(victories.length);
  els.dashDefeats.textContent = fmt(defeats);
  els.dashAvgWounded.textContent = fmt(avgWounded);
  els.dashHighest.textContent = highest ? (highest.boss.displayName || highest.boss.name) : "—";
  els.dashLowest.textContent = lowest ? (lowest.boss.displayName || lowest.boss.name) : "—";

  els.dashboard.hidden = false;
}

/* -------------------------------- RESULTS ---------------------------------- */

function renderResults(){
  const filtered = applyFilters(lastResults);
  const ordered = sortState.key
    ? sortResults(filtered, sortState.key, sortState.dir)
    : defaultSort(filtered);

  const winCount = lastResults.filter(r => r.victory).length;
  els.resultsSummary.textContent =
    `${winCount} of ${lastResults.length} monsters in the dataset are winnable with this march.`;

  els.filterEmptyMsg.hidden = ordered.length !== 0;

  renderResultsTable(ordered);
  renderResultsCards(ordered);

  els.resultsPanel.hidden = false;

  // update header sort indicators
  els.resultsTable.querySelectorAll("thead th[data-key]").forEach(th => {
    th.classList.remove("sort-asc", "sort-desc");
    if (sortState.key === th.dataset.key){
      th.classList.add(sortState.dir === 1 ? "sort-asc" : "sort-desc");
    }
  });
}

function renderResultsTable(ordered){
  const frag = document.createDocumentFragment();
  ordered.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.boss.displayName || r.boss.name}</td>
      <td><span class="tag ${r.victory ? 'tag-victory' : 'tag-defeat'}">${r.victory ? 'Victory' : 'Defeat'}</span></td>
      <td>${fmt(r.wounded)}</td>
      <td>${r.woundPct.toFixed(2)}%</td>
      <td>${r.recommendedMarch === null ? '—' : fmt(r.recommendedMarch)}</td>
      <td><span class="tag ${r.confidence.cls}">${r.confidence.text}</span></td>
      <td><button class="row-link" data-boss="${r.boss.order}">Details</button></td>
    `;
    frag.appendChild(tr);
  });
  els.resultsBody.innerHTML = "";
  els.resultsBody.appendChild(frag);
  els.resultsBody.querySelectorAll(".row-link").forEach(btn => {
    btn.addEventListener("click", () => showDetail(Number(btn.dataset.boss)));
  });
}

function renderResultsCards(ordered){
  const frag = document.createDocumentFragment();
  ordered.forEach(r => {
    const card = document.createElement("article");
    card.className = "result-card";
    card.innerHTML = `
      <div class="result-card-head">
        <span class="result-card-name">${r.boss.displayName || r.boss.name}</span>
        <span class="tag ${r.victory ? 'tag-victory' : 'tag-defeat'}">${r.victory ? 'Victory' : 'Defeat'}</span>
      </div>
      <dl class="result-card-grid">
        <div><dt>Recommended March</dt><dd>${r.recommendedMarch === null ? '—' : fmt(r.recommendedMarch)}</dd></div>
        <div><dt>Estimated Wounded</dt><dd>${fmt(r.wounded)} (${r.woundPct.toFixed(2)}%)</dd></div>
        <div><dt>Confidence</dt><dd><span class="tag ${r.confidence.cls}">${r.confidence.text}</span></dd></div>
      </dl>
      <button class="btn btn-secondary btn-compact" data-boss="${r.boss.order}">Details</button>
    `;
    frag.appendChild(card);
  });
  els.resultsCards.innerHTML = "";
  els.resultsCards.appendChild(frag);
  els.resultsCards.querySelectorAll("[data-boss]").forEach(btn => {
    btn.addEventListener("click", () => showDetail(Number(btn.dataset.boss)));
  });
}

/* -------------------------------- DETAIL ----------------------------------- */

function showDetail(order){
  const r = lastResults.find(x => x.boss.order === order);
  if (!r) return;
  currentDetail = r;
  const m = r.boss;
  const s = r.sim;
  els.detailTitle.textContent = `${m.displayName || m.name} — Detail`;
  els.detailBody.innerHTML = `
    <div class="detail-result-banner ${r.victory ? 'is-victory' : 'is-defeat'}">
      ${r.victory ? '✅ Predicted Victory' : '❌ Predicted Defeat'} — ${fmt(r.wounded)} wounded (${r.woundPct.toFixed(2)}%)
    </div>
    <div class="detail-groups">
      <div class="detail-group">
        <h4>Monster</h4>
        <dl class="detail-rows">
          <div class="detail-row"><dt>Type</dt><dd>${m.monsterType}${m.category && m.category !== m.monsterType ? ` (${m.category})` : ''}</dd></div>
          <div class="detail-row"><dt>Base Attack / Defense / HP</dt><dd>${fmt(m.attack)} / ${fmt(m.defense)} / ${fmt(m.hp)}</dd></div>
          <div class="detail-row"><dt>Troop Count</dt><dd>${fmt(m.troopCount)}</dd></div>
          <div class="detail-row"><dt>Final Attack / Defense / HP</dt><dd>${fmt(s.monsterAttack)} / ${fmt(s.monsterDefense)} / ${fmt(s.monsterHp)}</dd></div>
        </dl>
      </div>
      <div class="detail-group">
        <h4>Your March (Per Troop)</h4>
        <dl class="detail-rows">
          <div class="detail-row"><dt>Final Attack / Defense / HP</dt><dd>${fmt(s.playerAttack)} / ${fmt(s.playerDefense)} / ${fmt(s.playerHp)}</dd></div>
          <div class="detail-row"><dt>Troop Modifier</dt><dd>${s.troopModifier.toFixed(4)}</dd></div>
          <div class="detail-row"><dt>Effective Damage (per troop)</dt><dd>${fmt(s.effectiveDamage)}</dd></div>
        </dl>
      </div>
      <div class="detail-group">
        <h4>Prediction</h4>
        <dl class="detail-rows">
          <div class="detail-row"><dt>Predicted Result</dt><dd>${r.victory ? 'Victory' : 'Defeat'}</dd></div>
          <div class="detail-row"><dt>Estimated Wounded</dt><dd>${fmt(r.wounded)} (${r.woundPct.toFixed(2)}%)</dd></div>
          <div class="detail-row"><dt>Recommended Minimum March</dt><dd>${r.recommendedMarch === null ? 'Not achievable' : fmt(r.recommendedMarch)}</dd></div>
          <div class="detail-row"><dt>Confidence</dt><dd>${r.confidence.text}</dd></div>
        </dl>
      </div>
    </div>
  `;
  els.detailPanel.hidden = false;
  els.detailPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* --------------------------- BATTLE LOG (local) --------------------------- */

const LOG_KEY = "evony_boss_predictor_log_v3";

function loadLog(){
  try { return JSON.parse(localStorage.getItem(LOG_KEY)) || []; }
  catch(e){ return []; }
}
function saveLog(log){
  localStorage.setItem(LOG_KEY, JSON.stringify(log));
}

function renderLog(){
  const log = loadLog();
  const frag = document.createDocumentFragment();
  log.forEach((entry, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td data-label="Boss">${entry.boss}</td>
      <td data-label="Troop">${entry.troopType} ${entry.tier}</td>
      <td data-label="March">${fmt(entry.marchSize)}</td>
      <td data-label="Predicted">${entry.predicted}</td>
      <td data-label="Actual">${entry.actual}</td>
      <td data-label="Wounded">${fmt(entry.wounded)}</td>
      <td data-label="Actions"><button class="row-link" data-idx="${idx}">Delete</button></td>
    `;
    frag.appendChild(tr);
  });
  els.logBody.innerHTML = "";
  els.logBody.appendChild(frag);
  els.logBody.querySelectorAll(".row-link").forEach(btn => {
    btn.addEventListener("click", () => {
      const log = loadLog();
      log.splice(Number(btn.dataset.idx), 1);
      saveLog(log);
      renderLog();
    });
  });
}

function buildIssueUrl(r, inputs){
  const title = encodeURIComponent(`Correction: ${r.boss.name} stats`);
  const body = encodeURIComponent(
`Monster: ${r.boss.name} (order ${r.boss.order})
Troop: ${inputs.troopType} ${inputs.tier}, march ${inputs.marchSize}
Your buffs: ATK ${inputs.attackPct}% / DEF ${inputs.defensePct}% / HP ${inputs.hpPct}%
Boss debuffs applied: ATK ${inputs.bossAtkDebuff}% / DEF ${inputs.bossDefDebuff}% / HP ${inputs.bossHpDebuff}% (HP debuff is not applied by the engine)
Predicted: ${r.victory ? 'Victory' : 'Defeat'}, wounded ${r.wounded} (${r.woundPct.toFixed(2)}%)
Actual result: <fill in>
Actual wounded: <fill in>
`);
  return `https://github.com/warden-cmyk/evony-boss-predictor/issues/new?title=${title}&body=${body}`;
}

/* -------------------------------- EVENTS ---------------------------------- */

populateTierSelect();
renderLog();

els.statForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const inputs = readInputs();
  window._lastInputs = inputs;
  sortState = { key: null, dir: 1 };
  filterState = { search: "", showVictory: true, showDefeat: true, confidence: "all" };
  els.bossSearch.value = "";
  els.filterVictory.checked = true;
  els.filterDefeat.checked = true;
  els.filterConfidence.value = "all";
  lastResults = runPrediction(inputs);
  renderDashboard(lastResults);
  renderResults();
  els.dashboard.scrollIntoView({ behavior: "smooth", block: "start" });
});

els.resultsTable.querySelectorAll("thead th[data-key]").forEach(th => {
  th.addEventListener("click", () => {
    const key = th.dataset.key;
    if (sortState.key === key){
      sortState.dir *= -1;
    } else {
      sortState = { key, dir: 1 };
    }
    renderResults();
  });
  th.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " "){
      e.preventDefault();
      th.click();
    }
  });
});

/* ------------------------------ FILTER EVENTS ------------------------------ */

let searchDebounce = null;
els.bossSearch.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    filterState.search = els.bossSearch.value;
    renderResults();
  }, 120);
});

els.filterVictory.addEventListener("change", () => {
  filterState.showVictory = els.filterVictory.checked;
  renderResults();
});

els.filterDefeat.addEventListener("change", () => {
  filterState.showDefeat = els.filterDefeat.checked;
  renderResults();
});

els.filterConfidence.addEventListener("change", () => {
  filterState.confidence = els.filterConfidence.value;
  renderResults();
});

els.clearFiltersBtn.addEventListener("click", () => {
  filterState = { search: "", showVictory: true, showDefeat: true, confidence: "all" };
  els.bossSearch.value = "";
  els.filterVictory.checked = true;
  els.filterDefeat.checked = true;
  els.filterConfidence.value = "all";
  renderResults();
});

els.logForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!currentDetail) return;
  const inputs = window._lastInputs || readInputs();
  const log = loadLog();
  log.push({
    boss: currentDetail.boss.displayName || currentDetail.boss.name,
    troopType: inputs.troopType,
    tier: inputs.tier,
    marchSize: inputs.marchSize,
    predicted: currentDetail.victory ? "Victory" : "Defeat",
    actual: els.logResult.value,
    wounded: Number(els.logWounded.value) || 0,
    ts: Date.now(),
  });
  saveLog(log);
  renderLog();
  els.logWounded.value = 0;
});

els.issueBtn.addEventListener("click", () => {
  if (!currentDetail) return;
  const inputs = window._lastInputs || readInputs();
  window.open(buildIssueUrl(currentDetail, inputs), "_blank");
});

els.exportLogBtn.addEventListener("click", () => {
  const log = loadLog();
  const blob = new Blob([JSON.stringify(log, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "evony-boss-battle-log.json";
  a.click();
  URL.revokeObjectURL(url);
});

els.clearLogBtn.addEventListener("click", () => {
  if (confirm("Clear all locally stored battle reports? This cannot be undone.")){
    saveLog([]);
    renderLog();
  }
});
