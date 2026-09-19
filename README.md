# Evony Boss Predictor (v4.0)

A static, deterministic PvE monster/boss outcome calculator for **Evony: The
King's Return**, part of the
[Evony Tools hub](https://warden-cmyk.github.io/evony-tools/).

**Live site:** https://warden-cmyk.github.io/evony-boss-predictor/

- No backend, no login, no accounts, no API calls.
- Pure HTML/CSS/JS: `index.html`, `style.css`, `data.js`, `app.js`.
- Every prediction is 100% reproducible: same inputs → same outputs, always.
  No randomness anywhere in the calculation path.
- One button. Press **Calculate** and every monster in the database is
  evaluated at once — you never pick a monster or run one at a time.

## Deploying

The site is fully static and needs no build step or dependencies.

1. In the repository, open **Settings → Pages**.
2. Set the source to **Deploy from a branch**, choose `main` and `/ (root)`.
3. The site is published at
   `https://warden-cmyk.github.io/evony-boss-predictor/`.

To run locally, serve the folder with any static server, e.g.
`python3 -m http.server`, and open `http://localhost:8000/`. (`data.js` must
load before `app.js`; `index.html` already does this.)

## Inputs

**Your March**
- Troop Type — Ground / Archer / Mounted / Siege
- Troop Tier — T1 through T17
- March Size — troop count

**Your Buffs** (total % bonus from research, gear, generals & skills combined)
- Attack %, Defense %, HP %

**Boss Debuffs** (the debuff *your march* inflicts *on the boss*, from debuff
generals/skills/gear — **not** the boss's effect on you)
- Boss Attack Debuff %, Boss Defense Debuff %, Boss HP Debuff % (kept in the
  UI for continuity, but see "Engine" below — the reference engine has
  no HP-debuff mechanism, so this field currently has no effect on results)

That's it — no monster selection. All applicable debuff inputs reduce the
boss's stats. Nothing in this tool reduces your own stats.

## Output

One sortable table, evaluated for every monster in the database, in one click:

| Boss | Result | Estimated Wounded | Wound % | Recommended March | Confidence |
|---|---|---|---|---|---|

Default order is **victories first, then defeats**, easiest first within each
group. Click any column header to re-sort. Click **Details** on any row for a
full stat breakdown, including troop modifier and effective damage.

## Engine

The battle math is ported from the community-maintained Game-EvonyTKR Monster
Simulator, documented in [`METHODOLOGY.md`](METHODOLOGY.md):

1. **Your per-troop stats** come from the base attack/defense/HP lookup table
   (`data.js` → `referenceTables.troopBase{Attack,Defense,Hp}`) for your
   chosen troop type and tier, multiplied by `(1 + your buff % / 100)`.
2. **The monster's stats** come from the monster database (`data.js` →
   `monsters`, 1,131 entries) — every entry has an explicit Attack, Defense,
   HP, and troop count. Boss Attack/Defense Debuff % reduce those fields
   directly; HP is never debuffed.
3. **A troop modifier** is looked up for the specific matchup, evaluated in
   this order: world boss → alliance boss → common monster tier rule →
   tier-vs-boss modifier table → the monster's own per-troop-type modifiers.
4. **Damage per troop** = Your Attack × Troop Modifier, attenuated by
   Your Attack ÷ (Your Attack + Monster Defense).
5. **Recommended Minimum March** = `floor(Monster HP × Monster Troop Count ÷
   Effective Damage) + 1` — a closed-form calculation, not a search.
   **Victory** is called when your march size meets or exceeds that number.
6. **Estimated Wounded** = `floor(Monster Attack × Monster Troop Count ÷
   Your Per-Troop HP)`, capped at your march size, on a Victory. A Defeat is
   recorded as a full loss.
7. **Confidence** is a plain read of the safety margin: Very High (~0%
   wounded) → High → Medium → Low → None (Defeat).

Full detail is in the in-page "Methodology" panel and in `METHODOLOGY.md`.

## Monster database

The **only** monster/boss database in this project is `BOSS_DATA` in
`data.js`, generated from the source data (`bossData.json`):

- `BOSS_DATA.monsters` — all 1,131 monster records (common, boss, world
  boss, alliance boss, summon, collection, resource, pyramid).
- `BOSS_DATA.referenceTables` — troop base-stat tables, tier-vs-boss
  modifiers, world-boss modifiers, alliance-boss modifiers.
- `BOSS_DATA.constants` — tier list, troop types, world/alliance boss order
  maps.

There is no other boss list, no generated/procedural boss data, and no
second battle engine anywhere in this project — `app.js` is the only file
that computes a prediction.

## Building the real dataset

Every result row has a **Details** button opening a per-monster panel with:

- **"Save Report Locally"** — stores your actual result (Victory/Defeat +
  wounded) in `localStorage` under `evony_boss_predictor_log_v3`. Nothing
  leaves the browser.
- **"Export Log (JSON)"** — downloads your full local battle log.
- **"Report a Correction on GitHub"** — opens a pre-filled issue on this repository with
  the monster, your inputs, and the prediction, so you just fill in what
  actually happened.

This is the crowd-sourced tuning loop, with zero backend required.

## Known v3 limitations

- This is a **single-exchange** calculator (as in the reference engine),
  not a multi-round simulation — it does not model turn-by-turn variance,
  special boss mechanics/enrage phases, or item/skill procs.
- The UI takes a single combined Attack/Defense/HP buff percentage rather
  than the reference engine's five buff categories (basic/march/
  monster/misc/rally) or its rally march type — all buffs are treated as
  the "solo" case with everything in one bucket.
- Troop-side debuffs (`troop_attack`/`troop_defense`/`troop_hp`) from the
  reference engine have no corresponding UI field and are always 0.
- Boss HP Debuff % is accepted by the UI but not applied — the reference
  engine never debuffs monster HP.

## Contributing

Corrections to monster data or the calculation are welcome — use the in-app
**Report a Correction on GitHub** button or open an issue at
https://github.com/warden-cmyk/evony-boss-predictor/issues.

## Disclaimer

This is an unofficial fan-made tool and is not affiliated with or endorsed by
the publisher of Evony. Results are estimates; see `METHODOLOGY.md`.
