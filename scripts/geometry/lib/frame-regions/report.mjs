/** Host report math for frame-region annotations. No image IO. */

import { effectiveFrameFamily } from './annotations.mjs';
import { FRAME_REGION_KEYS } from '../schema.mjs';
import { CARD_HEIGHT, CARD_WIDTH, sourceQuadToCanonical } from './project.mjs';

const TAG_BREAKS = ['sleeved', 'unsleeved', 'foil', 'nonfoil', 'glare', 'perspective', 'classic-frame'];

const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

const shoelace = pts => {
  if (pts.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    sum += p.x * q.y - q.x * p.y;
  }
  return Math.abs(sum) / 2;
};

const edgeIntersect = (p, q, a, b) => {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const det = dx * ey - dy * ex;
  if (Math.abs(det) < 1e-9) return null;
  const t = ((a.x - p.x) * ey - (a.y - p.y) * ex) / det;
  return { x: p.x + t * dx, y: p.y + t * dy };
};

const clipPolygon = (subject, clip) => {
  let output = subject.map(point => ({ ...point }));
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const input = output;
    output = [];
    if (!input.length) break;
    for (let j = 0; j < input.length; j++) {
      const p = input[j];
      const q = input[(j + 1) % input.length];
      const pin = cross(a, b, p) >= 0;
      const qin = cross(a, b, q) >= 0;
      if (pin && qin) output.push(q);
      else if (pin && !qin) {
        const hit = edgeIntersect(p, q, a, b);
        if (hit) output.push(hit);
      } else if (!pin && qin) {
        const hit = edgeIntersect(p, q, a, b);
        if (hit) output.push(hit);
        output.push(q);
      }
    }
  }
  return output;
};

const namedPoints = quad => [
  { x: quad.tl[0], y: quad.tl[1] },
  { x: quad.tr[0], y: quad.tr[1] },
  { x: quad.br[0], y: quad.br[1] },
  { x: quad.bl[0], y: quad.bl[1] },
];

export const quadArea = quad => shoelace(namedPoints(quad));

/** Share of `subject` that lies inside `clip`. 1 means the subject is covered by the clip. */
export const quadCoverage = (subject, clip) => {
  const area = quadArea(subject);
  if (area < 1e-6) return 0;
  return shoelace(clipPolygon(namedPoints(subject), namedPoints(clip))) / area;
};

/** Polygon IoU for tl/tr/br/bl quads. Same winding as detectCard.polygonIoU. */
export const quadIoU = (a, b) => {
  const pa = namedPoints(a);
  const pb = namedPoints(b);
  const areaA = shoelace(pa);
  const areaB = shoelace(pb);
  const inter = shoelace(clipPolygon(pa, pb));
  const union = areaA + areaB - inter;
  return union > 1e-6 ? inter / union : 0;
};

export const median = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
};

const KEYS = ['tl', 'tr', 'br', 'bl'];

export const measureQuads = (cardQuad, autoQuad, finalQuad, width = CARD_WIDTH, height = CARD_HEIGHT) => {
  const auto = sourceQuadToCanonical(autoQuad, cardQuad, width, height);
  const final = sourceQuadToCanonical(finalQuad, cardQuad, width, height);
  const corners = KEYS.map(key => Math.hypot(auto[key][0] - final[key][0], auto[key][1] - final[key][1]));
  return {
    meanCornerError: corners.reduce((sum, value) => sum + value, 0) / 4,
    corners,
    iou: quadIoU(auto, final),
  };
};

const recordFor = (fixture, card, key) => {
  const region = card.regions?.[key];
  if (!region?.quad) return null;
  const hadAuto = region.source === 'auto' || region.source === 'auto-edited' || Boolean(region.autoQuad);
  const autoQuad = region.autoQuad ?? (region.source === 'auto' ? region.quad : null);
  let meanCornerError = null;
  let iou = null;
  if (autoQuad && card.groundTruthQuad) {
    const measured = measureQuads(card.groundTruthQuad, autoQuad, region.quad);
    meanCornerError = measured.meanCornerError;
    iou = measured.iou;
  }
  const tags = [...new Set([...(fixture.tags ?? []), ...(card.tags ?? [])])];
  return {
    fixtureId: fixture.id,
    cardId: card.id,
    family: effectiveFrameFamily(card),
    tags,
    region: key,
    source: region.source,
    hadAuto,
    confidence: region.source === 'manual' && !region.autoQuad ? null : (region.confidence ?? null),
    meanCornerError,
    iou,
  };
};

