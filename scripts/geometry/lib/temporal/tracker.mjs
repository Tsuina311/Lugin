/**
 * Host-only multi-card geometric tracker for binder temporal experiments.
 * Does NOT use GT for association. GT is evaluation-only.
 */

const centerOf = corners => {
  const pts = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / 4,
    y: pts.reduce((s, p) => s + p.y, 0) / 4,
  };
};

const areaOf = corners => {
  const p = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    a += p[i].x * p[j].y - p[j].x * p[i].y;
  }
  return Math.abs(a) / 2;
};

const aspectOf = corners => {
  const w =
    (Math.hypot(corners.topRight.x - corners.topLeft.x, corners.topRight.y - corners.topLeft.y) +
      Math.hypot(
        corners.bottomRight.x - corners.bottomLeft.x,
        corners.bottomRight.y - corners.bottomLeft.y,
      )) /
    2;
  const h =
    (Math.hypot(corners.bottomLeft.x - corners.topLeft.x, corners.bottomLeft.y - corners.topLeft.y) +
      Math.hypot(
        corners.bottomRight.x - corners.topRight.x,
        corners.bottomRight.y - corners.topRight.y,
      )) /
    2;
  return w / Math.max(h, 1e-6);
};

/**
 * @param {object} opts
 * @param {(a,b)=>number} opts.polygonIoU
 */
export const createMultiCardTracker = ({
  polygonIoU,
  matchIou = 0.25,
  maxCenterDist = 90,
  confirmHits = 2,
  missGrace = 3,
  lostAfter = 6,
  minScore = 0.28,
} = {}) => {
  let nextId = 1;
  /** @type {Array<object>} */
  const tracks = [];
  const events = [];

  const assocCost = (track, cand) => {
    const iou = polygonIoU(track.predCorners, cand.corners);
    const cT = track.center;
    const cC = centerOf(cand.corners);
    const dist = Math.hypot(cT.x - cC.x, cT.y - cC.y);
    const scaleRatio =
      Math.min(track.area, areaOf(cand.corners)) / Math.max(track.area, areaOf(cand.corners), 1);
    if (iou < 0.05 && dist > maxCenterDist) return Infinity;
    // Lower is better
    return (1 - iou) * 2 + dist / maxCenterDist + (1 - scaleRatio) * 0.5;
  };

  const step = (frameIndex, candidates) => {
    const cands = (candidates || [])
      .map(c => ({
        corners: c.quad || c.corners,
        score: c.finalScore ?? c.score ?? 0,
        method: c.method,
        areaShare: c.areaShare,
      }))
      .filter(c => c.corners && c.score >= minScore);

    const active = tracks.filter(t => t.state !== 'lost');
    const costs = [];
    for (let ti = 0; ti < active.length; ti++) {
      for (let ci = 0; ci < cands.length; ci++) {
        const cost = assocCost(active[ti], cands[ci]);
        if (Number.isFinite(cost)) costs.push({ ti, ci, cost, iou: polygonIoU(active[ti].predCorners, cands[ci].corners) });
      }
    }
    costs.sort((a, b) => a.cost - b.cost);
    const usedT = new Set();
    const usedC = new Set();
    const matches = [];
    for (const m of costs) {
      if (usedT.has(m.ti) || usedC.has(m.ci)) continue;
      if (m.iou < matchIou && m.cost > 1.4) continue;
      usedT.add(m.ti);
      usedC.add(m.ci);
      matches.push(m);
    }

    for (const m of matches) {
      const track = active[m.ti];
      const cand = cands[m.ci];
      track.hits += 1;
      track.misses = 0;
      track.lastFrame = frameIndex;
      track.predCorners = cand.corners;
      track.center = centerOf(cand.corners);
      track.area = areaOf(cand.corners);
      track.aspect = aspectOf(cand.corners);
      track.observations.push({
        frameIndex,
        corners: cand.corners,
        score: cand.score,
        method: cand.method,
      });
      if (!track.best || cand.score > track.best.score) {
        track.best = {
          frameIndex,
          corners: cand.corners,
          score: cand.score,
          method: cand.method,
        };
      }
      if (track.state === 'candidate' && track.hits >= confirmHits) {
        track.state = 'confirmed';
        events.push({ type: 'confirm', trackId: track.id, frameIndex });
      } else if (track.state === 'temporarily-missed') {
        track.state = track.hits >= confirmHits ? 'confirmed' : 'candidate';
        events.push({ type: 'recover', trackId: track.id, frameIndex });
      }
    }

    for (let ti = 0; ti < active.length; ti++) {
      if (usedT.has(ti)) continue;
      const track = active[ti];
      track.misses += 1;
      if (track.misses >= lostAfter) {
        track.state = 'lost';
        events.push({ type: 'lost', trackId: track.id, frameIndex });
      } else if (track.misses >= 1) {
        if (track.state === 'confirmed' || track.state === 'candidate') {
          track.state = 'temporarily-missed';
          events.push({ type: 'miss', trackId: track.id, frameIndex });
        }
      }
    }

    for (let ci = 0; ci < cands.length; ci++) {
      if (usedC.has(ci)) continue;
      const cand = cands[ci];
      // Suppress near-duplicate of existing track center
      const near = tracks.some(t => {
        if (t.state === 'lost') return false;
        const d = Math.hypot(t.center.x - centerOf(cand.corners).x, t.center.y - centerOf(cand.corners).y);
        return d < 40 && polygonIoU(t.predCorners, cand.corners) > 0.35;
      });
      if (near) continue;
      const id = nextId++;
      const track = {
        id,
        state: 'candidate',
        hits: 1,
        misses: 0,
        bornFrame: frameIndex,
        lastFrame: frameIndex,
        predCorners: cand.corners,
        center: centerOf(cand.corners),
        area: areaOf(cand.corners),
        aspect: aspectOf(cand.corners),
        observations: [{ frameIndex, corners: cand.corners, score: cand.score, method: cand.method }],
        best: { frameIndex, corners: cand.corners, score: cand.score, method: cand.method },
      };
      tracks.push(track);
      events.push({ type: 'birth', trackId: id, frameIndex });
    }

    return {
      frameIndex,
      trackCount: tracks.filter(t => t.state !== 'lost').length,
      confirmed: tracks.filter(t => t.state === 'confirmed').length,
      matches: matches.length,
      births: cands.length - usedC.size,
    };
  };

  return {
    step,
    getTracks: () => tracks,
    getEvents: () => events,
  };
};
