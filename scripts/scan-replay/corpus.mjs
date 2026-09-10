// Local Samsung replay corpus under .scan-fixtures/replay/ (gitignored).
// Promote copies a PNG once. Do not invent ML Kit text — only recorded strings.

import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const rootDir = join(dirname(fileURLToPath(import.meta.url)), '../..');
export const REPLAY_ROOT = join(rootDir, '.scan-fixtures/replay');
export const INBOX_SESSIONS = join(rootDir, '.scan-inbox/sessions');
export const NAMES_PATH = join(rootDir, '.scan-fixtures/card-names.json');

export const STAGE = {
  DEVICE_REQUIRED: 'DEVICE_REQUIRED',
  HOST_REPLAYABLE: 'HOST_REPLAYABLE',
};

export const SELECTED = [
  {
    aliases: ['wand-of-wonder', 'wand'],
    expectedName: 'Wand of Wonder',
    expectedStatus: 'identified',
    inboxSession: 'phone-20260908',
    inboxTrace: 'wand-of-wonder-20260908T073958',
    recordedOcr: [{ source: 'title-fast', text: 'Wand of Wonder' }],
  },
  {
    aliases: ['maddening-hex', 'hex'],
    expectedName: 'Maddening Hex',
    expectedStatus: 'identified',
    inboxSession: 'phone-20260908',
    inboxTrace: 'maddening-hex-alt-art-20260908T082448',
    recordedOcr: [
      { source: 'title-fast', text: 'Maddenino Hey' },
      { source: 'title-raw', text: 'Maddening Hesy' },
    ],
  },
  {
    aliases: ['negate-sleeved', 'negate'],
    expectedName: 'Negate',
    expectedStatus: 'ambiguous',
    inboxSession: 'phone-20260908',
    inboxTrace: 'negate-20260908T082630',
    recordedOcr: [{ source: 'title-fast', text: 'gate' }],
  },
  {
    aliases: ['negate-unsleeved'],
    expectedName: 'Negate',
    expectedStatus: 'ambiguous',
    inboxSession: 'phone-20260908',
    inboxTrace: 'negate-unsleeved-20260908T082746',
    recordedOcr: [{ source: 'title-fast', text: 'ate' }],
  },
  {
    aliases: ['sword-hearth-home-fr', 'french-sword'],
    expectedName: 'Sword of Hearth and Home',
    expectedStatus: 'ambiguous',
    inboxSession: 'phone-20260908',
    inboxTrace: 'p-e-d-tre-et-de-foyer-french-goo-20260908T082303',
    recordedOcr: [{ source: 'title-fast', text: 'ère et de foyer' }],
  },
  {
    aliases: ['basilisk-collar', 'collar'],
    expectedName: 'Basilisk Collar',
    expectedStatus: 'identified',
    inboxSession: 'phone-20260908',
    inboxTrace: 'basilisk-collar-20260908T111744',
    recordedOcr: [{ source: 'title-fast', text: 'Basilisk Collar' }],
  },
  {
    aliases: ['livaan', 'livaan-foil'],
    expectedName: 'Livaan, Cultist of Tiamat',
    expectedStatus: 'identified',
    inboxSession: 'phone-20260908',
    inboxTrace: 'livaan-cultist-of-tiamat-foil-20260908T111916',
    recordedOcr: [{ source: 'title-fast', text: 'Livaan, cultiste de Tiama' }],
  },
  {
    aliases: ['lizard-blades', 'lames-lezard'],
    expectedName: 'Lizard Blades',
    expectedStatus: 'identified',
    inboxSession: 'phone-20260908',
    inboxTrace: 'lizard-blades-french-20260908T111833',
    recordedOcr: [{ source: 'title-fast', text: 'Lames lézard' }],
  },
  {
    aliases: ['slip-out-the-back', 'svignarsela'],
    expectedName: 'Slip Out the Back',
    expectedStatus: 'identified',
    inboxSession: 'phone-20260908',
    inboxTrace: 'slip-out-the-back-italian-20260908T111643',
    recordedOcr: [{ source: 'title-fast', text: 'Svignarsela dal Retro' }],
  },
  {
    aliases: ['teferis-veil', 'teferi-veil'],
    // teferi-veil-old-edition-20260908T111452 is a BAD CAPTURE (poor
    // recognition frame), not a failed acquisition. It lives in the
    // capture-quality corpus, not this recognition gate.
    expectedName: "Teferi's Veil",
    expectedStatus: 'identified',
    inboxSession: 'phone-20260908',
    inboxTrace: 'teferi-veil-old-edition-good-cap-20260908T111548',
    recordedOcr: [
      { source: 'title-fast', text: "Teteri's Veil" },
      { source: 'title-raw', text: 'Teferis Veil' },
    ],
  },
];

