#!/usr/bin/env node
/**
 * yarn geometry:lab — local Geometry Lab annotation UI (no phone).
 *
 * http://127.0.0.1:8766
 * http://127.0.0.1:8766/?queue=priority   ← follow yarn geometry:queue order
 * http://127.0.0.1:8766/?synthetic=sleeve ← synthetic suite + Candidate Inspector
 */

import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { analyzeFixture } from './lib/candidates-analyze.mjs';
import { listFixtures, saveFixture, writeManifest } from './lib/corpus.mjs';
import { loadDetectScan } from './lib/detect-host.mjs';
import { runNativeDetectorBatch } from './lib/detect-native.mjs';
import { CORPUS_ROOT, rootDir } from './lib/paths.mjs';
import { loadPriorityQueue } from './lib/queue.mjs';
import { ALLOWED_TAGS, createCard, isCompleteQuad } from './lib/schema.mjs';
import { loadSyntheticFixtures } from './lib/synthetic/generate.mjs';

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

/** @type {'all' | 'priority' | 'synthetic'} */
let mode = 'all';
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
  if (mode === 'priority') {
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
  body { margin:0; font:13px/1.4 ui-sans-serif, system-ui, sans-serif; background:var(--bg); color:var(--text); height:100vh; display:grid; grid-template-columns: 1fr 300px; }
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
</style>
<header>
  <strong>Geometry Lab</strong>
  <span id="modeBadge" hidden>priority queue</span>
  <button id="prev">← Prev</button>
  <button id="next">Next →</button>
  <span id="pos" class="muted"></span>
  <button id="fit">Fit</button>
  <button id="zoomIn">Zoom +</button>
  <button id="zoomOut">Zoom −</button>
  <button id="undo">Undo</button>
  <button id="reset">Reset</button>
  <button id="save">Save</button>
  <button id="saveNext">Save + Next</button>
  <span id="status"></span>
  <span id="err"></span>
</header>
<div id="stageWrap"><div id="stage"><canvas id="c"></canvas></div></div>
<aside>
  <h1 id="title">—</h1>
  <div class="muted" id="meta"></div>
  <div id="priorityWhy"></div>
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
  <div class="muted">Drag TL / TR / BR / BL handles. Multi-card: Add Card.</div>
  <h1>Tags</h1>
  <div class="tags" id="tags"></div>
  <h1>Notes</h1>
  <input type="text" id="notes" placeholder="optional notes"/>
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
</aside>
<script>
const TAGS = ${JSON.stringify(ALLOWED_TAGS)};
const params = new URLSearchParams(location.search);
const wantPriority = params.get('queue') === 'priority';
const wantSynthetic = params.get('synthetic');
let fixture = null;
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
  candAnalysis = null;
  candFocus = null;
  document.getElementById('candDetail').textContent = '';
  document.getElementById('candList').innerHTML = '';
  const modeLabel = data.mode === 'priority' ? 'priority' : data.mode === 'synthetic' ? ('synthetic:'+(data.suite||'')) : 'all';
  document.getElementById('pos').textContent = (data.index+1)+'/'+data.total+' · '+modeLabel;
  document.getElementById('title').textContent = fixture.id;
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
  img.onload = () => {
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
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
    fit();
    redraw();
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
}

function fit(){
  const wrap = document.getElementById('stageWrap');
  const sx = wrap.clientWidth / Math.max(1, canvas.width);
  const sy = wrap.clientHeight / Math.max(1, canvas.height);
  scale = Math.min(sx, sy) * 0.98;
  canvas.style.width = (canvas.width * scale) + 'px';
  canvas.style.height = (canvas.height * scale) + 'px';
}

function redraw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(img,0,0);
  cards.forEach((card, ci) => {
    const q = card.groundTruthQuad;
    if (!q) return;
    const pts = keys.map(k => ({x:q[k][0], y:q[k][1]}));
    ctx.strokeStyle = ci === cardIndex ? '#f5a524' : '#6cb2ff';
    ctx.fillStyle = ci === cardIndex ? 'rgba(245,165,36,0.18)' : 'rgba(108,178,255,0.12)';
    ctx.lineWidth = Math.max(2, 2/scale);
    ctx.beginPath();
    pts.forEach((p,i)=> i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
    ctx.closePath(); ctx.fill(); ctx.stroke();
    if (card.sleeveQuad) {
      const sq = card.sleeveQuad;
      const spts = keys.map(k => ({x:sq[k][0], y:sq[k][1]}));
      ctx.strokeStyle = '#c084fc';
      ctx.setLineDash([8,6]);
      ctx.beginPath();
      spts.forEach((p,i)=> i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
      ctx.closePath(); ctx.stroke();
      ctx.setLineDash([]);
    }
    pts.forEach((p,i)=>{
      ctx.beginPath();
      ctx.arc(p.x,p.y, Math.max(6, 8/scale), 0, 7);
      ctx.fillStyle = ci === cardIndex ? '#f5a524' : '#6cb2ff';
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = Math.max(12, 14/scale)+'px sans-serif';
      ctx.fillText(labels[i], p.x+10, p.y-10);
    });
  });
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

canvas.onpointerdown = e => {
  const c = active();
  if (!c?.groundTruthQuad) return;
  const p = canvasPos(e);
  const hitR = Math.max(12, 14/scale);
  for (let i=0;i<4;i++){
    const q = c.groundTruthQuad[keys[i]];
    if (Math.hypot(p.x-q[0], p.y-q[1]) <= hitR){
      pushHistory();
      drag = { corner: keys[i] };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
  }
};
canvas.onpointermove = e => {
  if (!drag) return;
  const c = active();
  const p = canvasPos(e);
  c.groundTruthQuad[drag.corner] = [p.x, p.y];
  redraw();
};
canvas.onpointerup = () => { drag = null; };

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
    visibility:'full', occluded:false, tags:[], groundTruthSource:'manually-reviewed'
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
  if (!res.ok) { document.getElementById('err').textContent = j.error || 'save failed'; return; }
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
      } else {
        mode = body.mode === 'priority' ? 'priority' : 'all';
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
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          index,
          total: orderIds.length,
          mode,
          suite: syntheticSuite,
          fixture,
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
      index = (index + (body.dir || 1) + orderIds.length) % orderIds.length;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
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
      if (!body.negative) {
        for (const c of body.cards ?? []) {
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
          : (body.cards ?? []).map(c =>
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
    res.writeHead(404);
    res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
});

server.listen(port, '127.0.0.1', async () => {
  console.log(`Geometry Lab: http://127.0.0.1:${port} (${orderIds.length} fixtures)`);
  console.log(`Priority queue: http://127.0.0.1:${port}/?queue=priority`);
  console.log(`Synthetic + candidates: http://127.0.0.1:${port}/?synthetic=sleeve`);
  console.log('Drag corners · Add Card · Save+Next · Candidate Inspector.');
});
