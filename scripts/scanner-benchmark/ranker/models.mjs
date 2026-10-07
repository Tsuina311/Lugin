/** Small deterministic rankers. Utility is one scalar per candidate. */

const dot = (w, x) => {
  let s = w[w.length - 1];
  for (let i = 0; i < x.length; i++) s += w[i] * x[i];
  return s;
};

export const standardizeFit = rows => {
  const d = rows[0]?.length ?? 0;
  const mean = Array(d).fill(0);
  const std = Array(d).fill(1);
  if (!rows.length) return { mean, std };
  for (const row of rows) for (let i = 0; i < d; i++) mean[i] += row[i];
  for (let i = 0; i < d; i++) mean[i] /= rows.length;
  for (const row of rows) for (let i = 0; i < d; i++) {
    const delta = row[i] - mean[i];
    std[i] += delta * delta;
  }
  for (let i = 0; i < d; i++) std[i] = Math.sqrt(std[i] / rows.length) || 1;
  return { mean, std };
};

export const standardizeApply = (row, norm) => row.map((value, i) => (value - norm.mean[i]) / norm.std[i]);

const solveLinear = (matrix, target) => {
  const n = target.length;
  const m = matrix.map((row, i) => [...row, target[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const div = m[col][col];
    if (Math.abs(div) < 1e-10) continue;
    for (let c = col; c <= n; c++) m[col][c] /= div;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = m[row][col];
      if (!factor) continue;
      for (let c = col; c <= n; c++) m[row][c] -= factor * m[col][c];
    }
  }
  return m.map(row => row[n]);
};

const ridgeFit = (rows, targets, lambda = 1) => {
  const d = rows[0].length;
  const xtx = Array.from({ length: d + 1 }, () => Array(d + 1).fill(0));
  const xty = Array(d + 1).fill(0);
  for (let i = 0; i < rows.length; i++) {
    const x = [...rows[i], 1];
    for (let a = 0; a < x.length; a++) {
      xty[a] += x[a] * targets[i];
      for (let b = 0; b < x.length; b++) xtx[a][b] += x[a] * x[b];
    }
  }
  for (let a = 0; a < d; a++) xtx[a][a] += lambda;
  return solveLinear(xtx, xty);
};

export const fitLinearRegression = (rows, targets) => {
  const norm = standardizeFit(rows);
  const scaled = rows.map(row => standardizeApply(row, norm));
  const weights = ridgeFit(scaled, targets, 1);
  return {
    kind: 'linear-iou',
    objective: 'iou-regression',
    family: 'linear',
    norm,
    weights,
    utility: row => dot(weights, standardizeApply(row, norm)),
  };
};

const softplusNeg = delta => (delta > 20 ? delta : Math.log1p(Math.exp(-delta)));

const pairGrad = delta => {
  const sig = delta >= 0 ? 1 / (1 + Math.exp(-delta)) : Math.exp(delta) / (1 + Math.exp(delta));
  return sig - 1;
};

export const trainingPairs = candidates => {
  if (candidates.length < 2) return [];
  let oracle = candidates[0];
  for (const row of candidates) {
    if (row.iou > oracle.iou + 1e-12 || (Math.abs(row.iou - oracle.iou) <= 1e-12 && row.index < oracle.index)) oracle = row;
  }
  const others = candidates
    .filter(row => row.index !== oracle.index)
    .sort((a, b) => b.detectorScore - a.detectorScore || a.index - b.index);
  const hard = others.filter(row => row.iou < 0.7 && row.detectorScore >= oracle.detectorScore - 0.05);
  const rest = others.filter(row => !hard.includes(row));
  return [...hard, ...rest].slice(0, 6).map(worse => ({ better: oracle, worse }));
};

const fitPairwiseLinear = (frames, featureOf) => {
  const raw = [];
  const pairs = [];
  for (const frame of frames) {
    const rows = frame.candidates.map(candidate => featureOf(candidate));
    const base = raw.length;
    raw.push(...rows);
    for (const pair of trainingPairs(frame.candidates)) {
      const bi = frame.candidates.findIndex(row => row.index === pair.better.index);
      const wi = frame.candidates.findIndex(row => row.index === pair.worse.index);
      pairs.push([base + bi, base + wi]);
    }
  }
  if (!pairs.length || !raw.length) return fitLinearRegression(raw.length ? raw : [[0]], raw.length ? frames.flatMap(frame => frame.candidates.map(row => row.iou)) : [0]);
  const norm = standardizeFit(raw);
  const scaled = raw.map(row => standardizeApply(row, norm));
  const d = scaled[0].length;
  const weights = Array(d + 1).fill(0);
  const lr = 0.05;
  const l2 = 1e-3;
  for (let epoch = 0; epoch < 50; epoch++) {
    const grad = Array(d + 1).fill(0);
    for (const [bi, wi] of pairs) {
      const delta = dot(weights, scaled[bi]) - dot(weights, scaled[wi]);
      const g = pairGrad(delta);
      for (let i = 0; i < d; i++) grad[i] += g * (scaled[bi][i] - scaled[wi][i]);
    }
    for (let i = 0; i < d; i++) {
      grad[i] = grad[i] / pairs.length + l2 * weights[i];
      weights[i] -= lr * grad[i];
    }
  }
  return {
    kind: 'linear-pairwise',
    objective: 'pairwise',
    family: 'linear',
    norm,
    weights,
    utility: row => dot(weights, standardizeApply(row, norm)),
  };
};

const mean = values => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

const treeFit = (rows, residual, depth, minLeaf, weights) => {
  const wmean = idxs => {
    let sw = 0;
    let sv = 0;
    for (const i of idxs) {
      sw += weights[i];
      sv += weights[i] * residual[i];
    }
    return sw > 0 ? sv / sw : 0;
  };
  const split = (nodeIdxs, depthLeft) => {
    const value = wmean(nodeIdxs);
    if (depthLeft <= 0 || nodeIdxs.length < minLeaf * 2) return { value };
    let best = null;
    const d = rows[0].length;
    for (let feature = 0; feature < d; feature++) {
      const order = [...nodeIdxs].sort((a, b) => rows[a][feature] - rows[b][feature] || a - b);
      for (let q = 1; q < 8; q++) {
        const cut = order[Math.floor((order.length * q) / 8)];
        const threshold = rows[cut][feature];
        const left = [];
        const right = [];
        for (const i of nodeIdxs) (rows[i][feature] <= threshold ? left : right).push(i);
        if (left.length < minLeaf || right.length < minLeaf) continue;
        const sse = group => {
          const mu = wmean(group);
          let loss = 0;
          for (const i of group) loss += weights[i] * (residual[i] - mu) ** 2;
          return loss;
        };
        const loss = sse(left) + sse(right);
        if (!best || loss < best.loss - 1e-12) best = { loss, feature, threshold, left, right };
      }
    }
    if (!best) return { value };
    return {
      feature: best.feature,
      threshold: best.threshold,
      left: split(best.left, depthLeft - 1),
      right: split(best.right, depthLeft - 1),
    };
  };
  const root = split(rows.map((_, i) => i), depth);
  const predictNode = (node, row) => {
    if (!node.left) return node.value;
    return predictNode(row[node.feature] <= node.threshold ? node.left : node.right, row);
  };
  return { root, predict: row => predictNode(root, row) };
};

export const fitBoostedTrees = (rows, targets, options = {}) => {
  const learningRate = options.learningRate ?? 0.1;
  const rounds = options.rounds ?? 24;
  const depth = options.depth ?? 2;
  const minLeaf = options.minLeaf ?? 6;
  const weights = options.weights ?? targets.map(() => 1);
  const base = mean(targets);
  const pred = Array(targets.length).fill(base);
  const trees = [];
  for (let round = 0; round < rounds; round++) {
    const residual = targets.map((target, i) => target - pred[i]);
    const tree = treeFit(rows, residual, depth, minLeaf, weights);
    trees.push(tree.root);
    for (let i = 0; i < rows.length; i++) pred[i] += learningRate * tree.predict(rows[i]);
  }
  const predictNode = (node, row) => {
    if (!node?.left) return node?.value ?? 0;
    return predictNode(row[node.feature] <= node.threshold ? node.left : node.right, row);
  };
  return {
    kind: 'gbm-iou',
    objective: 'iou-regression',
    family: 'tree',
    norm: null,
    base,
    learningRate,
    rounds,
    depth,
    minLeaf,
    trees,
    utility: row => trees.reduce((sum, tree) => sum + learningRate * predictNode(tree, row), base),
  };
};

const rand = seed => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

const relu = value => (value > 0 ? value : 0);

const packMlp = ({ w1, b1, w2, b2, w3, b3, norm, kind, objective }) => ({
  kind,
  objective,
  family: 'mlp',
  norm,
  w1,
  b1,
  w2,
  b2,
  w3,
  b3,
  utility: row => mlpUtility({ w1, b1, w2, b2, w3, b3 }, standardizeApply(row, norm)),
});

export const mlpUtility = (model, x) => {
  const a1 = model.b1.map((bias, i) => relu(bias + model.w1[i].reduce((sum, weight, j) => sum + weight * x[j], 0)));
  const a2 = model.b2.map((bias, i) => relu(bias + model.w2[i].reduce((sum, weight, j) => sum + weight * a1[j], 0)));
  return model.b3 + model.w3.reduce((sum, weight, j) => sum + weight * a2[j], 0);
};

export const fitMlp = (rows, targets, { pairwise = false, pairIndex = [] } = {}) => {
  const norm = standardizeFit(rows);
  const scaled = rows.map(row => standardizeApply(row, norm));
  const d = scaled[0].length;
  const h1 = 32;
  const h2 = 16;
  const rng = rand(20261006);
  const fill = (n, fan) => Array.from({ length: n }, () => (rng() * 2 - 1) * Math.sqrt(2 / fan));
  const model = {
    w1: Array.from({ length: h1 }, () => fill(d, d)),
    b1: Array(h1).fill(0),
    w2: Array.from({ length: h2 }, () => fill(h1, h1)),
    b2: Array(h2).fill(0),
    w3: fill(h2, h2),
    b3: 0,
  };
  const lr = pairwise ? 0.02 : 0.01;
  const epochs = pairwise ? 50 : 70;
  for (let epoch = 0; epoch < epochs; epoch++) {
    const g1 = model.w1.map(row => row.map(() => 0));
    const gb1 = model.b1.map(() => 0);
    const g2 = model.w2.map(row => row.map(() => 0));
    const gb2 = model.b2.map(() => 0);
    const g3 = model.w3.map(() => 0);
    let gb3 = 0;
    const caches = scaled.map(x => {
      const z1 = model.b1.map((bias, i) => bias + model.w1[i].reduce((sum, weight, j) => sum + weight * x[j], 0));
      const a1 = z1.map(relu);
      const z2 = model.b2.map((bias, i) => bias + model.w2[i].reduce((sum, weight, j) => sum + weight * a1[j], 0));
      const a2 = z2.map(relu);
      const out = model.b3 + model.w3.reduce((sum, weight, j) => sum + weight * a2[j], 0);
      return { x, z1, a1, z2, a2, out };
    });
    const accumulate = (cache, upstream) => {
      gb3 += upstream;
      for (let j = 0; j < h2; j++) g3[j] += upstream * cache.a2[j];
      const dh2 = model.w3.map((weight, j) => upstream * weight * (cache.z2[j] > 0 ? 1 : 0));
      for (let i = 0; i < h2; i++) {
        gb2[i] += dh2[i];
        for (let j = 0; j < h1; j++) g2[i][j] += dh2[i] * cache.a1[j];
      }
      const dh1 = Array.from({ length: h1 }, (_, j) => {
        let sum = 0;
        for (let i = 0; i < h2; i++) sum += dh2[i] * model.w2[i][j];
        return sum * (cache.z1[j] > 0 ? 1 : 0);
      });
      for (let i = 0; i < h1; i++) {
        gb1[i] += dh1[i];
        for (let j = 0; j < d; j++) g1[i][j] += dh1[i] * cache.x[j];
      }
    };
    if (pairwise) {
      for (const [bi, wi] of pairIndex) accumulate(caches[bi], pairGrad(caches[bi].out - caches[wi].out));
      for (const [bi, wi] of pairIndex) accumulate(caches[wi], -pairGrad(caches[bi].out - caches[wi].out));
    } else {
      for (let i = 0; i < caches.length; i++) accumulate(caches[i], caches[i].out - targets[i]);
    }
    const scale = lr / Math.max(1, pairwise ? pairIndex.length : rows.length);
    for (let i = 0; i < h1; i++) {
      model.b1[i] -= gb1[i] * scale;
      for (let j = 0; j < d; j++) model.w1[i][j] -= g1[i][j] * scale;
    }
    for (let i = 0; i < h2; i++) {
      model.b2[i] -= gb2[i] * scale;
      for (let j = 0; j < h1; j++) model.w2[i][j] -= g2[i][j] * scale;
    }
    model.b3 -= gb3 * scale;
    for (let j = 0; j < h2; j++) model.w3[j] -= g3[j] * scale;
  }
  return packMlp({
    ...model,
    norm,
    kind: pairwise ? 'mlp-pairwise' : 'mlp-iou',
    objective: pairwise ? 'pairwise' : 'iou-regression',
  });
};

export const fitLinearPairwise = (frames, featureOf) => fitPairwiseLinear(frames, featureOf);

export const serializeModel = model => {
  const { utility, ...rest } = model;
  return rest;
};

export const hydrateModel = packed => {
  if (packed.family === 'linear') {
    return { ...packed, utility: row => dot(packed.weights, standardizeApply(row, packed.norm)) };
  }
  if (packed.family === 'mlp') return packMlp(packed);
  if (packed.family === 'tree') {
    const predictNode = (node, row) => {
      if (!node?.left) return node?.value ?? 0;
      return predictNode(row[node.feature] <= node.threshold ? node.left : node.right, row);
    };
    return {
      ...packed,
      utility: row => packed.trees.reduce((sum, tree) => sum + packed.learningRate * predictNode(tree, row), packed.base),
    };
  }
  throw new Error(`unknown model family ${packed.family}`);
};
