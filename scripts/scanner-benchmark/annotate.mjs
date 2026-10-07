#!/usr/bin/env node
/** yarn scanner:annotate — local corner and identity tool. No remote service. */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadAnnotations, saveAnnotationBundle } from './lib/annotations.mjs';
import { validateCardQuad } from './lib/metrics.mjs';
import { manifestsDir, resolveSafeMedia, rootDir } from './lib/paths.mjs';
import { resolveExpected } from '../recognition/scoring.mjs';

const port = Number(process.env.SCANNER_ANNOTATE_PORT || 8791);
const confirmedOnly = process.argv.includes('--confirmed-only');
const htmlPath = join(fileURLToPath(new URL('.', import.meta.url)), 'annotate.html');

let names = null;
const loadNames = async () => {
  if (names) return names;
  const data = JSON.parse(await readFile(join(rootDir, '.scan-fixtures/card-names.json'), 'utf8'));
  names = data.names ?? [];
  return names;
};

const readStills = async () => {
  const raw = await readFile(join(manifestsDir, 'stills-v1.json'), 'utf8');
  return JSON.parse(raw);
};

const send = (res, code, body, type) => {
  res.writeHead(code, { 'content-type': type });
  res.end(body);
};

const sendJson = (res, code, value) => {
  send(res, code, JSON.stringify(value), 'application/json');
};

/** Confirmed identities that still need corners come first. */
const orderQueue = (items, identities, corners) => {
  const confirmed = new Set(
    (identities ?? []).filter(row => row.status === 'CONFIRMED' && row.cardName).map(row => row.imageId),
  );
  const done = new Set(
    (corners ?? []).filter(row => row.status === 'CONFIRMED' && row.corners?.topLeft).map(row => row.imageId),
  );
  const rank = item => {
    const labeled = confirmed.has(item.imageId);
    const hasCorners = done.has(item.imageId);
    if (labeled && !hasCorners) return 0;
    if (labeled) return 1;
    if (!hasCorners) return 2;
    return 3;
  };
  return [...items]
    .filter(item => !confirmedOnly || confirmed.has(item.imageId))
    .sort((a, b) => rank(a) - rank(b) || a.imageId.localeCompare(b.imageId));
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (req.method === 'GET' && url.pathname === '/') {
      send(res, 200, await readFile(htmlPath), 'text/html; charset=utf-8');
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/queue') {
      const stills = await readStills();
      const ann = await loadAnnotations();
      sendJson(res, 200, {
        items: orderQueue(stills.items, ann.identities, ann.corners),
        identities: ann.identities,
        corners: ann.corners,
        tags: ann.tags,
        confirmedOnly,
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/cards') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const all = await loadNames();
      const hits = q ? all.filter(n => n.toLowerCase().includes(q)).slice(0, 20) : [];
      send(res, 200, JSON.stringify(hits), 'application/json');
      return;
    }
    if (req.method === 'GET' && url.pathname === '/media') {
      const abs = resolveSafeMedia(url.searchParams.get('path'));
      send(res, 200, await readFile(abs), 'image/png');
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/save') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const ann = await loadAnnotations();
      const id = body.imageId;
      if (!id) throw new Error('imageId required');
      let identities = ann.identities;
      if (body.identity) {
        identities = ann.identities.filter(row => row.imageId !== id);
        const status = body.identity.status;
        if (status === 'UNKNOWN') {
          identities.push({ imageId: id, status: 'UNKNOWN', source: 'MANUAL' });
        } else if (body.identity.cardName) {
          const resolved = resolveExpected(rootDir, body.identity.cardName);
          identities.push({
            imageId: id,
            cardName: resolved.resolvedName || body.identity.cardName,
            oracleId: resolved.oracleId,
            status: status === 'PROBABLE' ? 'PROBABLE' : 'CONFIRMED',
            source: 'MANUAL',
            notes: body.identity.notes ?? null,
          });
        }
      }
      let corners = ann.corners;
      if (body.corners) {
        const status = body.corners.status || 'CONFIRMED';
        if (status === 'CONFIRMED' && body.corners.corners) {
          const stills = await readStills();
          const item = stills.items.find(row => row.imageId === id);
          const review = validateCardQuad(body.corners.corners, item?.width ?? 10000, item?.height ?? 10000);
          if (!review.ok) {
            sendJson(res, 400, { ok: false, errors: review.errors, warnings: review.warnings });
            return;
          }
          if (review.warnings.length && !body.force) {
            sendJson(res, 409, { ok: false, errors: [], warnings: review.warnings, aspect: review.aspect });
            return;
          }
        }
        corners = ann.corners.filter(row => row.imageId !== id);
        corners.push({
          imageId: id,
          ...body.corners,
          status,
          source: 'MANUAL',
        });
      }
      let tags = ann.tags;
      if (body.tags) {
        tags = ann.tags.filter(row => !(row.imageId === id && row.source === 'MANUAL'));
        tags.push({ imageId: id, tags: body.tags, source: 'MANUAL' });
      }
      identities.sort((a, b) => a.imageId.localeCompare(b.imageId));
      corners.sort((a, b) => a.imageId.localeCompare(b.imageId));
      await saveAnnotationBundle({ identities, corners, tags, videos: ann.videos });
      send(res, 200, JSON.stringify({ ok: true }), 'application/json');
      return;
    }
    send(res, 404, 'not found', 'text/plain');
  } catch (err) {
    send(res, 400, err instanceof Error ? err.message : String(err), 'text/plain');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Annotation tool http://127.0.0.1:${port}`);
  console.log(
    confirmedOnly
      ? 'Queue: confirmed identity only, missing corners first.'
      : 'Queue: confirmed identity with missing corners first, then the other frames.',
  );
  console.log('Mark the physical card outer corners. Inside a sleeve, estimate the card edge, not the sleeve.');
  console.log('Keys: 1-4 place corners, Enter save+next, U unknown, R reset, G glare, B blur, S sleeve');
});
