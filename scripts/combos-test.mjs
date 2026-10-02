// Two-card combo detection and the bracket estimate.
//
// Fixtures are real Commander Spellbook variants (API 7.1.3). The live
// cards=2 export currently has one variant per pair, so the grouping case
// adds a second copy of the Thassa's Oracle line under another id.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { build } = await import(
  pathToFileURL(join(root, "node_modules/esbuild/lib/main.js")).href
);
const out = await mkdtemp(join(tmpdir(), "lugin-combos-"));
const entry = join(out, "entry.ts");
await writeFile(
  entry,
  `export { comboPairKey } from '${root}/src/lib/combos/pairKey.ts';
   export { findTwoCardCombos } from '${root}/src/lib/combos/detect.ts';
   export { parseComboBundle } from '${root}/src/lib/combos/parse.ts';
   export { compileTwoCardIndex } from '${root}/src/lib/combos/compile.ts';
   export { estimateDeck } from '${root}/src/lib/decks/bracket/estimator.ts';
   export { SPELLBOOK_TAG_RULES } from '${root}/src/lib/decks/bracket/rules.ts';`,
);
const bundlePath = join(out, "combos.mjs");
await build({
  bundle: true,
  entryPoints: [entry],
  format: "esm",
  outfile: bundlePath,
  platform: "neutral",
  tsconfigRaw: { compilerOptions: { paths: { "@/*": [`${root}/src/*`] } } },
});
const {
  comboPairKey,
  compileTwoCardIndex,
  estimateDeck,
  findTwoCardCombos,
  parseComboBundle,
  SPELLBOOK_TAG_RULES,
} = await import(pathToFileURL(bundlePath).href);

const THORACLE = "1de1b591-a73f-4974-b507-8c63e07a0868";
const CONSULT = "9a1412db-45ad-46ea-8f12-a85d203113d8";
const GRAVE = "09ff28b1-b6c9-48e6-b12e-2f0e644f709f";
const ALTAR = "8d02b297-97c4-4379-9862-0a462400f66f";
const ACT = "7a2484a9-04fd-41a0-8224-610c1c07ed10";
const REPERCUSSION = "f6069a4f-744e-43e8-9f8b-7c13b8b0187f";
const BOND = "73089a39-a2f6-4aa2-a058-e6551475153d";
const BLOOD = "8f933fae-6c0c-42d7-a817-14760d8285cd";
const MONOLITH = "6b8cf2a0-b045-4d91-9d91-c602d40c6237";
const KINNAN = "8d11aa49-d4cd-48b1-aa0f-8548fa733416";
const ANZRAG = "4adcd967-9ff7-4940-b8b9-0c4215bbcb75";
const ANARA = "a59ff932-f758-476e-ba31-0623bd748231";

const card = (oracleId, name, extra = {}) => ({
  commander: false,
  name,
  oracleId,
  qty: 1,
  zones: ["H"],
  ...extra,
});

const stored = (id, left, right, extra) => ({
  cards: [left, right].sort((a, b) => (a.oracleId < b.oracleId ? -1 : 1)),
  desc: extra.desc ?? "",
  easy: "",
  id,
  legal: true,
  mana: extra.mana ?? "",
  mv: extra.mv ?? 0,
  notable: extra.notable ?? "",
  req: extra.req ?? [],
  results: extra.results,
  status: "OK",
  tag: extra.tag,
});

