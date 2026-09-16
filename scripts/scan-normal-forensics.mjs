#!/usr/bin/env node
/**
 * yarn scan:normal-forensics <session-prefix>
 *
 * Host-only contact sheet per card:
 *   SOURCE+QUAD | RECOGNITION CARD | TITLE CROP
 * No OCR / re-recognition — visual review only.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const inboxRoot = join(rootDir, '.scan-inbox/sessions');
const outRoot = join(rootDir, '.scan-inbox/forensics');

const prefix = process.argv[2];
if (!prefix) {
  console.error('Usage: yarn scan:normal-forensics <session-prefix>');
  process.exit(1);
}

const sessions = existsSync(inboxRoot)
  ? readdirSync(inboxRoot)
      .filter(n => n.startsWith(prefix))
      .sort()
  : [];

if (!sessions.length) {
  console.error(`No sessions matching ${prefix}* under ${inboxRoot}`);
  process.exit(1);
}

const findFile = (dir, name) => {
  const direct = join(dir, name);
  if (existsSync(direct)) return direct;
  const walk = d => {
    if (!existsSync(d)) return null;
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) {
        const hit = walk(p);
        if (hit) return hit;
      } else if (n === name) return p;
    }
    return null;
  };
  return walk(dir);
};

const loadMeta = dir => {
  for (const rel of ['metadata/metadata.json', 'metadata.json']) {
    const p = join(dir, rel);
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, 'utf8'));
      } catch {
        return {};
      }
    }
  }
  return {};
};

const readPng = path => {
  if (!path) return null;
  try {
    return PNG.sync.read(readFileSync(path));
  } catch {
    return null;
  }
};

const scaleToHeight = (src, targetH) => {
  if (!src) {
    const blank = new PNG({ width: Math.round(targetH * 0.72), height: targetH });
    blank.data.fill(40);
    for (let i = 3; i < blank.data.length; i += 4) blank.data[i] = 255;
    return blank;
  }
  const scale = targetH / src.height;
  const w = Math.max(1, Math.round(src.width * scale));
  const h = targetH;
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    const sy = Math.min(src.height - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(src.width - 1, Math.floor(x / scale));
      const si = (sy * src.width + sx) << 2;
      const di = (y * w + x) << 2;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = 255;
    }
  }
  return out;
};

const H = 420;
const GAP = 12;
mkdirSync(outRoot, { recursive: true });
const parent = sessions[0].split('--')[0];
const sheetDir = join(outRoot, parent);
mkdirSync(sheetDir, { recursive: true });

let wrote = 0;

for (const id of sessions) {
  const dir = join(inboxRoot, id);
  const meta = loadMeta(dir);
  const child = meta.childId ?? id.split('--')[1] ?? id;
  const overlayPath =
    findFile(dir, 'source-with-recognition-quad.png') ?? findFile(dir, 'source-highres.png');
  const cardPath = findFile(dir, 'recognition-card.png');
  const titlePath = findFile(dir, 'title-crop.png');
  if (!overlayPath && !cardPath) continue;

  const panels = [
    scaleToHeight(readPng(overlayPath), H),
    scaleToHeight(readPng(cardPath), H),
    scaleToHeight(readPng(titlePath), H),
  ];
  const totalW = panels.reduce((a, p) => a + p.width, 0) + GAP * (panels.length - 1);
  const sheet = new PNG({ width: totalW, height: H });
  sheet.data.fill(18);
  for (let i = 3; i < sheet.data.length; i += 4) sheet.data[i] = 255;

  let x0 = 0;
  for (const panel of panels) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < panel.width; x++) {
        const si = (y * panel.width + x) << 2;
        const di = (y * totalW + (x0 + x)) << 2;
        sheet.data[di] = panel.data[si];
        sheet.data[di + 1] = panel.data[si + 1];
        sheet.data[di + 2] = panel.data[si + 2];
        sheet.data[di + 3] = 255;
      }
    }
    x0 += panel.width + GAP;
  }

  const outPath = join(sheetDir, `${child}-forensics.png`);
  writeFileSync(outPath, PNG.sync.write(sheet));
  const note = {
    childId: child,
    status: meta.terminalStatus ?? null,
    card: meta.finalCard ?? meta.proposedCard ?? null,
    geometryFailureClass: meta.provenance?.geometryFailureClass ?? null,
    warpSuspect: meta.provenance?.warpSuspectStatus ?? null,
    selection: meta.provenance?.quadSelectionSource ?? null,
    sheet: outPath,
  };
  writeFileSync(join(sheetDir, `${child}-forensics.json`), JSON.stringify(note, null, 2));
  console.log(`${child}: ${outPath}`);
  wrote += 1;
}

console.log(`\nwrote ${wrote} contact sheet(s) → ${sheetDir}`);
