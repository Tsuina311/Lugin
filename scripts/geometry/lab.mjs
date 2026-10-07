#!/usr/bin/env node
/**
 * yarn geometry:lab — local Geometry Lab annotation UI (no phone).
 *
 * http://127.0.0.1:8766
 * http://127.0.0.1:8766/?queue=stills-v1 ← frozen 46-frame art box queue
 * yarn geometry:lab --queue=stills-v1
 * http://127.0.0.1:8766/?queue=priority   ← follow yarn geometry:queue order
 * http://127.0.0.1:8766/?synthetic=sleeve ← synthetic suite + Candidate Inspector
 */

import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { analyzeFixture } from './lib/candidates-analyze.mjs';
import { listFixtures, saveFixture, writeManifest } from './lib/corpus.mjs';
import { decodeImageFile, loadDetectScan } from './lib/detect-host.mjs';
import { runNativeDetectorBatch } from './lib/detect-native.mjs';
import { applyAutoProposals, moveRegionCorner, regionStatus } from './lib/frame-regions/annotations.mjs';
import { artBoxIssues } from './lib/frame-regions/artbox-quality.mjs';
import { detectFrameRegions } from './lib/frame-regions/detect.mjs';
import { CARD_HEIGHT, CARD_WIDTH, orientCardRegions, orderRegionQuadInCardSpace, projectCanonicalRegions } from './lib/frame-regions/project.mjs';
import { CORPUS_ROOT, rootDir } from './lib/paths.mjs';
import { loadPriorityQueue } from './lib/queue.mjs';
import {
  ALLOWED_TAGS,
  FRAME_FAMILIES,
  FRAME_REGION_KEYS,
  cornersToGtQuad,
  createCard,
  createFixture,
  gtQuadToCorners,
  isCompleteQuad,
} from './lib/schema.mjs';
import { fixtureArtReviewed, orderStillsQueue } from './lib/stills-queue.mjs';
import { loadSyntheticFixtures } from './lib/synthetic/generate.mjs';
import { PNG } from 'pngjs';

const port = Number(process.env.GEOMETRY_LAB_PORT || 8766);
const synthSuiteBoot = process.env.GEOMETRY_LAB_SYNTHETIC || null;
let allFixtures = await listFixtures();
if (synthSuiteBoot) {
  const syn = await loadSyntheticFixtures({ suite: synthSuiteBoot });
  allFixtures = [...syn, ...allFixtures];
}
if (!allFixtures.length) {
  console.error('No fixtures. Run yarn geometry:bootstrap or geometry:synthetic.');
  process.exit(1);
}

const queueFlag = (() => {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--queue' && args[i + 1]) return args[i + 1];
    if (args[i].startsWith('--queue=')) return args[i].slice('--queue='.length);
  }
  return null;
})();

/** @type {'all' | 'priority' | 'synthetic' | 'confirmed' | 'stills-v1'} */
let mode = queueFlag === 'stills-v1'
  ? 'stills-v1'
  : process.env.GEOMETRY_LAB_FRAMES === 'confirmed'
    ? 'confirmed'
    : 'all';
/** Ordered fixture ids for the active mode. */
let orderIds = allFixtures.map(f => f.id);
let index = 0;
/** @type {Map<string, object>} */
let queueMeta = new Map();
let syntheticSuite = null;

const byId = () => new Map(allFixtures.map(f => [f.id, f]));

const refreshOrder = async () => {
  if (mode === 'synthetic' && syntheticSuite) {
    const syn = await loadSyntheticFixtures({ suite: syntheticSuite });
    // Keep synthetic fixtures in allFixtures map
    const map = new Map(allFixtures.map(f => [f.id, f]));
    for (const f of syn) map.set(f.id, f);
    allFixtures = [...map.values()];
    orderIds = syn.map(f => f.id);
    queueMeta = new Map();
    if (index >= orderIds.length) index = Math.max(0, orderIds.length - 1);
    return;
  }
  allFixtures = await listFixtures();
  if (syntheticSuite) {
    const syn = await loadSyntheticFixtures({ suite: syntheticSuite });
    allFixtures = [...syn, ...allFixtures];
  }
  const map = byId();
  if (mode === 'stills-v1') {
    const queued = await orderStillsQueue(allFixtures);
    allFixtures = [...allFixtures, ...queued.extras];
    orderIds = queued.ids;
    queueMeta = new Map();
  } else if (mode === 'confirmed') {
    const cornersPath = join(rootDir, 'scanner-benchmark/annotations/corners.json');
    const corners = existsSync(cornersPath) ? JSON.parse(readFileSync(cornersPath, 'utf8')) : [];
    const byImage = new Map();
    for (const fixture of allFixtures) {
      if (!byImage.has(fixture.image)) byImage.set(fixture.image, fixture.id);
    }
    const ids = [];
    const extras = [];
    for (const row of corners) {
      if (row.status !== 'CONFIRMED' || !row.imageId) continue;
      const existing = byImage.get(row.imageId);
      if (existing) {
        ids.push(existing);
        continue;
      }
      const abs = join(rootDir, row.imageId);
      if (!existsSync(abs)) continue;
      let id = row.imageId.replace(/^\./, '').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_');
      if (allFixtures.some(fixture => fixture.id === id) || extras.some(fixture => fixture.id === id)) {
        id = `${id}__corners`;
      }
      const quad = cornersToGtQuad(row.corners);
      const source = row.imageId.includes('/replay/')
        ? 'replay'
        : row.imageId.includes('/real-photos/')
          ? 'real-photos'
          : 'unknown';
      extras.push(createFixture({
        id,
        image: row.imageId,
        source,
        cards: [createCard({
          groundTruthQuad: isCompleteQuad(quad) ? quad : null,
          groundTruthSource: 'existing-annotation',
        })],
        notes: row.notes || '',
        bootstrapNotes: 'Confirmed card corners. Art box is still to label.',
      }));
      ids.push(id);
    }
    allFixtures = [...allFixtures, ...extras];
    orderIds = ids;
    queueMeta = new Map();
  } else if (mode === 'priority') {
    const q = await loadPriorityQueue();
    if (!q?.queue?.length) {
      console.warn('No priority-queue.json — run yarn geometry:queue. Falling back to all.');
      mode = 'all';
      orderIds = allFixtures.map(f => f.id);
      queueMeta = new Map();
      return;
    }
    // Prefer still-untrusted entries; keep trusted ones out of the active walk.
    const ids = [];
    queueMeta = new Map();
    for (const row of q.queue) {
      queueMeta.set(row.id, row);
      const f = map.get(row.id);
      if (!f) continue;
      if (f.trusted) continue;
      ids.push(row.id);
    }
    orderIds = ids.length ? ids : q.queue.map(r => r.id).filter(id => map.has(id));
  } else {
    orderIds = allFixtures.map(f => f.id);
    queueMeta = new Map();
  }
  if (index >= orderIds.length) index = Math.max(0, orderIds.length - 1);
};

const currentFixture = () => {
  const id = orderIds[index];
  return byId().get(id) ?? null;
};

await refreshOrder();

const resolveImage = fixture => {
  const abs = join(rootDir, fixture.image);
  return existsSync(abs) ? abs : null;
};