const thoracle = stored(
  "742-1295",
  card(THORACLE, "Thassa's Oracle"),
  card(CONSULT, "Demonic Consultation"),
  {
    desc: "Cast Demonic Consultation by paying {B}, naming Thassa's Oracle.\nCast Thassa's Oracle by paying {U}{U}.",
    mana: "{U}{U}{B}",
    mv: 3,
    results: ["Exile your library", "Win the game"],
    tag: "R",
  },
);
const thoracleAgain = {
  ...thoracle,
  id: "742-1295-line2",
  desc: "The same two cards, a second published line.",
};
const gravecrawler = stored(
  "2577-4050",
  card(GRAVE, "Gravecrawler", { zones: ["B"] }),
  card(ALTAR, "Phyrexian Altar", { zones: ["B"] }),
  {
    notable: "You control an additional Zombie.",
    results: ["Infinite death triggers"],
    tag: "E",
  },
);
const blasphemous = stored(
  "2484-4083",
  card(ACT, "Blasphemous Act"),
  card(REPERCUSSION, "Repercussion", { zones: ["B"] }),
  {
    results: ["Near-infinite damage to all players"],
    tag: "C",
  },
);
const sanguine = stored(
  "690-3966",
  card(BOND, "Sanguine Bond", { zones: ["B"] }),
  card(BLOOD, "Exquisite Blood", { zones: ["B"] }),
  {
    notable: "You have a way to gain life.",
    results: [
      "Infinite lifegain triggers",
      "Infinite lifeloss",
      "Infinite lifegain",
    ],
    tag: "S",
  },
);
const kinnan = stored(
  "129-4131",
  card(MONOLITH, "Basalt Monolith", { zones: ["B"] }),
  card(KINNAN, "Kinnan, Bonder Prodigy", { zones: ["B"] }),
  { results: ["Infinite colorless mana"], tag: "R" },
);
const anzrag = stored(
  "5881-5975",
  card(ANZRAG, "Anzrag, the Quake-Mole", { commander: true, zones: ["B"] }),
  card(ANARA, "Anara, Wolvid Familiar"),
  { results: ["Near-infinite combat phases"], tag: "O" },
);

const indexOf = combos => {
  const pairs = {};
  const names = {};
  for (const combo of combos) {
    const key = comboPairKey(combo.cards[0].oracleId, combo.cards[1].oracleId);
    pairs[key] = [...(pairs[key] ?? []), combo.id];
    for (const piece of combo.cards)
      names[piece.name.toLowerCase()] = piece.oracleId;
  }
  return {
    combos: Object.fromEntries(combos.map(combo => [combo.id, combo])),
    metadata: {
      comboCount: combos.length,
      generatedAt: "2026-10-01T00:00:00.000Z",
      pairCount: Object.keys(pairs).length,
      productionBundle: false,
      provider: "Commander Spellbook",
      redistribution: "not-cleared",
      schema: 1,
      sha256: { combos: "0", pairs: "0", runtime: "0" },
      sourceUrl: "https://backend.commanderspellbook.com/variants/?q=cards%3D2",
      sourceVersion: "7.1.3",
    },
    names,
    pairs,
  };
};

const bundle = indexOf([
  thoracle,
  thoracleAgain,
  gravecrawler,
  blasphemous,
  sanguine,
  kinnan,
  anzrag,
]);
const row = (name, oracleId, section = "main") => ({
  name,
  oracleId,
  quantity: 1,
  section,
});

assert.equal(comboPairKey(THORACLE, CONSULT), comboPairKey(CONSULT, THORACLE));
assert.equal(comboPairKey(THORACLE, CONSULT), `${THORACLE}|${CONSULT}`);

const both = findTwoCardCombos(
  [row("Thassa's Oracle", THORACLE), row("Demonic Consultation", CONSULT)],
  bundle,
);
assert.equal(both.pairs.length, 1);
assert.equal(both.pairs[0].lines.length, 2);
assert.equal(both.pairs[0].lead.derived.winsGame, true);
assert.equal(both.pairs[0].lead.dependency, "SELF_CONTAINED");
assert.equal(both.pairs[0].usesCommander, false);

const missing = findTwoCardCombos([row("Thassa's Oracle", THORACLE)], bundle);
assert.equal(missing.pairs.length, 0);

const removed = findTwoCardCombos(
  [row("Demonic Consultation", CONSULT)],
  bundle,
);
assert.equal(removed.pairs.length, 0);

const commanderHalf = findTwoCardCombos(
  [
    row("Kinnan, Bonder Prodigy", KINNAN, "commander"),
    row("Basalt Monolith", MONOLITH),
  ],
  bundle,
);
assert.equal(commanderHalf.pairs.length, 1);
assert.equal(commanderHalf.pairs[0].usesCommander, true);

const printing = findTwoCardCombos(
  [row("タッサの神託者", THORACLE), row("悪魔の相談", CONSULT)],
  bundle,
);
assert.equal(printing.pairs.length, 1);
assert.equal(printing.pairs[0].pairKey, both.pairs[0].pairKey);

