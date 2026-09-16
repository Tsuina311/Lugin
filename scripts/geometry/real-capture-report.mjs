#!/usr/bin/env node
/**
 * yarn geometry:real-capture-report
 *
 * Summarize latest Geometry Test upload from .scan-inbox/
 * (button → first quad → lock → hi-res capture timings + artifact integrity).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(fileURLToPath(new URL('.', import.meta.url)), '../..');
const inboxRoot = join(rootDir, '.scan-inbox/sessions');

const CARD_W = 744;
const CARD_H = 1039;

const percentile = (vals, p) => {
  if (!vals.length) return null;
  const sorted = [...vals].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? null;
};

const fmt = v => (v == null || !Number.isFinite(v) ? 'n/a' : `${Math.round(v)}ms`);

const REASON_LABEL = {
  no_geometry: 'WAITING_FOR_GEOMETRY',
  out_of_frame: 'MOVE_CARD_INTO_FRAME',
  near_edge: 'TOO_CLOSE_TO_EDGE',
  too_small: 'CARD_TOO_SMALL',
  too_large: 'CARD_TOO_LARGE',
  extreme_angle: 'ANGLE_TOO_EXTREME',
  non_convex: 'ANGLE_TOO_EXTREME',
  weak_support: 'WEAK_SUPPORT',
};

const labelReason = r => REASON_LABEL[r] ?? String(r).toUpperCase();

const reasonMsMap = it => {
  if (it?.captureUnsafeReasonMs && typeof it.captureUnsafeReasonMs === 'object') {
    return it.captureUnsafeReasonMs;
  }
  // Fallback for older uploads: reconstruct from truncated frames.
  const frames = Array.isArray(it?.frames) ? it.frames : [];
  const acc = {};
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (f?.captureSafe) continue;
    const next = frames[i + 1];
    const dt = next
      ? Math.max(0, next.timestamp - f.timestamp)
      : it?.timing?.firstCaptureSafeAt != null
        ? Math.max(0, it.timing.firstCaptureSafeAt - f.timestamp)
        : 50;
    for (const r of f.captureUnsafeReasons ?? []) {
      acc[r] = (acc[r] ?? 0) + dt;
    }
  }
  return acc;
};

const fmtReasonMs = acc => {
  const labeled = {};
  for (const [k, v] of Object.entries(acc ?? {})) {
    const label = labelReason(k);
    labeled[label] = (labeled[label] ?? 0) + v;
  }
  const keys = Object.keys(labeled).sort((a, b) => labeled[b] - labeled[a]);
  if (!keys.length) return 'none';
  return keys.map(k => `${k}: ${Math.round(labeled[k])}ms`).join(' · ');
};

const stageHint = d => {
  const det = d.buttonToFirstQuadMs ?? d.buttonToFirstPlausibleMs ?? d.buttonToFirstRawMs;
  const hunt = d.firstQuadToFirstCaptureSafeMs;
  const conf = d.captureSafeToLockMs;
  if (det == null) return 'UNKNOWN';
  if (hunt == null) return 'DETECTION?';
  if (hunt >= Math.max(det, conf ?? 0) * 2 || hunt > 500) return 'CAPTURE-SAFETY';
  if ((conf ?? 0) > 400) return 'CONFIRMATION';
  if (det > 400) return 'DETECTION';
  return 'OK';
};

const pngIhdr = bytes => {
  if (!bytes || bytes.length < 24) return null;
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};

const findPng = (sessionDir, name) => {
  const direct = join(sessionDir, name);
  if (existsSync(direct)) return direct;
  const stem = name.replace(/\.png$/, '');
  const nested = join(sessionDir, stem, name);
  if (existsSync(nested)) return nested;
  return null;
};

const classifyCard = (encoded, logical) => {
  if (!encoded) return 'ARTIFACT_MISSING';
  if (encoded.width === CARD_W && encoded.height === CARD_H) return 'ARTIFACT_OK';
  if (encoded.width <= 120 || encoded.height <= 168) return 'ARTIFACT_DOWNSCALED';
  if (
    logical &&
    (encoded.width !== logical.width || encoded.height !== logical.height)
  ) {
    return 'ARTIFACT_DIMENSION_MISMATCH';
  }
  return 'ARTIFACT_DIMENSION_MISMATCH';
};

const classifySource = (encoded, logical) => {
  if (!encoded) return 'ARTIFACT_MISSING';
  if (!logical) return 'ARTIFACT_OK';
  if (encoded.width === logical.width && encoded.height === logical.height) {
    return 'ARTIFACT_OK';
  }
  if (encoded.width <= 120) return 'ARTIFACT_DOWNSCALED';
  return 'ARTIFACT_DIMENSION_MISMATCH';
};

const findBundles = () => {
  if (!existsSync(inboxRoot)) return [];
  const out = [];
  for (const session of readdirSync(inboxRoot, { withFileTypes: true })) {
    if (!session.isDirectory()) continue;
    const sessionDir = join(inboxRoot, session.name);
    for (const trace of readdirSync(sessionDir, { withFileTypes: true })) {
      if (!trace.isDirectory()) continue;
      const summaryPath = join(sessionDir, trace.name, 'summary.json');
      if (!existsSync(summaryPath)) continue;
      try {
        const bundle = JSON.parse(readFileSync(summaryPath, 'utf8'));
        if (bundle?.kind !== 'geometry-test') continue;
        out.push({ bundle, dir: join(sessionDir, trace.name), sessionDir });
      } catch {
        /* skip */
      }
    }
  }
  return out.sort((a, b) => String(b.bundle.fixtureId).localeCompare(String(a.bundle.fixtureId)));
};

