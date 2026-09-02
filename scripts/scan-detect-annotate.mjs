#!/usr/bin/env node
// Annotate real detection corners.
//
//   yarn scan:detect-annotate path/to/photo.png
//   yarn scan:detect-annotate --queue
//
// --queue walks .scan-corpus/download/** (from scan:corpus:import) and promotes
// accepted/adjusted corners into .scan-real/. Detector suggestion from meta
// is shown when present so you can Accept instead of re-clicking.

import { createServer } from 'node:http';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const REAL = join(root, '.scan-real');
const DOWNLOAD = join(root, '.scan-corpus/download');
const queueMode = process.argv.includes('--queue');

await mkdir(REAL, { recursive: true });

const collectQueue = async () => {
  if (!existsSync(DOWNLOAD)) return [];
  const out = [];
  const walk = async dir => {
    for (const name of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, name.name);
      if (name.isDirectory()) await walk(p);
      else if (name.name === 'meta.json') {
        const meta = JSON.parse(await readFile(p, 'utf8'));
        const dirn = dirname(p);
        const jpg = join(dirn, 'image.jpg');
        const webp = join(dirn, 'image.webp');
        const img = existsSync(jpg) ? jpg : existsSync(webp) ? webp : null;
        if (img) out.push({ img, meta, metaPath: p });
      }
    }
  };
  await walk(DOWNLOAD);
  return out;
};

let items = [];
if (queueMode) {
  items = await collectQueue();
  if (!items.length) {
    console.error('No downloaded samples. Run yarn scan:corpus:import <path> first.');
    process.exit(1);
  }
} else {
  const src = process.argv[2];
  if (!src || !existsSync(src)) {
    console.error('Usage: yarn scan:detect-annotate path/to/photo.png');
    console.error('   or: yarn scan:detect-annotate --queue');
    process.exit(1);
  }
  const name = basename(src).replace(/\s+/g, '-');
  const dest = join(REAL, name.endsWith('.png') || name.endsWith('.jpg') ? name : `${name}.jpg`);
  if (resolve(src) !== resolve(dest)) await copyFile(src, dest);
  items = [{ img: dest, meta: { sampleId: name }, metaPath: null }];
}

let index = 0;

