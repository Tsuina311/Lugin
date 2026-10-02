// Fail closed if the local combo index does not match the parser or its hashes.

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "generated", "commander-combos");
const sha = text => createHash("sha256").update(text).digest("hex");

const read = async name => readFile(join(dir, name), "utf8");

let runtimeText;
let combosText;
let pairsText;
let metadata;
try {
  runtimeText = await read("runtime.json");
  combosText = await read("two-card-combos.json");
  pairsText = await read("two-card-pair-index.json");
  metadata = JSON.parse(await read("metadata.json"));
} catch (error) {
  console.error("No combo index. Run yarn combos:update.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const out = await mkdtemp(join(tmpdir(), "lugin-combos-validate-"));
const entry = join(out, "entry.ts");
await writeFile(
  entry,
  `export { parseComboBundle } from '${root}/src/lib/combos/parse.ts';\n`,
);
const { build } = await import(
  pathToFileURL(join(root, "node_modules/esbuild/lib/main.js")).href
);
const bundle = join(out, "parse.mjs");
await build({
  bundle: true,
  entryPoints: [entry],
  format: "esm",
  outfile: bundle,
  platform: "neutral",
});
const { parseComboBundle } = await import(pathToFileURL(bundle).href);

let failed = false;
const fail = message => {
  console.error(message);
  failed = true;
};

try {
  const raw = JSON.parse(runtimeText);
  const parsed = parseComboBundle(raw);
  const content = sha(
    JSON.stringify({ combos: raw.combos, names: raw.names, pairs: raw.pairs }),
  );
  if (metadata.sha256?.combos !== sha(combosText))
    fail("combos hash does not match metadata");
  if (metadata.sha256?.pairs !== sha(pairsText))
    fail("pairs hash does not match metadata");
  if (metadata.sha256?.runtime !== content)
    fail("runtime content hash does not match metadata");
  if (
    metadata.productionBundle !== false ||
    metadata.redistribution !== "not-cleared"
  ) {
    fail("production redistribution flag is set");
  }
  let badKey = 0;
  for (const [key, ids] of Object.entries(parsed.pairs)) {
    const combo = parsed.combos[ids[0]];
    const expect = [combo.cards[0].oracleId, combo.cards[1].oracleId]
      .sort()
      .join("|");
    if (key !== expect) badKey += 1;
    if (!combo.legal || combo.status !== "OK")
      fail(`${combo.id} is not a legal OK variant`);
  }
  if (badKey) fail(`${badKey} pair keys are not sorted oracle ids`);
  if (!failed) {
    console.log(
      `OK · ${parsed.metadata.comboCount} combos · ${parsed.metadata.pairCount} pairs · ${parsed.metadata.sourceVersion}`,
    );
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  await rm(out, { recursive: true, force: true });
}

if (failed) process.exit(1);