export const collectFrameRecords = fixtures => {
  const records = [];
  for (const fixture of fixtures ?? []) {
    for (const card of fixture.cards ?? []) {
      for (const key of FRAME_REGION_KEYS) {
        const record = recordFor(fixture, card, key);
        if (record) records.push(record);
      }
    }
  }
  return records;
};

const CONF_BINS = [
  [0, 0.2],
  [0.2, 0.4],
  [0.4, 0.6],
  [0.6, 0.8],
  [0.8, 1.01],
];

export const summarizeGroup = records => {
  const n = records.length;
  const detected = records.filter(row => row.hadAuto);
  const accepted = records.filter(row => row.source === 'auto');
  const edited = records.filter(row => row.source === 'auto-edited');
  const manualFailed = records.filter(row => row.source === 'manual' && !row.hadAuto);
  const redrawn = records.filter(row => row.source === 'manual' && row.hadAuto);
  const errors = detected.map(row => row.meanCornerError).filter(value => value != null);
  const editedErrors = edited.map(row => row.meanCornerError).filter(value => value != null);
  const ious = detected.map(row => row.iou).filter(value => value != null);
  const bins = CONF_BINS.map(([lo, hi]) => {
    const rows = detected.filter(row => row.confidence != null && row.confidence >= lo && row.confidence < hi && row.meanCornerError != null);
    return {
      lo,
      hi: hi > 1 ? 1 : hi,
      n: rows.length,
      medianCornerError: median(rows.map(row => row.meanCornerError)),
    };
  });
  return {
    n,
    detected: detected.length,
    detectionRate: n ? detected.length / n : null,
    accepted: accepted.length,
    acceptedRate: n ? accepted.length / n : null,
    edited: edited.length,
    editedRate: n ? edited.length / n : null,
    manualFailed: manualFailed.length,
    manualFailedRate: n ? manualFailed.length / n : null,
    redrawn: redrawn.length,
    medianCornerError: median(errors),
    p90CornerError: percentile(errors, 90),
    medianEditedCornerError: median(editedErrors),
    p90EditedCornerError: percentile(editedErrors, 90),
    medianIoU: median(ious),
    confidenceBins: bins,
  };
};

const byRegion = records =>
  Object.fromEntries(FRAME_REGION_KEYS.map(key => [key, summarizeGroup(records.filter(row => row.region === key))]));

export const summarizeRecords = records => {
  const families = [...new Set(records.map(row => row.family))].sort();
  const familyBlocks = Object.fromEntries(
    families.map(family => [family, byRegion(records.filter(row => row.family === family))]),
  );
  const tagBlocks = {};
  for (const tag of TAG_BREAKS) {
    tagBlocks[tag] = byRegion(records.filter(row => row.tags.includes(tag)));
  }
  const languages = [...new Set(records.flatMap(row => row.tags.filter(tag => tag.startsWith('language-'))))].sort();
  const languageBlocks = Object.fromEntries(
    languages.map(tag => [tag, byRegion(records.filter(row => row.tags.includes(tag)))]),
  );
  const classic = records.filter(
    row => row.tags.includes('classic-frame') || row.family === 'old' || row.family === 'retro',
  );
  return {
    families: familyBlocks,
    tags: tagBlocks,
    languages: languageBlocks,
    classicOrOld: byRegion(classic),
    overall: byRegion(records),
  };
};

const pct = rate => (rate == null ? '—' : `${(rate * 100).toFixed(1)}%`);
const num = value => (value == null ? '—' : value.toFixed(2));

const regionTable = block => {
  const lines = [
    '| region | n | detected | median px | p90 px | median IoU | accepted | auto-edited | manual (no detect) |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const key of FRAME_REGION_KEYS) {
    const row = block[key];
    lines.push(
      `| ${key} | ${row.n} | ${pct(row.detectionRate)} | ${num(row.medianCornerError)} | ${num(row.p90CornerError)} | ${num(row.medianIoU)} | ${pct(row.acceptedRate)} | ${pct(row.editedRate)} | ${pct(row.manualFailedRate)} |`,
    );
  }
  return lines.join('\n');
};

