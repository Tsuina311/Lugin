// Build the local two-card combo index from the current Commander Spellbook API.
//
// Production bundling is gated. The Spellbook backend repository is MIT, and
// that license was not verified as permission to redistribute the combo
// dataset. This command writes generated/commander-combos/ for local use.
// Do not commit those JSON files until redistribution is explicitly allowed.
//
// Source checked while writing this script: API 7.1.3
//   GET https://backend.commanderspellbook.com/variants/?q=cards=2
//   Card.oracleId, Variant.bracketTag, Variant.legalities.commander,
//   Variant.uses / requires / produces, Variant.status.

import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "generated", "commander-combos");
const API = "https://backend.commanderspellbook.com";
const SOURCE = `${API}/variants/?q=${encodeURIComponent("cards=2")}`;
const TAGS = new Set(["B", "C", "E", "O", "P", "R", "S"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 100;

const cardKey = name =>
  name
    .replace(/[’‘‛`´]/g, "'")
    .replace(/\s*\(v\.?\s*\d+\)\s*$/i, "")
    .split("//")[0]
    .trim()
    .toLowerCase();

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const fail = message => {
  throw new Error(message);
};

const fetchJson = async url => {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Lugin combos:update",
    },
  });
  if (!res.ok) fail(`Spellbook ${res.status} for ${url}`);
  return res.json();
};

const stable = value => JSON.stringify(value);

const sha256 = text => createHash("sha256").update(text).digest("hex");

const zoneList = value =>
  Array.isArray(value) ? value.filter(zone => typeof zone === "string") : [];

const compact = variant => {
  if (!variant || typeof variant.id !== "string") fail("variant has no id");
  if (!Array.isArray(variant.uses) || variant.uses.length !== 2) return null;
  const cards = variant.uses.map(use => {
    const card = use?.card;
    if (!card || typeof card.name !== "string" || !card.name.trim()) {
      fail(`${variant.id} has a card with no name`);
    }
    if (typeof card.oracleId !== "string" || !UUID.test(card.oracleId))
      return null;
    return {
      commander: use.mustBeCommander === true,
      name: card.name,
      oracleId: card.oracleId.toLowerCase(),
      qty:
        typeof use.quantity === "number" && use.quantity > 0 ? use.quantity : 1,
      zones: zoneList(use.zoneLocations),
    };
  });
  if (cards.some(card => card === null))
    return { skip: "missing-oracle-id", id: variant.id };
  if (cards[0].oracleId === cards[1].oracleId)
    return { skip: "same-card", id: variant.id };
  cards.sort((a, b) => (a.oracleId < b.oracleId ? -1 : 1));
  if (typeof variant.bracketTag !== "string" || !TAGS.has(variant.bracketTag)) {
    fail(`${variant.id} has bracket tag ${variant.bracketTag}`);
  }
  if (typeof variant.status !== "string") fail(`${variant.id} has no status`);
  if (variant.status !== "OK")
    return { skip: `status-${variant.status}`, id: variant.id };
  const legal = variant.legalities?.commander === true;
  const req = Array.isArray(variant.requires)
    ? variant.requires
        .map(item => ({
          commander: item?.mustBeCommander === true,
          name:
            typeof item?.template?.name === "string" ? item.template.name : "",
        }))
        .filter(item => item.name)
    : [];
  const results = Array.isArray(variant.produces)
    ? variant.produces
        .map(item =>
          typeof item?.feature?.name === "string" ? item.feature.name : "",
        )
        .filter(Boolean)
    : [];
  const desc =
    typeof variant.description === "string" ? variant.description.trim() : "";
  return {
    combo: {
      cards,
      desc: desc.length > 1200 ? `${desc.slice(0, 1199)}…` : desc,
      easy:
        typeof variant.easyPrerequisites === "string"
          ? variant.easyPrerequisites.trim()
          : "",
      id: variant.id,
      legal,
      mana: typeof variant.manaNeeded === "string" ? variant.manaNeeded : "",
      mv:
        typeof variant.manaValueNeeded === "number"
          ? variant.manaValueNeeded
          : 0,
      notable:
        typeof variant.notablePrerequisites === "string"
          ? variant.notablePrerequisites.trim()
          : "",
      req,
      results,
      status: variant.status,
      tag: variant.bracketTag,
    },
  };
};

const pages = async () => {
  const variants = [];
  let url = `${API}/variants/?limit=${PAGE}&q=${encodeURIComponent("cards=2")}`;
  let guard = 0;
  while (url) {
    guard += 1;
    if (guard > 80) fail("pagination did not end");
    const body = await fetchJson(url);
    if (!Array.isArray(body.results))
      fail("variants page has no results array");
    variants.push(...body.results);
    process.stdout.write(`\r${variants.length} variants`);
    url = typeof body.next === "string" ? body.next : "";
    if (url) await sleep(80);
  }
  process.stdout.write("\n");
  return variants;
};

const info = await fetchJson(`${API}/schema/?format=json`);
const sourceVersion =
  typeof info?.info?.version === "string"
    ? info.info.version
    : fail("OpenAPI version missing");

const raw = await pages();
const skipped = {};
const note = reason => {
  skipped[reason] = (skipped[reason] ?? 0) + 1;
};

const combos = {};
let commanderLegal = 0;
let notTwo = 0;
for (const variant of raw) {
  if (!Array.isArray(variant?.uses) || variant.uses.length !== 2) {
    notTwo += 1;
    note("not-two-uses");
    continue;
  }
  const built = compact(variant);
  if (!built) continue;
  if (built.skip) {
    note(built.skip);
    continue;
  }
  if (combos[built.combo.id]) {
    note("duplicate-id");
    continue;
  }
  combos[built.combo.id] = built.combo;
  if (built.combo.legal) commanderLegal += 1;
  else note("not-commander-legal");
}

const pairs = {};
const names = {};
const tagCounts = {};
let commanderDependent = 0;
for (const combo of Object.values(combos)) {
  if (!combo.legal) continue;
  const key = `${combo.cards[0].oracleId}|${combo.cards[1].oracleId}`;
  const list = pairs[key] ?? [];
  list.push(combo.id);
  pairs[key] = list;
  tagCounts[combo.tag] = (tagCounts[combo.tag] ?? 0) + 1;
  if (
    combo.cards.some(card => card.commander) ||
    combo.req.some(req => req.commander)
  ) {
    commanderDependent += 1;
  }
  for (const card of combo.cards) {
    const keyName = cardKey(card.name);
    if (names[keyName] && names[keyName] !== card.oracleId)
      note("name-oracle-clash");
    names[keyName] = card.oracleId;
  }
}
for (const ids of Object.values(pairs)) ids.sort();

const runtimeCombos = {};
for (const [id, combo] of Object.entries(combos)) {
  if (combo.legal) runtimeCombos[id] = combo;
}

const combosText = `${stable(runtimeCombos)}\n`;
const pairsText = `${stable(pairs)}\n`;
const contentHash = sha256(stable({ combos: runtimeCombos, names, pairs }));
const metadata = {
  comboCount: Object.keys(runtimeCombos).length,
  generatedAt: new Date().toISOString(),
  pairCount: Object.keys(pairs).length,
  productionBundle: false,
  provider: "Commander Spellbook",
  redistribution: "not-cleared",
  schema: 1,
  sha256: {
    combos: sha256(combosText),
    pairs: sha256(pairsText),
    runtime: contentHash,
  },
  sourceUrl: SOURCE,
  sourceVersion,
};
const runtimeFinal = `${stable({ combos: runtimeCombos, metadata, names, pairs })}\n`;

const report = {
  commanderDependent,
  commanderLegal: commanderLegal,
  duplicateVariants: Object.values(pairs).filter(ids => ids.length > 1).length,
  failureReasons: skipped,
  generatedAt: metadata.generatedAt,
  missingOracleIds: skipped["missing-oracle-id"] ?? 0,
  notTwoUses: notTwo,
  pairCount: metadata.pairCount,
  runtimeBytes: Buffer.byteLength(runtimeFinal),
  sha256: metadata.sha256,
  skipped: Object.values(skipped).reduce((sum, n) => sum + n, 0),
  sourceUrl: SOURCE,
  sourceVariants: raw.length,
  sourceVersion,
  tagCounts,
  twoCardVariants: Object.keys(combos).length,
  uniquePairs: metadata.pairCount,
};

await mkdir(outDir, { recursive: true });
const write = async (name, text) => {
  const path = join(outDir, name);
  const tmp = `${path}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, path);
};
await write("two-card-combos.json", combosText);
await write("two-card-pair-index.json", pairsText);
await write("metadata.json", `${stable(metadata)}\n`);
await write("runtime.json", runtimeFinal);
await write("commander-combos-build-report.json", `${stable(report)}\n`);

console.log(
  JSON.stringify(
    {
      commanderLegal,
      pairs: metadata.pairCount,
      runtimeBytes: report.runtimeBytes,
      sourceVersion,
      twoCard: Object.keys(combos).length,
      variants: raw.length,
    },
    null,
    2,
  ),
);
