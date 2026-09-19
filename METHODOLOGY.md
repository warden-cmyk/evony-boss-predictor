# Methodology

The Evony Boss Predictor is a deterministic, single-exchange calculator. It is
a JavaScript port of the Monster Simulator in the community-maintained
Game-EvonyTKR project, using its monster database and
lookup tables. Evony does not publish its internal combat formula, so treat
results as a documented, reproducible approximation.

## Inputs

- Troop type (ground, archer, mounted, siege), tier (T1–T17) and march size.
- Combined Attack %, Defense % and HP % buffs.
- Boss Attack Debuff % and Boss Defense Debuff % (each clamped to 0–100).
  A Boss HP Debuff % field exists but has no effect: the reference engine
  never debuffs monster HP.

## Calculation (per monster)

1. **Player per-troop stats** = base stat for the tier and troop type
   × (1 + buff %).
2. **Monster stats**: Attack and Defense come from the database and are
   multiplied by (1 − debuff %). HP is unchanged.
3. **Troop modifier**, evaluated in this order:
   1. World boss: per-boss modifier table.
   2. Alliance boss: tier-based modifier table.
   3. Common monster: 1.0 for T10 and below; above T10, mounted 1.1,
      siege 0.5, otherwise 1.0.
   4. Boss: tier-vs-boss modifier table.
   5. Anything else (summon, collection, resource, pyramid): the monster's own
      per-troop-type modifiers, defaulting to 1.0.
4. **Effective damage per troop** = Player Attack × Troop Modifier
   × Player Attack ÷ (Player Attack + Monster Defense).
5. **Minimum march** = floor(Monster HP × Monster Troop Count ÷ Effective
   Damage) + 1.
6. **Expected wounded** = floor(Monster Attack × Monster Troop Count ÷
   Player HP).

## Derived presentation

- **Victory** when the march size is at least the minimum march; otherwise
  **Defeat** (recorded as a full loss).
- **Wounded** = expected wounded capped at the march size on a Victory.
- **Confidence**: Very High (≤ 0.1 % wounded), High (≤ 15 %), Medium (≤ 35 %),
  Low (above 35 %), None (Defeat).

## Limitations

- Single exchange only: no turn-by-turn variance, boss enrage phases or
  skill/item procs.
- Buffs are one combined percentage per stat (equivalent to a solo march with
  everything in a single bucket); troop-side debuffs and rally march types are
  not modelled.

## Data

`data.js` embeds the full database as `BOSS_DATA` (1,131 monsters plus the
reference tables and constants). `bossData.json` holds the same data in JSON
form. Both are generated files.