const main = () => {
  const idArg = process.argv.find(a => a.startsWith('--id='))?.slice(5);
  const bundles = findBundles();
  const hit = idArg
    ? bundles.find(b => b.bundle.fixtureId === idArg)
    : bundles[0];
  if (!hit) {
    console.log('No geometry-test summary found under .scan-inbox/sessions/');
    process.exit(1);
  }
  const { bundle, dir, sessionDir } = hit;
  const items = Array.isArray(bundle.items) ? bundle.items : [];
  const pick = key =>
    items
      .map(i => {
        const d = i?.derivedMs ?? {};
        if (typeof d[key] === 'number' && Number.isFinite(d[key])) return d[key];
        // Backfill stage timings for older uploads that lack explicit fields.
        const t = i?.timing;
        if (!t) return null;
        const firstQuadAt = t.firstPlausibleQuadAt ?? t.firstRawQuadAt;
        if (key === 'buttonToFirstQuadMs') {
          if (t.buttonPressedAt == null || firstQuadAt == null) return null;
          return Math.max(0, firstQuadAt - t.buttonPressedAt);
        }
        if (key === 'firstQuadToFirstCaptureSafeMs') {
          if (firstQuadAt == null || t.firstCaptureSafeAt == null) return null;
          return Math.max(0, t.firstCaptureSafeAt - firstQuadAt);
        }
        return null;
      })
      .filter(v => typeof v === 'number' && Number.isFinite(v));
  const lockMs = items
    .map(i => {
      const t = i?.timing;
      if (t?.buttonPressedAt == null || t?.captureQuadLockedAt == null) return null;
      return t.captureQuadLockedAt - t.buttonPressedAt;
    })
    .filter(v => typeof v === 'number');

  console.log(`Geometry Test ${bundle.fixtureId}`);
  console.log(`path ${dir}`);
  console.log(`engine ${bundle.geometryEngine ?? 'current'} · items ${items.length}`);
  console.log(
    `focusMode ${bundle.focusMode ?? '—'} · initialFocus ${
      bundle.initialFocusRequested ? 'yes' : 'no'
    } · reportedSuccess ${bundle.initialFocusReportedSuccess ?? '—'}`,
  );
  console.log(`upload ${bundle.uploadStatus ?? '—'}`);
  console.log('');
  console.log(
    `first quad      p50 ${fmt(percentile(pick('buttonToFirstQuadMs'), 50) ?? percentile(pick('buttonToFirstPlausibleMs'), 50))}  p95 ${fmt(percentile(pick('buttonToFirstQuadMs'), 95) ?? percentile(pick('buttonToFirstPlausibleMs'), 95))}  ← DETECTION`,
  );
  console.log(
    `quad→safe       p50 ${fmt(percentile(pick('firstQuadToFirstCaptureSafeMs'), 50))}  p95 ${fmt(percentile(pick('firstQuadToFirstCaptureSafeMs'), 95))}  ← CAPTURE-SAFETY`,
  );
  console.log(
    `first safe      p50 ${fmt(percentile(pick('buttonToFirstCaptureSafeMs'), 50))}  p95 ${fmt(percentile(pick('buttonToFirstCaptureSafeMs'), 95))}`,
  );
  console.log(
    `safe→lock       p50 ${fmt(percentile(pick('captureSafeToLockMs'), 50))}  p95 ${fmt(percentile(pick('captureSafeToLockMs'), 95))}  ← CONFIRMATION`,
  );
  console.log(
    `lock            p50 ${fmt(percentile(lockMs, 50))}  p95 ${fmt(percentile(lockMs, 95))}`,
  );
  console.log(
    `capture done    p50 ${fmt(percentile(pick('buttonToCaptureDoneMs'), 50))}  p95 ${fmt(percentile(pick('buttonToCaptureDoneMs'), 95))}`,
  );
  console.log(
    `warp done       p50 ${fmt(percentile(pick('buttonToWarpDoneMs'), 50))}  p95 ${fmt(percentile(pick('buttonToWarpDoneMs'), 95))}  ← recognition-ready`,
  );
  console.log(
    `visible         p50 ${fmt(percentile(pick('buttonToDisplayMs'), 50))}  p95 ${fmt(percentile(pick('buttonToDisplayMs'), 95))}`,
  );
  console.log(
    `preview encode  p50 ${fmt(percentile(pick('previewEncodeMs'), 50))}  p95 ${fmt(percentile(pick('previewEncodeMs'), 95))}`,
  );
  console.log(
    `warp→visible    p50 ${fmt(percentile(pick('warpToDisplayedMs'), 50))}  p95 ${fmt(percentile(pick('warpToDisplayedMs'), 95))}`,
  );
  console.log(
    `card encode     p50 ${fmt(percentile(pick('artifactCardEncodeMs'), 50))}  p95 ${fmt(percentile(pick('artifactCardEncodeMs'), 95))}  (background)`,
  );
  console.log(
    `card write      p50 ${fmt(percentile(pick('artifactCardWriteMs'), 50))}  p95 ${fmt(percentile(pick('artifactCardWriteMs'), 95))}  (background)`,
  );
  console.log(
    `full artifacts  p50 ${fmt(percentile(pick('artifactEncodeMs'), 50))}  p95 ${fmt(percentile(pick('artifactEncodeMs'), 95))}  (background)`,
  );
  const manual = items.filter(i => i.manualCapture).length;
  console.log(`manual capture ${manual}/${items.length}`);
  console.log('');

  let okCount = 0;
  let badCount = 0;
  for (const it of items) {
    const d = it.derivedMs ?? {};
    const lock =
      it.timing?.buttonPressedAt != null && it.timing?.captureQuadLockedAt != null
        ? it.timing.captureQuadLockedAt - it.timing.buttonPressedAt
        : null;
    const firstQuad =
      d.buttonToFirstQuadMs ??
      d.buttonToFirstPlausibleMs ??
      d.buttonToFirstRawMs ??
      (it.timing?.buttonPressedAt != null &&
      (it.timing.firstPlausibleQuadAt ?? it.timing.firstRawQuadAt) != null
        ? (it.timing.firstPlausibleQuadAt ?? it.timing.firstRawQuadAt) - it.timing.buttonPressedAt
        : null);
    const quadToSafe =
      d.firstQuadToFirstCaptureSafeMs ??
      (firstQuad != null && d.buttonToFirstCaptureSafeMs != null
        ? Math.max(0, d.buttonToFirstCaptureSafeMs - firstQuad)
        : null);
    const stem = `geom-${String(it.itemIndex).padStart(3, '0')}`;
    const sourceName = it.files?.source ?? `${stem}-source.png`;
    const cardName = it.files?.cardWarp ?? `${stem}-card.png`;
    const sourcePath = findPng(sessionDir, sourceName);
    const cardPath = findPng(sessionDir, cardName);
    const sourceFile = sourcePath ? pngIhdr(readFileSync(sourcePath)) : null;
    const cardFile = cardPath ? pngIhdr(readFileSync(cardPath)) : null;
    const sourceLogical =
      it.sourceWidth != null && it.sourceHeight != null
        ? { width: it.sourceWidth, height: it.sourceHeight }
        : null;
    const cardLogical =
      it.warpWidth != null && it.warpHeight != null
        ? { width: it.warpWidth, height: it.warpHeight }
        : { width: CARD_W, height: CARD_H };
    const sourceStatus = classifySource(sourceFile, sourceLogical);
    const cardStatus = classifyCard(cardFile, cardLogical);
    if (cardStatus === 'ARTIFACT_OK' && sourceStatus === 'ARTIFACT_OK') okCount += 1;
    else badCount += 1;

    const unsafe = reasonMsMap(it);
    const dominant =
      it.dominantUnsafeReason ??
      Object.entries(unsafe).sort((a, b) => b[1] - a[1])[0]?.[0] ??
      null;
    const stage = stageHint({
      ...d,
      buttonToFirstQuadMs: firstQuad,
      firstQuadToFirstCaptureSafeMs: quadToSafe,
    });

    console.log(
      `#${it.itemIndex}` +
        ` quad=${fmt(firstQuad)}` +
        ` q→s=${fmt(quadToSafe)}` +
        ` safe=${fmt(d.buttonToFirstCaptureSafeMs)}` +
        ` s→L=${fmt(d.captureSafeToLockMs)}` +
        ` lock=${fmt(lock)}` +
        ` · ${stage}` +
        `${it.manualCapture ? ' MANUAL' : ''}`,
    );
    console.log(`  unsafe ${fmtReasonMs(unsafe)}`);
    if (dominant) {
      console.log(`  dominant ${labelReason(dominant)}`);
    }
    if (
      it.minCornerMarginNormalized != null ||
      it.minCornerMarginPixelsAnalysis != null ||
      it.minCornerMarginPixelsSource != null
    ) {
      console.log(
        `  lock margin norm=${
          it.minCornerMarginNormalized != null
            ? `${(it.minCornerMarginNormalized * 100).toFixed(2)}%`
            : '—'
        }` +
          ` analysisPx=${
            it.minCornerMarginPixelsAnalysis != null
              ? Math.round(it.minCornerMarginPixelsAnalysis)
              : '—'
          }` +
          ` sourcePx=${
            it.minCornerMarginPixelsSource != null
              ? Math.round(it.minCornerMarginPixelsSource)
              : '—'
          }`,
      );
    }
    const pr = it.physicalRefine;
    if (pr) {
      const meanInset =
        pr.meanInset != null
          ? pr.meanInset * 100
          : pr.edgeInsetNormalized
            ? (['top', 'right', 'bottom', 'left']
                .map(k => pr.edgeInsetNormalized[k] ?? 0)
                .reduce((a, b) => a + b, 0) /
                4) *
              100
            : null;
      const cornerHits = pr.cornerEvidence
        ? Object.values(pr.cornerEvidence).filter(
            v => v === 'rounded_physical' || v === 'nested_rounded_inner',
          ).length
        : 0;
      console.log(
        `  refine ${pr.status}${pr.classification ? `/${pr.classification}` : ''}` +
          ` selected=${pr.selectedForCapture}` +
          ` ms=${pr.refinementMs != null ? Math.round(pr.refinementMs) : '—'}` +
          ` corners≈${cornerHits}/4` +
          ` meanInset=${meanInset != null ? `${meanInset.toFixed(1)}%` : '—'}` +
          (pr.rejectionReason && pr.rejectionReason !== 'NONE'
            ? ` reject=${pr.rejectionReason}`
            : ''),
      );
    }
    console.log(
      `  source buffer ${sourceLogical ? `${sourceLogical.width}x${sourceLogical.height}` : '?'} · file ${
        sourceFile ? `${sourceFile.width}x${sourceFile.height}` : 'MISSING'
      } · ${sourceStatus}`,
    );
    console.log(
      `  card   buffer ${cardLogical.width}x${cardLogical.height} · file ${
        cardFile ? `${cardFile.width}x${cardFile.height}` : 'MISSING'
      } · ${cardStatus}`,
    );
    if (it.sharpness != null) {
      console.log(
        `  sharp ${Number(it.sharpness).toFixed(1)}` +
          (it.focusReportedSuccess === true ? ' · focusOK' : ' · focus?'),
      );
    }
  }

  console.log('');
  console.log(
    badCount === 0
      ? `ARTIFACTS VALID · ${okCount}/${items.length} items ARTIFACT_OK (card must be ${CARD_W}×${CARD_H})`
      : `ARTIFACTS INVALID · ${okCount} ok / ${badCount} bad — not valid for image-quality analysis`,
  );
  if (badCount > 0) process.exitCode = 2;
};

main();
