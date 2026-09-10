/**
 * Generic binder/page grid inference from card quads (geometry only).
 * Supports arbitrary rows×cols; experiment defaults to 3×3.
 */

const centerOf = corners => {
  const pts = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / 4,
    y: pts.reduce((s, p) => s + p.y, 0) / 4,
  };
};

const meanPt = pts => ({
  x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
  y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
});

const cornersToArr = c => [
  [c.topLeft.x, c.topLeft.y],
  [c.topRight.x, c.topRight.y],
  [c.bottomRight.x, c.bottomRight.y],
  [c.bottomLeft.x, c.bottomLeft.y],
];

const arrToCorners = q => ({
  topLeft: { x: q[0][0], y: q[0][1] },
  topRight: { x: q[1][0], y: q[1][1] },
  bottomRight: { x: q[2][0], y: q[2][1] },
  bottomLeft: { x: q[3][0], y: q[3][1] },
});

const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const scale = (a, s) => [a[0] * s, a[1] * s];

/**
 * Infer rows×cols grid from track/candidate quads.
 * @returns {{ rows, cols, cells, confidence, rowVec, colVec, origin, missing }}
 */
export const inferBinderGrid = (
  quads,
  { rows = 3, cols = 3, minOccupied = 4 } = {},
) => {
  const items = (quads || [])
    .map((corners, i) => ({ i, corners, center: centerOf(corners) }))
    .filter(x => x.corners);

  if (items.length < minOccupied) {
    return {
      rows,
      cols,
      cells: Array.from({ length: rows }, () => Array(cols).fill(null)),
      assignments: [],
      missing: [],
      confidence: 0,
      reason: 'insufficient-tracks',
    };
  }

  // Pairwise vectors → two dominant axes by angle clustering
  const vecs = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const dx = items[j].center.x - items[i].center.x;
      const dy = items[j].center.y - items[i].center.y;
      const len = Math.hypot(dx, dy);
      if (len < 20) continue;
      vecs.push({ dx, dy, len, ang: Math.atan2(dy, dx) });
    }
  }
  if (!vecs.length) {
    return {
      rows,
      cols,
      cells: Array.from({ length: rows }, () => Array(cols).fill(null)),
      assignments: [],
      missing: [],
      confidence: 0,
      reason: 'no-vectors',
    };
  }

  // Normalize angle to [0, π) — undirected
  const undirected = vecs.map(v => {
    let a = v.ang;
    if (a < 0) a += Math.PI;
    if (a >= Math.PI) a -= Math.PI;
    return { ...v, ang: a };
  });

  // Seed axes: median of short-ish neighbors near horizontal / near vertical
  const horiz = undirected.filter(v => v.ang < Math.PI / 4 || v.ang > (3 * Math.PI) / 4);
  const vert = undirected.filter(v => v.ang >= Math.PI / 4 && v.ang <= (3 * Math.PI) / 4);
  const medianLen = arr => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  // Prefer spacing ≈ typical card pitch (nearest neighbor band)
  const nnLens = items.map(it => {
    let best = Infinity;
    for (const o of items) {
      if (o === it) continue;
      best = Math.min(best, Math.hypot(o.center.x - it.center.x, o.center.y - it.center.y));
    }
    return best;
  });
  const pitch = medianLen(nnLens) || 120;

  const axisFrom = (pool, fallbackAng) => {
    const band = pool.filter(v => Math.abs(v.len - pitch) < pitch * 0.55);
    const use = band.length ? band : pool;
    if (!use.length) {
      return { dx: Math.cos(fallbackAng) * pitch, dy: Math.sin(fallbackAng) * pitch };
    }
    const medDx = medianLen(use.map(v => v.dx));
    const medDy = medianLen(use.map(v => v.dy));
    // Orient consistently
    let dx = medDx;
    let dy = medDy;
    if (Math.abs(dx) + Math.abs(dy) < 1) {
      dx = Math.cos(fallbackAng) * pitch;
      dy = Math.sin(fallbackAng) * pitch;
    }
    // Flip so col axis mostly +x, row mostly +y
    return { dx, dy };
  };

  let colA = axisFrom(horiz.length ? horiz : undirected, 0);
  let rowA = axisFrom(vert.length ? vert : undirected, Math.PI / 2);
  // Ensure row points roughly downward, col rightward
  if (colA.dx < 0) {
    colA = { dx: -colA.dx, dy: -colA.dy };
  }
  if (rowA.dy < 0) {
    rowA = { dx: -rowA.dx, dy: -rowA.dy };
  }

  const det = colA.dx * rowA.dy - colA.dy * rowA.dx;
  if (Math.abs(det) < 1e-3) {
    return {
      rows,
      cols,
      cells: Array.from({ length: rows }, () => Array(cols).fill(null)),
      assignments: [],
      missing: [],
      confidence: 0,
      reason: 'degenerate-axes',
    };
  }

  // Project centers into (u,v) grid coords relative to mean
  const meanC = meanPt(items.map(i => i.center));
  const toUV = c => {
    const dx = c.x - meanC.x;
    const dy = c.y - meanC.y;
    // solve [col row] [u;v] = [dx;dy]
    const u = (dx * rowA.dy - dy * rowA.dx) / det;
    const v = (colA.dx * dy - colA.dy * dx) / det;
    return { u, v };
  };

  const uvs = items.map(it => ({ ...it, ...toUV(it.center) }));
  const uMin = Math.min(...uvs.map(x => x.u));
  const vMin = Math.min(...uvs.map(x => x.v));

  const assignments = [];
  const cells = Array.from({ length: rows }, () => Array(cols).fill(null));
  const used = new Set();

  for (const it of uvs) {
    let col = Math.round(it.u - uMin);
    let row = Math.round(it.v - vMin);
    col = Math.max(0, Math.min(cols - 1, col));
    row = Math.max(0, Math.min(rows - 1, row));
    const key = `${row},${col}`;
    // If collision, keep higher… we don't have score here; keep first / closer
    if (cells[row][col]) {
      const existing = cells[row][col];
      const dNew = Math.hypot(it.u - (uMin + col), it.v - (vMin + row));
      const dOld = Math.hypot(existing.u - (uMin + col), existing.v - (vMin + row));
      if (dNew >= dOld) continue;
    }
    const entry = {
      row,
      col,
      corners: it.corners,
      center: it.center,
      u: it.u,
      v: it.v,
      sourceIndex: it.i,
    };
    cells[row][col] = entry;
    used.add(key);
    assignments.push(entry);
  }

  // Refine origin + axes from assigned cells via least-squares on centers
  const occupied = assignments;
  let origin = { x: meanC.x, y: meanC.y };
  if (occupied.length >= 3) {
    const c00 = cells[0][0];
    if (c00) {
      origin = { ...c00.center };
    } else {
      const any = occupied[0];
      origin = {
        x: any.center.x - any.col * colA.dx - any.row * rowA.dx,
        y: any.center.y - any.col * colA.dy - any.row * rowA.dy,
      };
    }
  }

  // Mean card parallelogram (relative to center)
  const relShapes = occupied.map(o => {
    const arr = cornersToArr(o.corners);
    const c = o.center;
    return arr.map(([x, y]) => [x - c.x, y - c.y]);
  });
  const meanRel = [0, 1, 2, 3].map(k => {
    const p = meanPt(relShapes.map(s => ({ x: s[k][0], y: s[k][1] })));
    return [p.x, p.y];
  });

  const predictCell = (row, col) => {
    const cx = origin.x + col * colA.dx + row * rowA.dx;
    const cy = origin.y + col * colA.dy + row * rowA.dy;
    const neigh = [];
    const deltas = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ];
    for (const [dr, dc] of deltas) {
      const rr = row + dr;
      const cc = col + dc;
      if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
      if (cells[rr][cc]) neigh.push({ cell: cells[rr][cc], dr, dc });
    }
    let center = { x: cx, y: cy };
    if (neigh.length >= 2) {
      const pts = neigh.map(n => ({
        x: n.cell.center.x - n.dc * colA.dx - n.dr * rowA.dx,
        y: n.cell.center.y - n.dc * colA.dy - n.dr * rowA.dy,
      }));
      center = meanPt(pts);
    } else if (neigh.length === 1) {
      const n = neigh[0];
      center = {
        x: n.cell.center.x - n.dc * colA.dx - n.dr * rowA.dx,
        y: n.cell.center.y - n.dc * colA.dy - n.dr * rowA.dy,
      };
    }
    const quad = meanRel.map(([rx, ry]) => [center.x + rx, center.y + ry]);
    return arrToCorners(quad);
  };

  const missing = [];
  const predicted = Array.from({ length: rows }, () => Array(cols).fill(null));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (cells[r][c]) {
        predicted[r][c] = { kind: 'observed', corners: cells[r][c].corners };
      } else {
        const corners = predictCell(r, c);
        predicted[r][c] = { kind: 'predicted', corners };
        missing.push({ row: r, col: c, corners });
      }
    }
  }

  const occupancy = occupied.length / (rows * cols);
  // Confidence: occupancy + axis orthogonality + assignment residual
  const angCol = Math.atan2(colA.dy, colA.dx);
  const angRow = Math.atan2(rowA.dy, rowA.dx);
  let dang = Math.abs(angRow - angCol);
  while (dang > Math.PI) dang -= Math.PI;
  const ortho = 1 - Math.abs(dang - Math.PI / 2) / (Math.PI / 2);
  const residual =
    occupied.reduce((s, o) => {
      const expectU = uMin + o.col;
      const expectV = vMin + o.row;
      return s + Math.hypot(o.u - expectU, o.v - expectV);
    }, 0) / occupied.length;
  const residualScore = Math.max(0, 1 - residual / 0.6);
  const confidence = Math.max(
    0,
    Math.min(1, 0.45 * occupancy + 0.25 * ortho + 0.3 * residualScore),
  );

  return {
    rows,
    cols,
    cells,
    predicted,
    assignments: occupied,
    missing,
    confidence,
    rowVec: rowA,
    colVec: colA,
    origin,
    meanRel,
    occupancy,
    reason: 'ok',
  };
};

export { centerOf, arrToCorners, cornersToArr };