const replayJson = spec => ({
  aliases: spec.aliases,
  expectedName: spec.expectedName,
  expectedStatus: spec.expectedStatus,
  fixtureId: spec.inboxTrace,
  recordedOcr: spec.recordedOcr,
  sourceInbox: `${spec.inboxSession}/${spec.inboxTrace}`,
  stages: {
    cardNameIndex: STAGE.HOST_REPLAYABLE,
    mlkitOcr: STAGE.DEVICE_REQUIRED,
    preprocess: STAGE.HOST_REPLAYABLE,
    recordedOcrDecode: STAGE.HOST_REPLAYABLE,
    strongFuzzy: STAGE.HOST_REPLAYABLE,
    titleExtract: STAGE.HOST_REPLAYABLE,
    warp: STAGE.HOST_REPLAYABLE,
  },
});

export const replayDir = fixtureId => join(REPLAY_ROOT, fixtureId);

export const loadReplayMeta = async fixtureId => {
  const path = join(replayDir(fixtureId), 'replay.json');
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, 'utf8'));
};

export const listReplayFixtures = async () => {
  if (!existsSync(REPLAY_ROOT)) return [];
  const { readdir } = await import('node:fs/promises');
  const names = await readdir(REPLAY_ROOT, { withFileTypes: true });
  const out = [];
  for (const ent of names) {
    if (!ent.isDirectory()) continue;
    const meta = await loadReplayMeta(ent.name);
    if (meta) out.push(meta);
  }
  return out.sort((a, b) => a.fixtureId.localeCompare(b.fixtureId));
};

export const resolveFixtureId = async query => {
  const q = String(query ?? '').trim();
  if (!q) return null;
  const all = await listReplayFixtures();
  const hit = all.find(
    f => f.fixtureId === q || (f.aliases ?? []).includes(q) || f.fixtureId.startsWith(q),
  );
  return hit?.fixtureId ?? (existsSync(join(replayDir(q), 'replay.json')) ? q : null);
};

export const promoteSelected = async ({ force = false } = {}) => {
  const promoted = [];
  for (const spec of SELECTED) {
    const dest = replayDir(spec.inboxTrace);
    const src = join(INBOX_SESSIONS, spec.inboxSession, spec.inboxTrace);
    const pngSrc = join(src, 'source-highres.png');
    if (!existsSync(pngSrc)) {
      promoted.push({ fixtureId: spec.inboxTrace, ok: false, reason: `missing inbox PNG ${pngSrc}` });
      continue;
    }
    await mkdir(dest, { recursive: true });
    const pngDest = join(dest, 'source-highres.png');
    if (!existsSync(pngDest) || force) await copyFile(pngSrc, pngDest);
    const fixtureSrc = join(src, 'fixture.json');
    if (existsSync(fixtureSrc)) await copyFile(fixtureSrc, join(dest, 'fixture.json'));
    const quadSrc = join(src, 'recognition-quad.json');
    if (existsSync(quadSrc)) await copyFile(quadSrc, join(dest, 'recognition-quad.json'));
    const cropSrc = join(src, 'title-crop-current.png');
    if (existsSync(cropSrc) && !existsSync(join(dest, 'title-crop-current.png'))) {
      await copyFile(cropSrc, join(dest, 'title-crop-current.png'));
    }
    const warpSrc = join(src, 'current-warp.png');
    if (existsSync(warpSrc) && !existsSync(join(dest, 'current-warp.png'))) {
      await copyFile(warpSrc, join(dest, 'current-warp.png'));
    }
    await writeFile(join(dest, 'replay.json'), `${JSON.stringify(replayJson(spec), null, 2)}\n`);
    promoted.push({ fixtureId: spec.inboxTrace, ok: true, path: dest });
  }
  return promoted;
};
