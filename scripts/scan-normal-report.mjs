#!/usr/bin/env node
/**
 * yarn scan:normal-report [session-prefix]
 *
 * Summarize Normal / Verified Single Scan diagnostic uploads in .scan-inbox.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const inboxRoot = join(rootDir, '.scan-inbox/sessions');

const prefix = process.argv[2] ?? 'normal-scan-session-';

const sessions = existsSync(inboxRoot)
  ? readdirSync(inboxRoot)
      .filter(n => n.startsWith(prefix))
      .sort()
  : [];

if (!sessions.length) {
  console.log(`No sessions matching ${prefix}* under ${inboxRoot}`);
  process.exit(0);
}

const byParent = new Map();
for (const id of sessions) {
  const dir = join(inboxRoot, id);
  const metaPath = join(dir, 'metadata', 'metadata.json');
  const metaAlt = join(dir, 'metadata.json');
  const path = existsSync(metaPath) ? metaPath : existsSync(metaAlt) ? metaAlt : null;
  let meta = {};
  if (path) {
    try {
      meta = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      meta = { parseError: true };
    }
  }
  let quadArtifact = null;
  const quadPath = join(dir, 'recognition-quad.json');
  const quadPathAlt = join(dir, 'metadata', 'recognition-quad.json');
  for (const qp of [quadPath, quadPathAlt, join(dir, 'files', 'recognition-quad.json')]) {
    if (existsSync(qp)) {
      try {
        quadArtifact = JSON.parse(readFileSync(qp, 'utf8'));
      } catch {
        quadArtifact = { parseError: true };
      }
      break;
    }
  }
  const files = [];
  const walk = d => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.png') || name.endsWith('.json')) files.push(name);
    }
  };
  walk(dir);
  const parent = meta.parentSessionId ?? id.split('--')[0];
  if (!byParent.has(parent)) byParent.set(parent, []);
  byParent.get(parent).push({ id, meta, files, dir, quadArtifact });
}

const latestParent = [...byParent.keys()].sort().at(-1);
const cards = byParent.get(latestParent) ?? [];

console.log(`\n=== Single Scan report: ${latestParent} ===`);
console.log(`cards: ${cards.length}\n`);

const row = (label, value) => console.log(`  ${label.padEnd(22)} ${value}`);
const ms = (a, b) => (a != null && b != null ? Math.round(b - a) : null);

const fmtQuad = q => {
  if (!q) return '—';
  const pts = [q.topLeft, q.topRight, q.bottomRight, q.bottomLeft];
  if (!pts.every(p => p && Number.isFinite(p.x))) return JSON.stringify(q);
  return pts.map(p => `(${Math.round(p.x)},${Math.round(p.y)})`).join(' ');
};

const rightMargin = (q, w) => {
  if (!q || !(w > 0)) return null;
  return Math.min(w - q.topRight.x, w - q.bottomRight.x);
};

let parentSummary = null;

for (const c of cards.sort((a, b) => String(a.meta.childId).localeCompare(String(b.meta.childId)))) {
  const m = c.meta;
  if (m.parentSummary) parentSummary = m.parentSummary;
  const t = m.timing ?? {};
  const ocr = m.ocr ?? {};
  const printing = m.printing ?? {};
  const prov = m.provenance ?? c.quadArtifact ?? {};
  const derived = m.derivedMs ?? {};
  const paintBarrier = t.previewPaintBarrierPassedAt ?? t.previewPaintConfirmedAt ?? t.previewDisplayedAt;
  const paintToRec =
    derived.paintToRecognitionMs ?? ms(paintBarrier, t.recognitionStartAt);
  const hasSource = c.files.includes('source-highres.png');
  const hasCard = c.files.includes('recognition-card.png');
  const hasTitle = c.files.includes('title-crop.png');
  const hasEnhanced = c.files.includes('title-enhanced.png');
  const hasQuad = c.files.includes('recognition-quad.json');
  const hasOverlay = c.files.includes('source-with-recognition-quad.png');
  const hasMeta = c.files.includes('metadata.json');
  const ownershipOk =
    m.ownershipOk === true ||
    (m.attemptId > 0 && m.captureId != null && m.cardSessionId != null);
  const requireTitle =
    m.terminalStatus === 'FOUND' ||
    m.terminalStatus === 'AMBIGUOUS' ||
    m.terminalStatus === 'NO_MATCH' ||
    m.terminalStatus === 'OCR_ERROR' ||
    ocr.ocrRawText != null;
  const missing = [];
  if (!hasMeta) missing.push('metadata.json');
  if (!hasSource) missing.push('source-highres.png');
  if (!hasCard) missing.push('recognition-card.png');
  if (!hasQuad) missing.push('recognition-quad.json');
  if (!hasOverlay) missing.push('source-with-recognition-quad.png');
  if (requireTitle && !hasTitle) missing.push('title-crop.png');
  const complete = missing.length === 0 && ownershipOk;

  console.log(`--- ${m.childId ?? c.id} ---`);
  row('CARD', m.finalCard ?? m.proposedCard ?? '—');
  row('IDs', `session=${m.cardSessionId} capture=${m.captureId} attempt=${m.attemptId}`);
  row('STATUS', m.terminalStatus ?? (m.finalCard ? 'FOUND?' : 'PENDING/NULL'));
  row('OWNERSHIP', ownershipOk ? 'OK' : 'INVALID');
  row(
    'TIMING',
    [
      `cap→warp=${ms(t.captureDoneAt, t.warpDoneAt) ?? '—'}`,
      `encode=${ms(t.previewEncodeStartAt, t.previewEncodeDoneAt) ?? '—'}`,
      `barrier→recog=${paintToRec ?? '—'}`,
      `ocr=${ms(t.titleOcrStartedAt, t.titleOcrDoneAt) ?? '—'}`,
      `total=${ms(t.captureDoneAt, t.terminalAt) ?? '—'}`,
    ].join(' '),
  );
  row(
    'ARTIFACTS',
    `source=${hasSource ? 'Y' : 'N'} overlay=${hasOverlay ? 'Y' : 'N'} card=${hasCard ? 'Y' : 'N'} title=${hasTitle ? 'Y' : 'N'} enh=${hasEnhanced ? 'Y' : 'N'} quad=${hasQuad ? 'Y' : 'N'}`,
  );
  row('UPLOAD', complete ? 'COMPLETE' : `INCOMPLETE${missing.length ? ` missing=[${missing.join(',')}]` : ''}`);
  row('earlyAdvance', m.userAdvancedBeforeTerminal ? 'YES' : 'no');
  row('sharpness', m.sharpness ?? '—');
  if (m.channelTiming) {
    const ct = m.channelTiming;
    row(
      'CHANNEL',
      [
        ct.mode,
        ct.titleMs != null ? `title=${Math.round(ct.titleMs)}ms` : null,
        ct.artworkMs != null ? `art=${Math.round(ct.artworkMs)}ms` : null,
        ct.footerMs != null ? `footer=${Math.round(ct.footerMs)}ms` : null,
        ct.totalMs != null ? `total=${Math.round(ct.totalMs)}ms` : null,
        ct.earlyReason ? `via=${ct.earlyReason}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    );
  }
  row('OCR raw', JSON.stringify(ocr.ocrRawText ?? null));
  row('OCR norm', JSON.stringify(ocr.ocrNormalizedText ?? null));
  row('best', `${ocr.bestCandidateName ?? '—'} @ ${ocr.bestCandidateScore ?? '—'}`);
  row('runner-up', `${ocr.runnerUpName ?? '—'} @ ${ocr.runnerUpScore ?? '—'}`);
  row('margin', ocr.candidateMargin ?? '—');
  row(
    'PRINTING',
    printing.printingStatus === 'RESOLVED'
      ? `RESOLVED ${printing.proposedSet ?? '?'} #${printing.proposedCollectorNumber ?? '?'}`
      : printing.printingStatus ?? 'NOT_RESOLVED',
  );

  const bad =
    m.terminalStatus === 'NO_MATCH' ||
    m.terminalStatus === 'QUALITY_REJECT' ||
    m.terminalStatus === 'RECOGNITION_ERROR' ||
    prov.warpSuspectStatus === 'WARP_SUSPECT' ||
    prov.warpInputStatus === 'WARP_INPUT_INVALID' ||
    (prov.geometryFailureClass && prov.geometryFailureClass !== 'OK');

  if (bad || !complete) {
    console.log('  GEOMETRY FORENSICS');
    const analysisQ = prov.analysisQuad;
    const sourceQ = prov.projectedSourceQuad;
    const srcW = prov.sourceDimensions?.width ?? null;
    const srcH = prov.sourceDimensions?.height ?? null;
    row('  analysisQuad', fmtQuad(analysisQ));
    row('  projectedSource', fmtQuad(sourceQ));
    row(
      '  margins',
      `analysisMinNorm=${prov.analysisMinMarginNorm ?? '—'} sourceMinPx=${prov.sourceMinMarginPx ?? '—'} sourceRightPx=${rightMargin(sourceQ, srcW) ?? '—'}`,
    );
    row(
      '  ages',
      `quadAge@cap=${prov.quadAgeAtCaptureMs ?? '—'}ms capLatency=${prov.captureLatencyMs ?? '—'}ms sourceVsQuad=${prov.sourceVsQuadAgeMs ?? '—'}ms`,
    );
    row(
      '  warpClass',
      `${prov.geometryFailureClass ?? 'UNKNOWN'} input=${prov.warpInputStatus ?? '—'} suspect=${prov.warpSuspectStatus ?? '—'} sel=${prov.quadSelectionSource ?? '—'}`,
    );
    if (prov.warpSuspectReasons?.length) {
      row('  suspectWhy', prov.warpSuspectReasons.join(','));
    }
    row(
      '  dims',
      `analysis=${prov.analysisDimensions ? `${prov.analysisDimensions.width}x${prov.analysisDimensions.height}` : '—'} source=${srcW && srcH ? `${srcW}x${srcH}` : '—'}`,
    );
    row('  paths', c.dir);
    row(
      '  files',
      [
        hasSource ? 'source-highres' : null,
        hasOverlay ? 'source-with-recognition-quad' : null,
        hasCard ? 'recognition-card' : null,
        hasTitle ? 'title-crop' : null,
        hasQuad ? 'recognition-quad.json' : null,
      ]
        .filter(Boolean)
        .join(' · ') || '—',
    );
    console.log(
      '  CARD-002 discriminant: overlay surrounds card? → if YES + bad recognition-card = WARP; if NO = selection/projection/pose',
    );
  }
  console.log('');
}

console.log('--- parent summary ---');
if (parentSummary) {
  row('attemptsCreated', parentSummary.attemptsCreated);
  row('attemptsTerminal', parentSummary.attemptsTerminal);
  if (
    parentSummary.attemptsTerminal > parentSummary.attemptsCreated
  ) {
    row('INVARIANT', 'FAIL attemptsTerminal > attemptsCreated');
  } else {
    row('INVARIANT', 'OK attemptsTerminal <= attemptsCreated');
  }
  row('found', parentSummary.found);
  row('ambiguous', parentSummary.ambiguous);
  row('noMatch', parentSummary.noMatch);
  row('qualityReject', parentSummary.qualityReject);
  row('skipped', parentSummary.skipped);
  row('ocrError', parentSummary.ocrError);
  row('recognitionError', parentSummary.recognitionError);
  row('retakes', parentSummary.retakes);
  row('earlyAdvances', parentSummary.userAdvancesBeforeTerminal);
  row('cardsAdded', parentSummary.cardsAdded);
  row('printingCorrections', parentSummary.printingCorrections);
} else {
  const named = cards.filter(c => c.meta.finalCard || c.meta.proposedCard).length;
  const invalid = cards.filter(
    c => !(c.meta.attemptId > 0 && c.meta.captureId != null && c.meta.cardSessionId != null),
  ).length;
  const missingSource = cards.filter(c => !c.files.includes('source-highres.png')).length;
  row('(from cards)', 'no parentSummary in metadata — card aggregates:');
  row('named', `${named}/${cards.length}`);
  row('invalid ownership', String(invalid));
  row('missing source', String(missingSource));
}
console.log('');