const byName = findTwoCardCombos(
  [
    { name: "Thassa's Oracle", quantity: 1, section: "main" },
    { name: "Demonic Consultation", quantity: 1, section: "main" },
  ],
  bundle,
);
assert.equal(byName.pairs.length, 1);

const sideboard = findTwoCardCombos(
  [
    row("Thassa's Oracle", THORACLE),
    row("Demonic Consultation", CONSULT, "sideboard"),
  ],
  bundle,
);
assert.equal(sideboard.pairs.length, 0);

const several = findTwoCardCombos(
  [
    row("Thassa's Oracle", THORACLE),
    row("Demonic Consultation", CONSULT),
    row("Sanguine Bond", BOND),
    row("Exquisite Blood", BLOOD),
    row("Gravecrawler", GRAVE),
    row("Phyrexian Altar", ALTAR),
  ],
  bundle,
);
assert.equal(several.pairs.length, 3);

const none = findTwoCardCombos(
  [row("Sol Ring", "00000000-0000-4000-8000-000000000001")],
  bundle,
);
assert.equal(none.pairs.length, 0);

const conditional = findTwoCardCombos(
  [row("Gravecrawler", GRAVE), row("Phyrexian Altar", ALTAR)],
  bundle,
);
assert.equal(conditional.pairs[0].lead.dependency, "CONDITIONAL");
assert.equal(conditional.pairs[0].lead.tag, "E");

const commanderFlag = findTwoCardCombos(
  [row("Anzrag, the Quake-Mole", ANZRAG), row("Anara, Wolvid Familiar", ANARA)],
  bundle,
);
assert.equal(commanderFlag.pairs[0].lead.dependency, "COMMANDER_DEPENDENT");
assert.equal(commanderFlag.pairs[0].lead.requiresCommander, true);

const unresolved = findTwoCardCombos(
  [
    row("Thassa's Oracle", THORACLE),
    row("Demonic Consultation", CONSULT),
    { name: "Not a Card", quantity: 1, section: "main", unresolved: true },
  ],
  bundle,
);
assert.equal(unresolved.unresolved, 1);
assert.equal(unresolved.pairs.length, 1);

const weak = estimateDeck(
  [row("Gravecrawler", GRAVE), row("Phyrexian Altar", ALTAR)],
  bundle,
);
assert.equal(weak.estimatedBracket, 2);
assert.equal(
  weak.evidence.filter(item => item.kind === "TWO_CARD_COMBO").length,
  1,
);
assert.equal(weak.evidence[0].suggestedFloor, undefined);

const core = estimateDeck(
  [row("Blasphemous Act", ACT), row("Repercussion", REPERCUSSION)],
  bundle,
);
assert.equal(core.estimatedBracket, 2);

const spicy = estimateDeck(
  [row("Sanguine Bond", BOND), row("Exquisite Blood", BLOOD)],
  bundle,
);
assert.equal(spicy.estimatedBracket, 3);
assert.deepEqual(spicy.likelyRange, [3, 4]);
assert.equal(SPELLBOOK_TAG_RULES.S.raisesTo, 3);
assert.equal(SPELLBOOK_TAG_RULES.R.raisesTo, 4);
assert.equal(SPELLBOOK_TAG_RULES.E.raisesTo, undefined);
assert.equal(SPELLBOOK_TAG_RULES.C.raisesTo, undefined);

const ruthless = estimateDeck(
  [
    row("Thassa's Oracle", THORACLE, "commander"),
    row("Demonic Consultation", CONSULT),
  ],
  bundle,
);
assert.equal(ruthless.estimatedBracket, 4);
assert.equal(
  ruthless.evidence.filter(item => item.kind === "TWO_CARD_COMBO").length,
  1,
);
assert.match(ruthless.evidence[0].detail, /Commander is one half/);
assert.equal(ruthless.combos.pairs[0].lines.length, 2);

const empty = estimateDeck(
  [row("Sol Ring", "00000000-0000-4000-8000-000000000001")],
  bundle,
);
assert.equal(
  empty.evidence.filter(item => item.kind === "TWO_CARD_COMBO").length,
  0,
);
assert.equal(empty.estimatedBracket, 2);