const page = () => `<!doctype html>
<html lang="en">
<meta charset="utf-8"/>
<title>Lugin Geometry Lab</title>
<style>
  :root { --bg:#12141a; --panel:#1b1e27; --line:#2e3340; --text:#e8eaef; --muted:#9aa3b2; --accent:#6cb2ff; --ok:#3dd68c; --warn:#f5a524; }
  * { box-sizing: border-box; }
  body { margin:0; font:13px/1.4 ui-sans-serif, system-ui, sans-serif; background:var(--bg); color:var(--text); height:100vh; display:grid; grid-template-columns: 1fr 340px; }
  header { grid-column:1/-1; display:flex; gap:8px; align-items:center; flex-wrap:wrap; padding:8px 12px; background:var(--panel); border-bottom:1px solid var(--line); }
  header button, aside button, aside select { background:#262b36; color:var(--text); border:1px solid var(--line); border-radius:6px; padding:6px 10px; cursor:pointer; }
  header button:hover, aside button:hover { border-color:var(--accent); }
  #stageWrap { position:relative; overflow:hidden; background:#0a0b0e; }
  #stage { position:absolute; inset:0; overflow:auto; }
  canvas { display:block; cursor:grab; background:#000; transform-origin:0 0; }
  aside { border-left:1px solid var(--line); background:var(--panel); padding:12px; overflow:auto; }
  h1 { font-size:14px; margin:0 0 8px; }
  .muted { color:var(--muted); }
  .row { display:flex; gap:6px; flex-wrap:wrap; margin:6px 0; }
  label { display:flex; gap:6px; align-items:center; margin:4px 0; }
  .tags { display:flex; flex-wrap:wrap; gap:4px; max-height:160px; overflow:auto; }
  .tags label { font-size:12px; background:#222632; padding:2px 6px; border-radius:4px; }
  #status { color:var(--ok); }
  #err { color:#ff6b6b; }
  #modeBadge { background:#3a2a12; color:var(--warn); border:1px solid #6a4a1a; border-radius:6px; padding:4px 8px; font-weight:600; }
  #priorityWhy { font-size:12px; color:var(--muted); margin:8px 0; white-space:pre-wrap; }
  input[type=text] { width:100%; background:#12141a; color:var(--text); border:1px solid var(--line); border-radius:6px; padding:6px; }
  .region-row { display:flex; gap:6px; align-items:center; width:100%; text-align:left; padding:6px 8px; border-radius:6px; cursor:pointer; margin:2px 0; background:transparent; color:inherit; border:1px solid transparent; }
  .region-row.selected { outline:1px solid var(--accent); background:#243044; }
  .region-row .st { margin-left:auto; font-size:11px; color:var(--muted); }
  .region-row .st.auto { color:var(--ok); }
  .region-row .st.edit { color:var(--warn); }
  .region-row .st.manual { color:var(--text); }
  #frameCount { font-size:22px; font-weight:700; }
  #autoFrame, #drawRegion, #prev, #next, #save, #saveNext, #acceptArt, #drawArt, #saveNextArt { flex:1; font-weight:700; padding:10px 12px; font-size:15px; }
  #autoFrame, #acceptArt { background:#1f6b45; }
  #saveNext, #saveNextArt { background:#24508a; }
  #artPreview { width:100%; max-height:220px; object-fit:contain; background:#000; margin-top:8px; }
  details summary { cursor:pointer; margin:10px 0 6px; color:var(--muted); }
  #debugText { white-space:pre-wrap; font-size:11px; max-height:160px; overflow:auto; }
  #debugC, #debugH, #debugV { width:100%; background:#000; margin-top:4px; }
</style>
<header>
  <strong>Geometry Lab</strong>
  <span id="modeBadge" hidden>priority queue</span>
  <span id="pos" class="muted"></span>
  <button id="fit">Fit</button>
  <button id="zoomIn">Zoom +</button>
  <button id="zoomOut">Zoom −</button>
  <button id="undo">Undo</button>
  <button id="reset">Reset</button>
  <span id="status"></span>
  <span id="err"></span>
</header>
<div id="stageWrap"><div id="stage"><canvas id="c"></canvas></div></div>
<aside>
  <div id="frameCount">Frame</div>
  <div id="frameName" class="muted"></div>
  <div id="frameStatus" class="muted"></div>
  <div id="stillsTools" hidden>
    <div id="autoState"></div>
    <div class="row">
      <button id="acceptArt" type="button">Accept</button>
      <button id="drawArt" type="button">Draw art box</button>
    </div>
    <div class="row">
      <button id="prevArt" type="button">← Prev</button>
      <button id="saveNextArt" type="button">Save + Next</button>
    </div>
    <button id="nextMissing" type="button">Next unannotated</button>
    <img id="artPreview" alt=""/>
    <div class="muted">Artwork window only. Not the title, mana, type line, rules, or footer. A accept · D draw · S or Enter save+next · ← → move · R reset · Delete clear</div>
  </div>
  <div id="genericTools">
  <div class="row">
    <button id="autoFrame" type="button">Auto</button>
    <button id="drawRegion" type="button">Draw</button>
  </div>
  <div class="row">
    <button id="prev" type="button">← Prev</button>
    <button id="next" type="button">Next →</button>
  </div>
  <div class="row">
    <button id="save" type="button">Save</button>
    <button id="saveNext" type="button">Save + Next</button>
  </div>
  <div id="frameHint" class="muted">Auto places one art box. Drag a corner if it is off, then Save + Next.</div>
  </div>
  <details>
    <summary>Other options</summary>
  <h1 id="title">—</h1>
  <div class="muted" id="meta"></div>
  <div id="priorityWhy"></div>
  <div id="artRow"></div>
  <div class="row">
    <button id="deleteRegion" type="button">Delete art box</button>
  </div>
  <label><input type="checkbox" id="showAll"/> Show all boxes</label>
  <label>Frame family
    <select id="frameFamily"></select>
  </label>
  <div id="regions"></div>
  <div class="row">
    <label><input type="checkbox" id="trusted"/> trusted</label>
    <label><input type="checkbox" id="hard"/> hard regression</label>
    <label><input type="checkbox" id="negative"/> negative (no card)</label>
  </div>
  <label>Provenance
    <select id="provenance">
      <option value="manually-reviewed">manually-reviewed</option>
      <option value="existing-annotation">existing-annotation</option>
      <option value="existing-recognition-quad">existing-recognition-quad</option>
      <option value="per-snapshot-quad">per-snapshot-quad</option>
      <option value="synthetic">synthetic</option>
      <option value="none">none</option>
    </select>
  </label>
  <label>Visibility
    <select id="visibility">
      <option value="full">full</option>
      <option value="partial">partial</option>
    </select>
  </label>
  <label>Active card
    <select id="cardSelect"></select>
  </label>
  <div class="row">
    <button id="addCard">Add Card</button>
    <button id="delCard">Delete Card</button>
  </div>
  <h1>Tags</h1>
  <div class="tags" id="tags"></div>
  <h1>Notes</h1>
  <input type="text" id="notes" placeholder="optional notes"/>
  <details id="frameDebug">
    <summary>Frame debug</summary>
    <canvas id="debugC"></canvas>
    <div class="muted">horizontal edge energy</div>
    <canvas id="debugH" height="56"></canvas>
    <div class="muted">vertical edge energy</div>
    <canvas id="debugV" height="56"></canvas>
    <div id="debugText" class="muted"></div>
  </details>
  <h1>Candidate Inspector</h1>
  <p class="muted">Developer-only. Host DetectCard shortlist — not phone latency.</p>
  <div class="row">
    <button id="inspectCand">Run native Y</button>
    <select id="candTop">
      <option value="1">Top 1</option>
      <option value="3" selected>Top 3</option>
      <option value="5">Top 5</option>
      <option value="99">All</option>
    </select>
  </div>
  <div id="candDetail" class="muted" style="white-space:pre-wrap;font-size:11px;max-height:280px;overflow:auto"></div>
  <div id="candList"></div>
  </details>
</aside>
<script>
const TAGS = ${JSON.stringify(ALLOWED_TAGS)};
const FAMILIES = ${JSON.stringify(FRAME_FAMILIES)};
const REGION_ROWS = [
  { key:'card', label:'CARD' },
  { key:'titleBand', label:'TITLE BAND' },
  { key:'artBox', label:'ART BOX' },
  { key:'typeLine', label:'TYPE LINE' },
  { key:'textBox', label:'TEXT BOX' },
  { key:'footer', label:'FOOTER' },
];
const REGION_COLORS = {
  card:'#f5a524', titleBand:'#6cb2ff', artBox:'#3dd68c', typeLine:'#c084fc', textBox:'#ffb020', footer:'#ff6b6b'
};
const cloneQuad = quad => ({ tl: quad.tl.slice(), tr: quad.tr.slice(), br: quad.br.slice(), bl: quad.bl.slice() });
${regionStatus.toString()}
${moveRegionCorner.toString()}
function acceptArtBox(region){
  if (!region || !region.quad) return null;
  if (region.source === 'auto-edited' || region.source === 'manual') return Object.assign({}, region, { reviewed: true });
  const original = region.autoQuad || region.quad;
  return Object.assign({}, region, { quad: cloneQuad(original), autoQuad: cloneQuad(original), source: 'auto-accepted', reviewed: true });
}
function resetArtBox(region){
  if (!region || !region.autoQuad) return null;
  return Object.assign({}, region, { quad: cloneQuad(region.autoQuad), source: 'auto', reviewed: false });
}
const params = new URLSearchParams(location.search);
const wantPriority = params.get('queue') === 'priority';
const wantConfirmed = params.get('frames') === 'confirmed';
const wantStills = params.get('queue') === 'stills-v1';
const wantSynthetic = params.get('synthetic');
let fixture = null;
let labMode = 'all';
let queueInfo = null;
let cards = [];
let cardIndex = 0;
let scale = 1;
let history = [];
let candAnalysis = null;
let candFocus = null;
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const img = new Image();
const labels = ['TL','TR','BR','BL'];
const keys = ['tl','tr','br','bl'];
let drag = null;
let regionKey = 'artBox';
let draw = null;
let frameDebug = null;
let stillsMode = false;

const active = () => cards[cardIndex] || null;

function pushHistory(){
  history.push(JSON.stringify(cards));
  if (history.length > 40) history.shift();
}

async function ensureMode(){
  if (wantSynthetic) {
    await fetch('/mode', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body: JSON.stringify({ mode: 'synthetic', suite: wantSynthetic }),
    });
    document.getElementById('modeBadge').hidden = false;
    document.getElementById('modeBadge').textContent = 'synthetic:'+wantSynthetic;
    return;
  }
  if (wantStills) {
    await fetch('/mode', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body: JSON.stringify({ mode: 'stills-v1' }),
    });
    document.getElementById('modeBadge').hidden = false;
    document.getElementById('modeBadge').textContent = 'stills-v1 art box';
    return;
  }
  if (wantConfirmed) {
    await fetch('/mode', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body: JSON.stringify({ mode: 'confirmed' }),
    });
    document.getElementById('modeBadge').hidden = false;
    document.getElementById('modeBadge').textContent = '46 confirmed frames';
    return;
  }
  if (!wantPriority) return;
  await fetch('/mode', {
    method:'POST',
    headers:{'content-type':'application/json'},
    body: JSON.stringify({ mode: 'priority' }),
  });
  document.getElementById('modeBadge').hidden = false;
}

async function load(){
  const res = await fetch('/item');
  if(!res.ok){ document.getElementById('err').textContent = 'No fixture'; return; }
  const data = await res.json();
  fixture = data.fixture;
  queueInfo = data.queue || null;
  cards = (fixture.cards && fixture.cards.length)
    ? JSON.parse(JSON.stringify(fixture.cards))
    : [{ id:'card-1', groundTruthQuad:{tl:[0,0],tr:[0,0],br:[0,0],bl:[0,0]}, visibility:'full', occluded:false, tags:[], groundTruthSource:'manually-reviewed' }];
  cardIndex = 0;
  history = [];
  draw = null;
  frameDebug = null;
  candAnalysis = null;
  candFocus = null;
  document.getElementById('candDetail').textContent = '';
  document.getElementById('candList').innerHTML = '';
  labMode = data.mode || 'all';
  stillsMode = labMode === 'stills-v1';
  document.getElementById('stillsTools').hidden = !stillsMode;
  document.getElementById('genericTools').hidden = stillsMode;
  document.getElementById('pos').textContent = 'Frame '+(data.index+1)+' of '+data.total;
  document.getElementById('frameCount').textContent = stillsMode
    ? (data.annotated+' / '+data.total+' annotated')
    : ('Frame '+(data.index+1)+' of '+data.total);
  document.getElementById('frameName').textContent = stillsMode
    ? ('Frame '+(data.index+1)+' of '+data.total+' · '+(fixture.label || fixture.id))
    : fixture.id;
  if (!stillsMode) {
    document.getElementById('frameHint').textContent = data.mode === 'confirmed'
      ? 'Auto places one art box. Drag a corner if it is off, then Save + Next.'
      : data.mode === 'priority'
        ? 'Next moves on without saving. Auto or Draw places the card. Save + Next stores that outline.'
        : 'Full fixture list. For the 46 art boxes, run yarn geometry:lab --queue=stills-v1';
  }
  document.getElementById('title').textContent = fixture.id;
  regionKey = data.mode === 'priority' ? 'card' : 'artBox';
  document.getElementById('meta').textContent = (fixture.source||'')+' · '+(fixture.image||'');
  document.getElementById('trusted').checked = !!fixture.trusted;
  document.getElementById('hard').checked = !!fixture.hardRegression;
  document.getElementById('negative').checked = !!fixture.negative;
  document.getElementById('notes').value = fixture.notes || '';
  if (queueInfo) {
    const why = (queueInfo.reasons||[]).join(', ');
    const disagree = queueInfo.trackRecogDisagreementIoU != null
      ? '\\ntrack/recog IoU: '+Number(queueInfo.trackRecogDisagreementIoU).toFixed(2) : '';
    document.getElementById('priorityWhy').textContent =
      'rank #'+queueInfo.rank+' · score '+queueInfo.priorityScore+
      '\\nprov: '+queueInfo.bootstrapProvenance+
      '\\n'+why+disagree;
  } else {
    document.getElementById('priorityWhy').textContent = '';
  }
  syncCardUi();
  img.onload = async () => {
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    if (!stillsMode && data.mode !== 'priority') {
      for (const c of cards) {
        const q = c.groundTruthQuad;
        if (!q || (q.tl[0]===0&&q.tl[1]===0&&q.br[0]===0&&q.br[1]===0)) {
          const m = Math.min(img.naturalWidth, img.naturalHeight)*0.1;
          c.groundTruthQuad = {
            tl:[m,m], tr:[img.naturalWidth-m,m],
            br:[img.naturalWidth-m, img.naturalHeight-m], bl:[m, img.naturalHeight-m]
          };
        }
      }
    }
    fit();
    redraw();
    if (stillsMode) await ensureArtProposal();
    refreshArtUi();
  };
  img.src = '/image?'+Date.now();
}

function syncCardUi(){
  const sel = document.getElementById('cardSelect');
  sel.innerHTML = cards.map((c,i)=>'<option value="'+i+'">'+c.id+'</option>').join('');
  sel.value = String(cardIndex);
  const c = active();
  if (!c) return;
  document.getElementById('provenance').value = c.groundTruthSource || 'manually-reviewed';
  document.getElementById('visibility').value = c.visibility || 'full';
  const box = document.getElementById('tags');
  const tagSet = new Set([...(fixture.tags||[]), ...(c.tags||[])]);
  box.innerHTML = TAGS.map(t =>
    '<label><input type="checkbox" data-tag="'+t+'" '+(tagSet.has(t)?'checked':'')+'/> '+t+'</label>'
  ).join('');
  syncRegions();
}

function cardStatus(card){
  if (!card?.groundTruthQuad) return 'missing';
  if (card.cardQuadEdited) return 'auto-edited';
  if (card.cardQuadProposed) return 'auto';
  return 'manual';
}

function syncRegions(){
  const sel = document.getElementById('frameFamily');
  if (!sel.options.length) {
    sel.innerHTML = FAMILIES.map(f => '<option value="'+f+'">'+f+'</option>').join('');
  }
  const c = active();
  sel.value = c && FAMILIES.includes(c.frameFamily) ? c.frameFamily : 'unknown';
  const htmlFor = row => {
    const status = row.key === 'card' ? cardStatus(c) : regionStatus(c && c.regions ? c.regions[row.key] : null);
    const region = row.key !== 'card' && c && c.regions ? c.regions[row.key] : null;
    const conf = region && region.confidence != null ? ' '+Number(region.confidence).toFixed(2) : '';
    const low = region && region.confidence != null && region.confidence < 0.45;
    const cls = status === 'auto-edited' || (status === 'auto' && low) ? 'edit' : status === 'auto' ? 'auto' : status === 'manual' ? 'manual' : '';
    return '<div class="region-row'+(row.key===regionKey?' selected':'')+'" data-region="'+row.key+'">'+
      '<span>'+row.label+'</span><span class="st '+cls+'">'+status+conf+'</span></div>';
  };
  document.getElementById('artRow').innerHTML = htmlFor(REGION_ROWS.find(row => row.key === 'artBox'));
  document.getElementById('regions').innerHTML = REGION_ROWS.filter(row => row.key !== 'artBox').map(htmlFor).join('');
}

function fit(){
  const wrap = document.getElementById('stageWrap');
  const sx = wrap.clientWidth / Math.max(1, canvas.width);
  const sy = wrap.clientHeight / Math.max(1, canvas.height);
  scale = Math.min(sx, sy) * 0.98;
  canvas.style.width = (canvas.width * scale) + 'px';
  canvas.style.height = (canvas.height * scale) + 'px';
}

function showAllOn(){
  const box = document.getElementById('showAll');
  return !!(box && box.checked);
}

function strokeQuad(q, color, label, handles, dashed){
  const pts = keys.map(k => ({x:q[k][0], y:q[k][1]}));
  ctx.strokeStyle = color;
  ctx.fillStyle = handles ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0)';
  ctx.lineWidth = Math.max(handles ? 3 : 1.5, (handles ? 3 : 1.5)/scale);
  ctx.setLineDash(dashed ? [10, 6] : []);
  ctx.beginPath();
  pts.forEach((p,i)=> i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.font = Math.max(12, 14/scale)+'px sans-serif';
  ctx.fillText(label, pts[0].x+8, pts[0].y+16);
  if (handles) keys.forEach((k,i) => drawHandle(q[k], color, labels[i]));
}

function redraw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(img,0,0);
  const showAll = showAllOn();
  const activeCard = active();
  cards.forEach((card, ci) => {
    if (ci === cardIndex || !showAll || !card.groundTruthQuad) return;
    strokeQuad(card.groundTruthQuad, '#6cb2ff', card.id, false);
  });
  if (activeCard) {
    const showCard = showAll || regionKey === 'card' || stillsMode;
    if (showCard && activeCard.groundTruthQuad) {
      strokeQuad(activeCard.groundTruthQuad, REGION_COLORS.card, 'CARD', regionKey === 'card');
    }
    if (showCard && activeCard.sleeveQuad) {
      const sq = activeCard.sleeveQuad;
      const spts = keys.map(k => ({x:sq[k][0], y:sq[k][1]}));
      ctx.strokeStyle = '#c084fc';
      ctx.setLineDash([8,6]);
      ctx.beginPath();
      spts.forEach((p,i)=> i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
      ctx.closePath(); ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const row of REGION_ROWS) {
      if (row.key === 'card') continue;
      if (!showAll && regionKey !== row.key) continue;
      if (draw && draw.key === row.key) continue;
      const region = activeCard.regions && activeCard.regions[row.key];
      if (!region || !region.quad) continue;
      const proposal = row.key === 'artBox' && region.source === 'auto' && !region.reviewed;
      strokeQuad(region.quad, REGION_COLORS[row.key], proposal ? 'AUTO' : row.label, regionKey === row.key, proposal);
    }
  }
  if (draw && draw.points.length) {
    ctx.strokeStyle = REGION_COLORS[draw.key] || '#fff';
    ctx.fillStyle = '#fff';
    ctx.lineWidth = Math.max(2, 2/scale);
    ctx.beginPath();
    draw.points.forEach((p,i)=> i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
    ctx.stroke();
    draw.points.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(5, 7/scale), 0, 7);
      ctx.fill();
    });
  }
  // Candidate overlays
  if (candAnalysis?.candidates) {
    const topN = Number(document.getElementById('candTop').value || 3);
    const colors = ['#ff4d6d','#ff9f1c','#2ec4b6','#a2d2ff','#e9c46a','#90be6d','#f72585','#4cc9f0'];
    candAnalysis.candidates.slice(0, topN).forEach((c, i) => {
      const q = c.quad;
      if (!q?.topLeft) return;
      const pts = [q.topLeft, q.topRight, q.bottomRight, q.bottomLeft];
      const focused = candFocus === i || (candFocus == null && c.selected);
      ctx.strokeStyle = colors[i % colors.length];
      ctx.lineWidth = Math.max(focused ? 3 : 1.5, (focused ? 3 : 1.5)/scale);
      ctx.globalAlpha = focused ? 1 : 0.55;
      ctx.beginPath();
      pts.forEach((p,j)=> j?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
      ctx.closePath(); ctx.stroke();
      ctx.fillStyle = colors[i % colors.length];
      ctx.font = Math.max(11, 12/scale)+'px monospace';
      ctx.fillText('#'+c.rank+' '+(c.score?.toFixed?.(3)??''), pts[0].x+4, pts[0].y-4);
      ctx.globalAlpha = 1;
    });
  }
}

function canvasPos(e){
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (canvas.width / r.width),
    y: (e.clientY - r.top) * (canvas.height / r.height),
  };
}

function pointInQuad(p, q){
  const pts = keys.map(k => ({x:q[k][0], y:q[k][1]}));
  let inside = false;
  for (let i=0, j=3; i<4; j=i++) {
    const a = pts[i], b = pts[j];
    const hit = ((a.y > p.y) !== (b.y > p.y)) && (p.x < (b.x-a.x) * (p.y-a.y) / ((b.y-a.y) || 1e-9) + a.x);
    if (hit) inside = !inside;
  }
  return inside;
}

function parkPoint(pt){
  const x = Array.isArray(pt) ? pt[0] : pt.x;
  const y = Array.isArray(pt) ? pt[1] : pt.y;
  const m = Math.max(16, 20 / scale);
  const w = canvas.width;
  const h = canvas.height;
  const minX = m;
  const maxX = Math.max(m, w - 1 - m);
  const minY = m;
  const maxY = Math.max(m, h - 1 - m);
  if (x >= minX && x <= maxX && y >= minY && y <= maxY) return { x: x, y: y, outside: false };
  const cx = w / 2;
  const cy = h / 2;
  let t = 1;
  const dx = x - cx;
  const dy = y - cy;
  if (Math.abs(dx) > 1e-6) {
    const tx = dx > 0 ? (maxX - cx) / dx : (minX - cx) / dx;
    if (tx > 0) t = Math.min(t, tx);
  }
  if (Math.abs(dy) > 1e-6) {
    const ty = dy > 0 ? (maxY - cy) / dy : (minY - cy) / dy;
    if (ty > 0) t = Math.min(t, ty);
  }
  return { x: cx + dx * t, y: cy + dy * t, outside: true };
}

function hitHandle(q, p){
  const hitR = Math.max(18, 22/scale);
  for (let i=0;i<4;i++){
    const view = parkPoint(q[keys[i]]);
    if (Math.hypot(p.x-view.x, p.y-view.y) <= hitR) return keys[i];
  }
  return null;
}

function drawHandle(pt, color, label){
  const view = parkPoint(pt);
  const r = Math.max(7, 10/scale);
  ctx.beginPath();
  ctx.arc(view.x, view.y, r, 0, 7);
  ctx.lineWidth = Math.max(2, 2/scale);
  if (view.outside) {
    ctx.fillStyle = '#12141a';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.stroke();
  } else {
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.fillStyle = '#fff';
  ctx.font = Math.max(12, 14/scale)+'px sans-serif';
  ctx.fillText(label + (view.outside ? ' outside' : ''), view.x + r + 4, view.y - r);
}

async function finishDraw(){
  const c = active();
  const pts = draw.points.slice();
  const key = draw.key;
  draw = null;
  let quad = {
    tl:[pts[0].x, pts[0].y], tr:[pts[1].x, pts[1].y],
    br:[pts[2].x, pts[2].y], bl:[pts[3].x, pts[3].y],
  };
  if (key !== 'card') {
    if (!c.groundTruthQuad) {
      draw = { key: key, points: pts };
      document.getElementById('frameStatus').textContent = 'Draw the card first. The region takes the card\\'s upright orientation.';
      redraw();
      return;
    }
    const res = await fetch('/normalize-region', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body: JSON.stringify({ regionQuad: quad, cardQuad: c.groundTruthQuad }),
    });
    const j = await res.json();
    if (!res.ok) {
      draw = { key: key, points: pts };
      document.getElementById('err').textContent = j.error || 'region is not a convex quad';
      document.getElementById('frameStatus').textContent = j.error || 'region is not a convex quad';
      redraw();
      return;
    }
    quad = j.quad;
  }
  pushHistory();
  c.regions = c.regions || {};
  const prev = c.regions[key];
  const autoQuad = prev && (prev.autoQuad || prev.source === 'auto' || prev.source === 'auto-edited')
    ? (prev.autoQuad || prev.quad) : null;
  if (key === 'card') {
    c.groundTruthQuad = quad;
    c.cardQuadProposed = false;
    c.cardQuadEdited = false;
  } else {
    c.regions[key] = Object.assign({ quad: quad, source: 'manual', reviewed: false }, autoQuad ? { autoQuad: autoQuad } : {});
  }
  document.getElementById('frameStatus').textContent = key === 'card'
    ? 'Placed card. Drag a corner if it is off, then Save + Next.'
    : 'Placed '+key+' in card orientation (TL TR BR BL). Drag a corner if it is off, then Save + Next.';
  syncRegions();
  redraw();
  refreshArtUi();
}

canvas.onpointerdown = e => {
  const c = active();
  if (!c) return;
  const p = canvasPos(e);
  if (draw) {
    draw.points.push(p);
    if (draw.points.length === 4) finishDraw().catch(err => {
      document.getElementById('err').textContent = err.message || String(err);
    });
    else {
      document.getElementById('frameStatus').textContent = 'point '+(draw.points.length)+'/4';
      redraw();
    }
    return;
  }
  const q = regionKey === 'card'
    ? c.groundTruthQuad
    : (c.regions && c.regions[regionKey] && c.regions[regionKey].quad);
  if (!q) return;
  const corner = hitHandle(q, p);
  if (!corner) return;
  pushHistory();
  drag = { kind: regionKey === 'card' ? 'card' : 'region', corner: corner };
  if (drag.kind === 'card' && c.cardQuadProposed) c.cardQuadEdited = true;
  canvas.setPointerCapture(e.pointerId);
};
canvas.onpointermove = e => {
  if (!drag) return;
  const c = active();
  const p = canvasPos(e);
  if (drag.kind === 'card') c.groundTruthQuad[drag.corner] = [p.x, p.y];
  else if (c.regions && c.regions[regionKey]) c.regions[regionKey] = moveRegionCorner(c.regions[regionKey], drag.corner, [p.x, p.y]);
  redraw();
};
canvas.onpointerup = () => {
  if (drag && drag.kind === 'region') {
    syncRegions();
    refreshArtUi();
  }
  drag = null;
};

document.getElementById('fit').onclick = () => { fit(); };
document.getElementById('zoomIn').onclick = () => {
  scale *= 1.2;
  canvas.style.width = (canvas.width * scale)+'px';
  canvas.style.height = (canvas.height * scale)+'px';
};
document.getElementById('zoomOut').onclick = () => {
  scale /= 1.2;
  canvas.style.width = (canvas.width * scale)+'px';
  canvas.style.height = (canvas.height * scale)+'px';
};
document.getElementById('undo').onclick = () => {
  if (draw && draw.points.length) {
    draw.points.pop();
    if (!draw.points.length) draw = null;
    document.getElementById('frameStatus').textContent = draw ? 'point '+draw.points.length+'/4' : '';
    redraw();
    return;
  }
  const prev = history.pop();
  if (!prev) return;
  cards = JSON.parse(prev);
  syncCardUi(); redraw();
};
document.getElementById('reset').onclick = async () => { await load(); };
document.getElementById('prev').onclick = async () => {
  await fetch('/nav',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({dir:-1})});
  await load();
};
document.getElementById('next').onclick = async () => {
  await fetch('/nav',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({dir:1})});
  await load();
};
document.getElementById('cardSelect').onchange = e => { cardIndex = Number(e.target.value); syncCardUi(); redraw(); };
document.getElementById('addCard').onclick = () => {
  pushHistory();
  const n = cards.length + 1;
  cards.push({
    id: 'card-'+n,
    groundTruthQuad: {
      tl:[40,40], tr:[canvas.width-40,40],
      br:[canvas.width-40, canvas.height-40], bl:[40, canvas.height-40]
    },
    visibility:'full', occluded:false, tags:[], groundTruthSource:'manually-reviewed', frameFamily:'unknown'
  });
  cardIndex = cards.length-1;
  syncCardUi(); redraw();
};
document.getElementById('delCard').onclick = () => {
  if (cards.length <= 1) return;
  pushHistory();
  cards.splice(cardIndex,1);
  cardIndex = Math.max(0, cardIndex-1);
  syncCardUi(); redraw();
};
document.getElementById('provenance').onchange = e => { const c=active(); if(c) c.groundTruthSource = e.target.value; };
document.getElementById('visibility').onchange = e => { const c=active(); if(c) c.visibility = e.target.value; };

async function saveFixture(advance){
  document.getElementById('err').textContent = '';
  const tagInputs = [...document.querySelectorAll('#tags input')];
  const selected = tagInputs.filter(i=>i.checked).map(i=>i.dataset.tag);
  for (const c of cards) {
    c.tags = selected;
    c.groundTruthSource = document.getElementById('provenance').value;
  }
  const body = {
    trusted: document.getElementById('trusted').checked,
    hardRegression: document.getElementById('hard').checked,
    negative: document.getElementById('negative').checked,
    notes: document.getElementById('notes').value,
    tags: selected,
    cards: document.getElementById('negative').checked ? [] : cards,
    advance: !!advance,
  };
  const res = await fetch('/save', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
  const j = await res.json();
  if (!res.ok) {
    document.getElementById('err').textContent = j.error || 'save failed';
    document.getElementById('frameStatus').textContent = (j.issues || [j.error || 'save failed']).join(' ');
    return;
  }
  document.getElementById('status').textContent = 'saved';
  setTimeout(()=> document.getElementById('status').textContent='', 1200);
  if (advance) await load();
}

document.getElementById('save').onclick = () => saveFixture(false);
document.getElementById('saveNext').onclick = () => {
  if (!document.getElementById('trusted').checked && !document.getElementById('negative').checked) {
    document.getElementById('trusted').checked = true;
  }
  saveFixture(true);
};

document.getElementById('candTop').onchange = () => redraw();
document.getElementById('inspectCand').onclick = async () => {
  document.getElementById('candDetail').textContent = 'running DetectCard (host)…';
  const top = Number(document.getElementById('candTop').value || 5);
  const res = await fetch('/inspect-candidates', {
    method:'POST',
    headers:{'content-type':'application/json'},
    body: JSON.stringify({ top, nativeInput: 'y-from-rgba' }),
  });
  const j = await res.json();
  if (!res.ok) {
    document.getElementById('candDetail').textContent = j.error || 'inspect failed';
    return;
  }
  candAnalysis = j.analysis;
  candFocus = null;
  const list = document.getElementById('candList');
  list.innerHTML = (candAnalysis.candidates || []).map((c,i) =>
    '<button data-ci="'+i+'" style="display:block;width:100%;text-align:left;margin:2px 0">#'+
    c.rank+' score='+(c.score?.toFixed?.(3)??'?')+' '+(c.method||'')+(c.selected?' ★':'')+
    '</button>'
  ).join('');
  list.onclick = e => {
    const b = e.target.closest('button[data-ci]');
    if (!b) return;
    candFocus = Number(b.dataset.ci);
    const c = candAnalysis.candidates[candFocus];
    const g = candAnalysis.perGt?.[0];
    const parts = c.components || {};
    document.getElementById('candDetail').textContent =
      'rank #'+c.rank+' selected='+!!c.selected+
      '\\nscore '+c.score+
      '\\nmethod '+c.method+
      '\\naspect='+parts.aspect+' parallel='+parts.parallel+
      '\\narea='+parts.area+' center='+parts.center+
      '\\nIoU vs GT '+(g ? (g.bestCandidateRank===c.rank ? g.bestCandidateIou : '—') : '—')+
      '\\nnested: '+(candAnalysis.nested?.behavior||'')+
      '\\nfailure: '+(g?.failureCategory||'none')+
      (g?.sleeveAnalysis ? '\\nsleeve winner='+g.sleeveAnalysis.winner+' cardRank='+g.sleeveAnalysis.cardRank : '');
    redraw();
  };
  const g0 = candAnalysis.perGt?.[0];
  document.getElementById('candDetail').textContent =
    'shortlist='+candAnalysis.shortlistCount+' raw='+candAnalysis.rawCandidateCount+
    '\\nnestedInnerPreferred='+candAnalysis.nestedInnerPreferred+
    '\\nbestCand IoU='+(g0?.bestCandidateIou?.toFixed?.(3)??'—')+' rank='+(g0?.bestCandidateRank??'—')+
    '\\n'+(g0?.failureCategory || 'selected OK / no failure')+
    (g0?.sleeveAnalysis ? '\\nsleeve: '+g0.sleeveAnalysis.winner : '');
  redraw();
};

function selectRegion(event){
  const row = event.target.closest('[data-region]');
  if (!row) return;
  regionKey = row.dataset.region;
  if (draw && draw.key !== regionKey) draw = null;
  syncRegions();
  redraw();
}
document.getElementById('regions').onclick = selectRegion;
document.getElementById('artRow').onclick = selectRegion;
document.getElementById('frameFamily').onchange = e => {
  const c = active();
  if (c) c.frameFamily = e.target.value;
};
document.getElementById('showAll').onchange = () => redraw();
document.getElementById('drawRegion').onclick = () => {
  const row = REGION_ROWS.find(item => item.key === regionKey);
  draw = { key: regionKey, points: [] };
  document.getElementById('frameStatus').textContent = 'Click TL, TR, BR, BL for '+(row ? row.label : regionKey);
  redraw();
};
document.getElementById('deleteRegion').onclick = () => {
  const c = active();
  if (!c) return;
  if (regionKey === 'card') {
    if (!c.groundTruthQuad) {
      document.getElementById('frameStatus').textContent = 'Card is already gone.';
      return;
    }
    pushHistory();
    c.groundTruthQuad = null;
    document.getElementById('frameStatus').textContent = 'Deleted the card box.';
  } else {
    if (!c.regions || !c.regions[regionKey]) {
      document.getElementById('frameStatus').textContent = 'That box is already gone.';
      return;
    }
    pushHistory();
    delete c.regions[regionKey];
    document.getElementById('frameStatus').textContent = 'Deleted '+regionKey+'.';
  }
  draw = null;
  syncRegions();
  redraw();
  refreshArtUi();
};

function drawSpark(id, profile, axis){
  const canvas = document.getElementById(id);
  const w = Math.max(160, canvas.clientWidth || 280);
  canvas.width = w;
  canvas.height = 56;
  const g = canvas.getContext('2d');
  g.fillStyle = '#0a0b0e';
  g.fillRect(0, 0, w, 56);
  if (!profile || !profile.length) return;
  const max = Math.max.apply(null, profile.map(p => p.energy).concat([1]));
  g.strokeStyle = '#6cb2ff';
  g.beginPath();
  profile.forEach((p, i) => {
    const x = p.t * (w - 1);
    const y = 52 - (p.energy / max) * 48;
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  });
  g.stroke();
  (frameDebug.boundaries || []).filter(b => b.axis === axis).forEach(b => {
    if (b.t == null) return;
    const x = b.t * (w - 1);
    g.strokeStyle = b.detected ? '#f5a524' : '#445';
    g.beginPath();
    g.moveTo(x, 0); g.lineTo(x, 56); g.stroke();
  });
}

function drawFrameDebug(){
  const text = document.getElementById('debugText');
  if (!frameDebug) { text.textContent = ''; return; }
  const preview = frameDebug.preview;
  const bytes = Uint8Array.from(atob(preview.gray), ch => ch.charCodeAt(0));
  const view = document.getElementById('debugC');
  view.width = preview.w;
  view.height = preview.h;
  const g = view.getContext('2d');
  const image = g.createImageData(preview.w, preview.h);
  for (let i = 0; i < bytes.length; i++) {
    image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = bytes[i];
    image.data[i * 4 + 3] = 255;
  }
  g.putImageData(image, 0, 0);
  (frameDebug.boundaries || []).forEach(b => {
    if (!b.detected || b.t == null) return;
    g.strokeStyle = b.axis === 'h' ? '#f5a524' : '#6cb2ff';
    g.beginPath();
    if (b.axis === 'h') {
      const y = b.t * (preview.h - 1);
      g.moveTo(0, y); g.lineTo(preview.w, y);
    } else {
      const x = b.t * (preview.w - 1);
      g.moveTo(x, 0); g.lineTo(x, preview.h);
    }
    g.stroke();
  });
  drawSpark('debugH', frameDebug.horizontalProfile, 'h');
  drawSpark('debugV', frameDebug.verticalProfile, 'v');
  text.textContent = (frameDebug.boundaries || []).map(b => {
    const where = b.t == null ? '' : ((b.axis === 'h' ? ' y=' : ' x=') + Number(b.t).toFixed(3));
    const conf = b.detected ? ' conf=' + Number(b.confidence).toFixed(2) + ' cont=' + Number(b.continuity).toFixed(2) : ' ' + (b.reason || 'undetected');
    return b.id + where + ' prior=' + Number(b.prior).toFixed(3) + ' [' + Number(b.lo).toFixed(2) + '–' + Number(b.hi).toFixed(2) + ']' + conf;
  }).join('\\n');
}

async function runCardDetect(){
  const c = active();
  if (!c) return;
  document.getElementById('err').textContent = '';
  document.getElementById('frameStatus').textContent = 'detecting card…';
  const res = await fetch('/frame-detect', {
    method:'POST',
    headers:{'content-type':'application/json'},
    body: JSON.stringify({ only: 'card' }),
  });
  const j = await res.json();
  if (!res.ok) {
    document.getElementById('err').textContent = j.error || 'detect failed';
    document.getElementById('frameStatus').textContent = '';
    return;
  }
  if (!j.cardQuad) {
    document.getElementById('frameStatus').textContent = 'No card outline found. Use Draw.';
    return;
  }
  pushHistory();
  c.groundTruthQuad = j.cardQuad;
  c.cardQuadProposed = true;
  c.cardQuadEdited = false;
  regionKey = 'card';
  draw = null;
  document.getElementById('frameStatus').textContent = 'Card outline placed. Drag a corner if it is off, then Save + Next.';
  syncRegions();
  redraw();
}

async function runFrameDetect(mode){
  const c = active();
  if (!c) return;
  if (mode === 'one' && (regionKey === 'card')) {
    document.getElementById('frameStatus').textContent = 'Select an internal region, or use Auto.';
    return;
  }
  const artOnly = mode === 'art' || mode === 'propose';
  document.getElementById('err').textContent = '';
  document.getElementById('frameStatus').textContent = 'detecting…';
  const previousArt = c.regions && c.regions.artBox ? c.regions.artBox : null;
  const res = await fetch('/frame-detect', {
    method:'POST',
    headers:{'content-type':'application/json'},
    body: JSON.stringify({
      quad: c.groundTruthQuad,
      regions: c.regions || {},
      only: artOnly ? 'artBox' : (mode === 'one' ? regionKey : null),
      force: mode === 'force' || mode === 'art',
    }),
  });
  const j = await res.json();
  if (!res.ok) {
    document.getElementById('err').textContent = j.error || 'detect failed';
    document.getElementById('frameStatus').textContent = '';
    return;
  }
  pushHistory();
  if (j.cardQuad) {
    c.groundTruthQuad = j.cardQuad;
    c.cardQuadProposed = true;
    c.cardQuadEdited = false;
  }
  c.regions = j.regions || {};
  frameDebug = j.debug || null;
  if (artOnly) {
    regionKey = 'artBox';
    draw = null;
    if (!c.regions.artBox && previousArt) c.regions.artBox = previousArt;
    const placed = c.regions.artBox && c.regions.artBox !== previousArt;
    document.getElementById('frameStatus').textContent = mode === 'propose'
      ? (c.regions.artBox && c.regions.artBox.source === 'auto'
        ? 'Auto proposal ready. Press A to accept, or drag a corner.'
        : (c.regions.artBox ? 'Art box kept.' : 'AUTO: NONE. Press D to draw the artwork.'))
      : (placed
        ? 'Art box placed. Drag a corner if it is off, then Next.'
        : (c.regions.artBox ? 'No art box found. The current one is unchanged.' : 'No art box found. Use Draw.'));
    drawFrameDebug();
  } else {
    document.getElementById('frameDebug').open = true;
    const parts = [];
    if (j.applied && j.applied.length) parts.push('applied ' + j.applied.join(', '));
    if (j.skipped && j.skipped.length) parts.push('kept ' + j.skipped.join(', '));
    if (j.cleared && j.cleared.length) parts.push('cleared ' + j.cleared.join(', '));
    if (j.undetected && j.undetected.length) parts.push('undetected ' + j.undetected.join(', '));
    document.getElementById('frameStatus').textContent = parts.join(' · ') || 'no changes';
    drawFrameDebug();
  }
  syncRegions();
  redraw();
  refreshArtUi();
}

function artRegion(){
  const c = active();
  return c && c.regions ? c.regions.artBox : null;
}

let previewToken = 0;
async function refreshArtPreview(){
  const view = document.getElementById('artPreview');
  const art = artRegion();
  if (!stillsMode || !art || !art.quad) {
    view.removeAttribute('src');
    return;
  }
  const token = ++previewToken;
  const res = await fetch('/art-preview', {
    method:'POST',
    headers:{'content-type':'application/json'},
    body: JSON.stringify({ quad: art.quad }),
  });
  if (!res.ok || token !== previewToken) return;
  view.src = URL.createObjectURL(await res.blob());
}

function refreshArtUi(){
  const state = document.getElementById('autoState');
  const art = artRegion();
  if (!stillsMode) {
    state.textContent = '';
    return;
  }
  if (!art || !art.quad) state.textContent = 'AUTO: NONE';
  else if (art.source === 'auto' && !art.reviewed) state.textContent = 'AUTO proposal — not ground truth yet';
  else if (art.source === 'auto-accepted') state.textContent = 'Accepted unchanged';
  else if (art.source === 'auto-edited') state.textContent = 'Edited';
  else if (art.source === 'manual') state.textContent = 'Drawn';
  else state.textContent = art.source || '';
  refreshArtPreview();
}

async function ensureArtProposal(){
  const art = artRegion();
  if (art && art.quad) return;
  await runFrameDetect('propose');
}

function acceptCurrentArt(){
  const c = active();
  const art = artRegion();
  if (!c || !art || !art.quad || art.source !== 'auto') {
    document.getElementById('frameStatus').textContent = art && art.reviewed
      ? 'Already confirmed. Save + Next.'
      : 'AUTO: NONE. Draw the artwork.';
    return;
  }
  pushHistory();
  c.regions.artBox = acceptArtBox(art);
  document.getElementById('frameStatus').textContent = 'Accepted. Save + Next.';
  syncRegions();
  redraw();
  refreshArtUi();
}

function resetCurrentArt(){
  const c = active();
  const next = resetArtBox(artRegion());
  if (!c || !next) {
    document.getElementById('frameStatus').textContent = 'No automatic proposal to restore.';
    return;
  }
  pushHistory();
  c.regions.artBox = next;
  document.getElementById('frameStatus').textContent = 'Reset to the automatic proposal.';
  syncRegions();
  redraw();
  refreshArtUi();
}

document.getElementById('acceptArt').onclick = acceptCurrentArt;
document.getElementById('drawArt').onclick = () => document.getElementById('drawRegion').click();
document.getElementById('prevArt').onclick = () => document.getElementById('prev').click();
document.getElementById('saveNextArt').onclick = () => saveFixture(true);
document.getElementById('nextMissing').onclick = async () => {
  await fetch('/nav', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ to: 'unannotated' }) });
  await load();
};

document.getElementById('autoFrame').onclick = () => {
  const c = active();
  const missingCard = !c || !c.groundTruthQuad;
  if (regionKey === 'card' || missingCard) runCardDetect();
  else runFrameDetect('art');
};
window.addEventListener('keydown', e => {
  if (e.target && e.target.matches && e.target.matches('input, textarea, select')) return;
  if (stillsMode && (e.key === 'a' || e.key === 'A')) { acceptCurrentArt(); return; }
  if (stillsMode && (e.key === 's' || e.key === 'S' || e.key === 'Enter')) { e.preventDefault(); saveFixture(true); return; }
  if (stillsMode && e.key === 'ArrowLeft') { e.preventDefault(); document.getElementById('prev').click(); return; }
  if (stillsMode && e.key === 'ArrowRight') { e.preventDefault(); document.getElementById('next').click(); return; }
  if (stillsMode && (e.key === 'r' || e.key === 'R')) { resetCurrentArt(); return; }
  const order = REGION_ROWS.map(row => row.key);
  if (e.key >= '1' && e.key <= '6') {
    const next = order[Number(e.key) - 1];
    if (draw && draw.key !== next) draw = null;
    regionKey = next;
    syncRegions();
    redraw();
  } else if (e.key === 'd' || e.key === 'D') {
    document.getElementById('drawRegion').click();
  } else if (!stillsMode && (e.key === 'a' || e.key === 'A')) {
    document.getElementById('autoFrame').click();
  } else if ((e.key === 'Backspace' || e.key === 'Delete') && draw) {
    e.preventDefault();
    document.getElementById('undo').click();
  } else if (e.key === 'Backspace' || e.key === 'Delete') {
    e.preventDefault();
    document.getElementById('deleteRegion').click();
  } else if (e.key === 'h' || e.key === 'H') {
    const box = document.getElementById('showAll');
    box.checked = !box.checked;
    redraw();
  }
});

ensureMode().then(load);
</script>
</html>`;