const confidenceLines = block => {
  const lines = [];
  for (const key of FRAME_REGION_KEYS) {
    const bins = block[key].confidenceBins.filter(bin => bin.n > 0);
    if (!bins.length) continue;
    const text = bins
      .map(bin => `${bin.lo.toFixed(1)}–${bin.hi.toFixed(1)} n=${bin.n} median ${num(bin.medianCornerError)}px`)
      .join('; ');
    lines.push(`- ${key}: ${text}`);
  }
  return lines.length ? lines.join('\n') : '- no scored automatic proposals';
};

const hasAny = block => FRAME_REGION_KEYS.some(key => block[key].n > 0);

export const renderFrameReport = (records, { fixtureCount = null } = {}) => {
  const summary = summarizeRecords(records);
  const lines = [];
  lines.push('# Frame region report');
  lines.push('');
  lines.push('Research only. Compares saved auto proposals with the final polygon after human review.');
  lines.push('A region counts only when a final polygon was saved. Failed detections show up when the annotator drew the region by hand (manual, no autoQuad).');
  lines.push('Corner error is the mean of the four corners after both quads are projected into the canonical 744×1039 card. Untouched auto proposals contribute 0.');
  if (fixtureCount != null) lines.push(`Fixtures scanned: ${fixtureCount}. Annotated region rows: ${records.length}.`);
  lines.push('');
  lines.push('## modern_standard');
  lines.push('');
  if (summary.families.modern_standard) lines.push(regionTable(summary.families.modern_standard));
  else lines.push('No modern_standard annotations yet.');
  lines.push('');
  lines.push('### Confidence vs error');
  lines.push('');
  lines.push(summary.families.modern_standard ? confidenceLines(summary.families.modern_standard) : '- none');
  lines.push('');
  const others = Object.keys(summary.families)
    .filter(family => family !== 'modern_standard')
    .sort();
  lines.push('## Other frame families');
  lines.push('');
  if (!others.length) lines.push('None.');
  for (const family of others) {
    lines.push(`### ${family}`);
    lines.push('');
    lines.push(regionTable(summary.families[family]));
    lines.push('');
  }
  lines.push('## Tags');
  lines.push('');
  for (const tag of TAG_BREAKS) {
    lines.push(`### ${tag}`);
    lines.push('');
    if (hasAny(summary.tags[tag])) lines.push(regionTable(summary.tags[tag]));
    else lines.push('No annotated regions with this tag.');
    lines.push('');
  }
  lines.push('### language');
  lines.push('');
  const languageNames = Object.keys(summary.languages);
  if (!languageNames.length) lines.push('No language-* tags on annotated regions.');
  for (const tag of languageNames) {
    lines.push(`#### ${tag}`);
    lines.push('');
    lines.push(regionTable(summary.languages[tag]));
    lines.push('');
  }
  lines.push('### classic / old / retro');
  lines.push('');
  if (hasAny(summary.classicOrOld)) lines.push(regionTable(summary.classicOrOld));
  else lines.push('No classic-frame tags and no old/retro frame family annotations.');
  lines.push('');
  lines.push('## How to read this');
  lines.push('');
  lines.push('1. Detection rate is the share of saved regions that began as an automatic proposal.');
  lines.push('2. Median / p90 px is canonical corner error against the final polygon. The edited-only median is in the JSON summary.');
  lines.push('3. Stable anchors are regions with high detection, high IoU, and low edited corner error on modern_standard.');
  lines.push('4. Confidence is calibrated only if higher bins have lower corner error. Empty bins mean the sample cannot say.');
  lines.push('5. Sleeve, foil, and glare effects are the tag tables. An empty table means the corpus is not tagged, not that the effect is zero.');
  lines.push('6. Frame families other than modern_standard are the ones this template is expected to miss.');
  lines.push('7. Regions that move together and share the same error are redundant anchors; regions the annotator always redraws are not.');
  lines.push('');
  return `${lines.join('\n')}\n`;
};