const again = estimateDeck(
  [row("Sanguine Bond", BOND), row("Exquisite Blood", BLOOD)],
  bundle,
);
assert.equal(JSON.stringify(spicy.evidence), JSON.stringify(again.evidence));

const low = estimateDeck(
  [{ name: "Mystery", quantity: 1, section: "main", unresolved: true }],
  bundle,
);
assert.equal(low.confidence, "low");

const offline = estimateDeck(
  [row("Thassa's Oracle", THORACLE), row("Demonic Consultation", CONSULT)],
  null,
);
assert.equal(offline.indexReady, false);
assert.equal(
  offline.evidence.filter(item => item.kind === "TWO_CARD_COMBO").length,
  0,
);
assert.equal(offline.estimatedBracket, offline.constructionFloor);

assert.throws(
  () => parseComboBundle({ metadata: { schema: 1 } }),
  /Combo index rejected/,
);

const compiled = compileTwoCardIndex(
  [
    {
      bracketTag: 'R',
      description: 'Cast both.',
      id: '742-1295',
      legalities: { commander: true },
      produces: [{ feature: { name: 'Win the game' } }],
      status: 'OK',
      uses: [
        { card: { name: "Thassa's Oracle", oracleId: THORACLE }, quantity: 1, zoneLocations: ['H'] },
        { card: { name: 'Demonic Consultation', oracleId: CONSULT }, quantity: 1, zoneLocations: ['H'] },
      ],
    },
    {
      bracketTag: 'R',
      id: 'not-legal',
      legalities: { commander: false },
      status: 'OK',
      uses: [
        { card: { name: 'A', oracleId: MONOLITH }, quantity: 1, zoneLocations: ['B'] },
        { card: { name: 'B', oracleId: KINNAN }, quantity: 1, zoneLocations: ['B'] },
      ],
    },
  ],
  '7.1.3',
);
const fromSource = findTwoCardCombos(
  [row("Thassa's Oracle", THORACLE), row('Demonic Consultation', CONSULT)],
  compiled,
);
assert.equal(fromSource.pairs.length, 1);
assert.equal(compiled.metadata.comboCount, 1);
assert.equal(compiled.metadata.productionBundle, false);

const deck = [];
for (let i = 0; i < 98; i += 1) {
  const hex = i.toString(16).padStart(12, "0");
  deck.push(row(`Card ${i}`, `00000000-0000-4000-8000-${hex}`));
}
deck.push(
  row("Thassa's Oracle", THORACLE, "commander"),
  row("Demonic Consultation", CONSULT),
);

const times = [];
for (let i = 0; i < 200; i += 1) {
  const start = performance.now();
  const found = findTwoCardCombos(deck, bundle);
  times.push(performance.now() - start);
  if (i === 0) assert.equal(found.pairs.length, 1);
}
times.sort((a, b) => a - b);
const p50 = times[Math.floor(times.length * 0.5)];
const p95 = times[Math.floor(times.length * 0.95)];
console.log(`fixture deck p50 ${p50.toFixed(2)}ms · p95 ${p95.toFixed(2)}ms`);
assert.ok(p95 < 30, `combo detection p95 ${p95}ms`);

try {
  const runtime = JSON.parse(
    await readFile(
      join(root, "generated", "commander-combos", "runtime.json"),
      "utf8",
    ),
  );
  const live = parseComboBundle(runtime);
  const liveTimes = [];
  for (let i = 0; i < 50; i += 1) {
    const start = performance.now();
    const found = findTwoCardCombos(deck, live);
    liveTimes.push(performance.now() - start);
    if (i === 0) assert.equal(found.pairs.length, 1);
  }
  liveTimes.sort((a, b) => a - b);
  const liveP50 = liveTimes[Math.floor(liveTimes.length * 0.5)];
  const liveP95 = liveTimes[Math.floor(liveTimes.length * 0.95)];
  console.log(
    `spellbook index p50 ${liveP50.toFixed(2)}ms · p95 ${liveP95.toFixed(2)}ms`,
  );
  assert.ok(liveP95 < 30, `live index p95 ${liveP95}ms`);
} catch (error) {
  if (error && error.code === "ENOENT") {
    console.log("No generated index. Skipping the live-index timing.");
  } else {
    throw error;
  }
}

await rm(out, { recursive: true, force: true });
console.log("combos ok");