const readBody = async req => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);

    if (url.pathname === '/' ) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page());
      return;
    }
    if (url.pathname === '/mode' && req.method === 'POST') {
      const body = await readBody(req);
      if (body.mode === 'synthetic') {
        mode = 'synthetic';
        syntheticSuite = body.suite || 'sleeve';
      } else if (body.mode === 'confirmed') {
        mode = 'confirmed';
      } else if (body.mode === 'stills-v1') {
        mode = 'stills-v1';
      } else if (body.mode === 'priority') {
        mode = 'priority';
      } else {
        mode = 'all';
      }
      index = 0;
      await refreshOrder();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, mode, suite: syntheticSuite, total: orderIds.length }));
      return;
    }
    if (url.pathname === '/inspect-candidates' && req.method === 'POST') {
      const body = await readBody(req);
      const fixture = currentFixture();
      if (!fixture) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'no fixture' }));
        return;
      }
      const top = Number(body.top || 5);
      const nativeInput = body.nativeInput || 'y-from-rgba';
      const batchDir = join(CORPUS_ROOT, 'native-batch-lab-inspect');
      await mkdir(batchDir, { recursive: true });
      const detections = await runNativeDetectorBatch([fixture], {
        inputMode: nativeInput,
        batchDir,
      });
      const { scan } = await loadDetectScan();
      const analysis = analyzeFixture(fixture, detections.get(fixture.id), scan.polygonIoU, {
        top,
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, analysis, detection: detections.get(fixture.id) }));
      return;
    }
    if (url.pathname === '/item') {
      if (!orderIds.length) {
        res.writeHead(404);
        res.end();
        return;
      }
      const fixture = currentFixture();
      if (!fixture) {
        res.writeHead(404);
        res.end();
        return;
      }
      const q = queueMeta.get(fixture.id) ?? null;
      const view = {
        ...fixture,
        cards: (fixture.cards ?? []).map(card => {
          try {
            return orientCardRegions(card);
          } catch {
            return card;
          }
        }),
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          index,
          total: orderIds.length,
          annotated: orderIds.filter(id => fixtureArtReviewed(byId().get(id))).length,
          mode,
          suite: syntheticSuite,
          fixture: view,
          queue: q,
        }),
      );
      return;
    }
    if (url.pathname === '/image') {
      const fixture = currentFixture();
      const abs = fixture ? resolveImage(fixture) : null;
      if (!abs) {
        res.writeHead(404);
        res.end('missing image');
        return;
      }
      const buf = await readFile(abs);
      const ext = extname(abs).toLowerCase();
      const ct =
        ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      res.writeHead(200, { 'content-type': ct });
      res.end(buf);
      return;
    }
    if (url.pathname === '/nav' && req.method === 'POST') {
      const body = await readBody(req);
      if (!orderIds.length) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
        return;
      }
      if (body.to === 'unannotated') {
        const start = index;
        for (let step = 1; step <= orderIds.length; step++) {
          const i = (start + step) % orderIds.length;
          if (!fixtureArtReviewed(byId().get(orderIds[i]))) {
            index = i;
            break;
          }
        }
      } else {
        index = (index + (body.dir || 1) + orderIds.length) % orderIds.length;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
      return;
    }
    if (url.pathname === '/normalize-region' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const quad = orderRegionQuadInCardSpace({
          regionQuadSource: body.regionQuad,
          cardQuadSource: body.cardQuad,
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ quad }));
      } catch (err) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: err.message || 'region quad is not convex' }));
      }
      return;
    }
    if (url.pathname === '/save' && req.method === 'POST') {
      const body = await readBody(req);
      const fixture = currentFixture();
      if (!fixture) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'no fixture' }));
        return;
      }
      let orientedCards = body.cards ?? [];
      if (!body.negative) {
        try {
          orientedCards = orientedCards.map(card => orientCardRegions(card));
        } catch (err) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: err.message || 'region quad is not convex' }));
          return;
        }
        for (const c of orientedCards) {
          if (!isCompleteQuad(c.groundTruthQuad)) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: `incomplete quad on ${c.id}` }));
            return;
          }
        }
      }
      const next = {
        ...fixture,
        trusted: Boolean(body.trusted),
        hardRegression: Boolean(body.hardRegression),
        negative: Boolean(body.negative),
        notes: body.notes ?? '',
        tags: body.tags ?? fixture.tags,
        cards: body.negative
          ? []
          : orientedCards.map(c =>
              createCard({
                ...c,
                groundTruthSource: body.trusted
                  ? c.groundTruthSource === 'existing-recognition-quad' ||
                    c.groundTruthSource === 'per-snapshot-quad'
                    ? 'manually-reviewed'
                    : c.groundTruthSource || 'manually-reviewed'
                  : c.groundTruthSource || 'manually-reviewed',
              }),
            ),
        updatedAt: new Date().toISOString(),
      };
      if (next.trusted && !next.negative) {
        next.cards = next.cards.map(c => ({
          ...c,
          groundTruthSource: 'manually-reviewed',
        }));
      }
      if (mode === 'stills-v1' && !next.negative) {
        const issues = [];
        for (const card of next.cards) {
          const art = card.regions?.artBox;
          const human = art && (art.source === 'auto-accepted' || art.source === 'auto-edited' || art.source === 'manual');
          if (!human) {
            if (art) art.reviewed = false;
            issues.push('Accept, edit, or draw the art box. An automatic proposal is not ground truth.');
            continue;
          }
          const quality = artBoxIssues(art.quad, card.groundTruthQuad);
          if (quality.length) {
            art.reviewed = false;
            issues.push(...quality);
          } else {
            art.reviewed = true;
          }
        }
        if (issues.length) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: issues[0], issues }));
          return;
        }
      }
      await saveFixture(next);
      const idxInAll = allFixtures.findIndex(f => f.id === next.id);
      if (idxInAll >= 0) allFixtures[idxInAll] = next;
      await writeManifest(allFixtures);

      if (body.advance) {
        await refreshOrder();
        // Stay on same index (next untrusted slid into place) or advance if still present.
        if (mode === 'priority' && next.trusted) {
          // current id dropped from order; index already points at next item
          if (index >= orderIds.length) index = Math.max(0, orderIds.length - 1);
        } else if (orderIds.length) {
          index = (index + 1) % orderIds.length;
        }
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, total: orderIds.length, index }));
      return;
    }
    if (url.pathname === '/art-preview' && req.method === 'POST') {
      const body = await readBody(req);
      const fixture = currentFixture();
      const abs = fixture ? resolveImage(fixture) : null;
      if (!abs || !isCompleteQuad(body.quad)) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'need a four-point art box' }));
        return;
      }
      const card = (fixture.cards ?? []).find(row => isCompleteQuad(row.groundTruthQuad));
      let quad = body.quad;
      if (card) {
        try {
          quad = orderRegionQuadInCardSpace({ regionQuadSource: body.quad, cardQuadSource: card.groundTruthQuad });
        } catch (err) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: err.message || 'region quad is not convex' }));
          return;
        }
      }
      const { scan } = await loadDetectScan();
      const image = await decodeImageFile(abs);
      const warped = scan.warpQuadToCard(image, scan.cornersToQuad(gtQuadToCorners(quad)), 320, 224);
      const png = new PNG({ width: warped.width, height: warped.height });
      png.data = Buffer.from(warped.data);
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
      res.end(PNG.sync.write(png));
      return;
    }
    if (url.pathname === '/frame-detect' && req.method === 'POST') {
      const body = await readBody(req);
      const fixture = currentFixture();
      const abs = fixture ? resolveImage(fixture) : null;
      if (!abs) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'missing image' }));
        return;
      }
      if (body.only && body.only !== 'card' && !FRAME_REGION_KEYS.includes(body.only)) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'unknown region' }));
        return;
      }
      const image = await decodeImageFile(abs);
      const { scan } = await loadDetectScan();
      if (body.only === 'card') {
        const proposed = cornersToGtQuad(scan.detectCardQuad(image)?.corners);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          cardQuad: isCompleteQuad(proposed) ? proposed : null,
          regions: body.regions || {},
          applied: isCompleteQuad(proposed) ? ['card'] : [],
        }));
        return;
      }
      let quad = body.quad;
      let cardQuad = null;
      if (!isCompleteQuad(quad)) {
        const proposed = cornersToGtQuad(scan.detectCardQuad(image)?.corners);
        if (!isCompleteQuad(proposed)) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'annotate the card quad first' }));
          return;
        }
        quad = proposed;
        cardQuad = proposed;
      }
      const warped = scan.warpQuadToCard(
        image,
        scan.cornersToQuad(gtQuadToCorners(quad)),
        CARD_WIDTH,
        CARD_HEIGHT,
      );
      const found = detectFrameRegions(warped);
      const projected = projectCanonicalRegions(found.regions, quad, warped.width, warped.height);
      const merged = applyAutoProposals(body.regions || {}, projected, {
        force: Boolean(body.force),
        only: body.only || null,
      });
      const undetected = FRAME_REGION_KEYS.filter(key => {
        if (body.only && key !== body.only) return false;
        return !projected[key];
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          cardQuad,
          regions: merged.regions,
          applied: merged.applied,
          skipped: merged.skipped,
          cleared: merged.cleared,
          undetected,
          debug: found.debug,
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
});

server.listen(port, '127.0.0.1', async () => {
  console.log(`Geometry Lab: http://127.0.0.1:${port} (${orderIds.length} fixtures)`);
  console.log(`Art box queue: http://127.0.0.1:${port}/?queue=stills-v1`);
  console.log(`Art box, confirmed-corner frames: http://127.0.0.1:${port}/?frames=confirmed`);
  console.log(`Priority queue: http://127.0.0.1:${port}/?queue=priority`);
  console.log(`Synthetic + candidates: http://127.0.0.1:${port}/?synthetic=sleeve`);
  console.log('Drag corners · Frame regions · Auto detect frame · Save+Next.');
});