const page = () => `<!doctype html>
<meta charset="utf-8"/>
<title>Annotate card corners</title>
<style>
  body{font:14px system-ui;margin:0;background:#111;color:#eee;display:flex;flex-direction:column;height:100vh}
  header{padding:10px 14px;background:#1a1a1a;border-bottom:1px solid #333}
  main{flex:1;overflow:auto;display:grid;place-items:center;padding:12px}
  canvas{max-width:100%;max-height:75vh;cursor:crosshair;background:#000}
  button{margin:4px 6px 4px 0;padding:6px 12px}
</style>
<header>
  <div id="info"></div>
  <strong>Click TL → TR → BR → BL</strong> (or Accept suggested polygon)
  <div style="margin-top:8px">
    <button id="accept">Accept suggested</button>
    <button id="undo">Undo</button>
    <button id="clear">Clear</button>
    <button id="save">Save to .scan-real</button>
    <button id="nocard">Mark no card</button>
    <button id="skip">Skip</button>
    <span id="status"></span>
  </div>
</header>
<main><canvas id="c"></canvas></main>
<script>
let item = null;
let pts = [];
let suggested = null;
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const labels = ['TL','TR','BR','BL'];
const img = new Image();

async function load(){
  const res = await fetch('/item');
  if(!res.ok){ document.getElementById('info').textContent = 'Queue empty'; return; }
  item = await res.json();
  document.getElementById('info').textContent =
    (item.index+1)+'/'+item.total+' · '+(item.meta.eventType||'')+' · '+(item.meta.sampleId||'');
  suggested = item.meta.detector?.selectedQuad || item.meta.detectedCards?.[0] || null;
  pts = suggested ? [
    suggested.topLeft, suggested.topRight, suggested.bottomRight, suggested.bottomLeft
  ].map(p => ({x:p.x,y:p.y})) : [];
  img.onload = () => { canvas.width = img.naturalWidth; canvas.height = img.naturalHeight; redraw(); };
  img.src = '/image?'+Date.now();
}
function redraw(){
  ctx.drawImage(img,0,0);
  if(suggested && pts.length===0){
    const s = [suggested.topLeft, suggested.topRight, suggested.bottomRight, suggested.bottomLeft];
    ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2; ctx.setLineDash([6,4]);
    ctx.beginPath(); s.forEach((p,i)=> i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
    ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
  }
  if(pts.length){
    ctx.strokeStyle = '#fbbf24'; ctx.fillStyle='rgba(251,191,36,0.15)'; ctx.lineWidth=2;
    ctx.beginPath(); pts.forEach((p,i)=> i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
    if(pts.length===4){ ctx.closePath(); ctx.fill(); }
    ctx.stroke();
    ctx.fillStyle='#fbbf24';
    pts.forEach((p,i)=>{ ctx.beginPath(); ctx.arc(p.x,p.y,5,0,7); ctx.fill(); ctx.fillText(labels[i],p.x+8,p.y-8); });
  }
  document.getElementById('status').textContent = pts.length+'/4';
}
canvas.onclick = e => {
  if(pts.length>=4) return;
  const r = canvas.getBoundingClientRect();
  pts.push({ x:(e.clientX-r.left)*(canvas.width/r.width), y:(e.clientY-r.top)*(canvas.height/r.height) });
  redraw();
};
document.getElementById('accept').onclick = () => {
  if(!suggested){ alert('No suggested corners'); return; }
  pts = [suggested.topLeft, suggested.topRight, suggested.bottomRight, suggested.bottomLeft]
    .map(p => ({x:p.x,y:p.y}));
  redraw();
};
document.getElementById('undo').onclick = () => { pts.pop(); redraw(); };
document.getElementById('clear').onclick = () => { pts=[]; redraw(); };
document.getElementById('save').onclick = async () => {
  if(pts.length!==4){ alert('Need 4 corners'); return; }
  await fetch('/save', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({
    corners: { topLeft:pts[0], topRight:pts[1], bottomRight:pts[2], bottomLeft:pts[3] },
    tag: item.meta.eventType || 'corpus',
    sampleId: item.meta.sampleId,
  })});
  await fetch('/next', { method:'POST' });
  load();
};
document.getElementById('nocard').onclick = async () => {
  await fetch('/save', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({
    negative: true, tag: 'negative', sampleId: item.meta.sampleId,
  })});
  await fetch('/next', { method:'POST' });
  load();
};
document.getElementById('skip').onclick = async () => {
  await fetch('/next', { method:'POST' });
  load();
};
load();
</script>`;

const server = createServer(async (req, res) => {
  if (req.url === '/' || req.url?.startsWith('/?')) {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(page());
    return;
  }
  if (req.url === '/item') {
    if (index >= items.length) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ index, meta: items[index].meta, total: items.length }));
    return;
  }
  if (req.url?.startsWith('/image')) {
    if (index >= items.length) {
      res.writeHead(404);
      res.end();
      return;
    }
    const buf = await readFile(items[index].img);
    const ct = items[index].img.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    res.writeHead(200, { 'content-type': ct });
    res.end(buf);
    return;
  }
  if (req.url === '/next' && req.method === 'POST') {
    index += 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
    return;
  }
  if (req.url === '/save' && req.method === 'POST') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const id = (body.sampleId || `shot-${Date.now()}`).replace(/[^\w.-]+/g, '_');
    const imgSrc = items[index]?.img;
    const destImg = join(REAL, `${id}.jpg`);
    if (imgSrc && existsSync(imgSrc)) await copyFile(imgSrc, destImg);
    const sidecar = {
      imageFile: `${id}.jpg`,
      tag: body.tag || 'corpus',
      ...(body.negative
        ? { negative: true }
        : { corners: body.corners }),
    };
    await writeFile(join(REAL, `${id}.json`), `${JSON.stringify(sidecar, null, 2)}\n`);
    console.log(`wrote .scan-real/${id}.json`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(8765, '127.0.0.1', () => {
  console.log(`Annotate: http://127.0.0.1:8765 (${items.length} item(s)${queueMode ? ', queue' : ''})`);
});
