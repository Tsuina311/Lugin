/**
 * Small adapters on frozen 512-d CLIP vectors.
 * Linear: y = normalize(x W + b), W initialized to I.
 * Residual MLP: y = normalize(x + relu(x W1 + b1) W2 + b2), W2 initialized to 0.
 */

const DIMS = 512;

export const adapterSpec = kind => {
  if (kind === 'linear') {
    const params = DIMS * DIMS + DIMS;
    return { kind, params, bytes: params * 4, hidden: 0 };
  }
  if (kind === 'mlp') {
    const hidden = 256;
    const params = DIMS * hidden + hidden + hidden * DIMS + DIMS;
    return { kind, params, bytes: params * 4, hidden };
  }
  throw new Error(`unknown adapter ${kind}`);
};

const randn = rng => {
  const u = Math.max(1e-12, rng());
  const v = Math.max(1e-12, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * v);
};

export const mulberry32 = seed => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const createModel = (kind, seed = 1) => {
  const rng = mulberry32(seed);
  const spec = adapterSpec(kind);
  if (kind === 'linear') {
    const W = new Float32Array(DIMS * DIMS);
    const b = new Float32Array(DIMS);
    for (let i = 0; i < DIMS; i++) W[i * DIMS + i] = 1;
    return { kind, in: DIMS, out: DIMS, hidden: 0, W, b, spec };
  }
  const hidden = spec.hidden;
  const W1 = new Float32Array(DIMS * hidden);
  const b1 = new Float32Array(hidden);
  const W2 = new Float32Array(hidden * DIMS);
  const b2 = new Float32Array(DIMS);
  const scale = 0.02;
  for (let i = 0; i < W1.length; i++) W1[i] = randn(rng) * scale;
  return { kind, in: DIMS, out: DIMS, hidden, W1, b1, W2, b2, spec };
};

export const cloneModel = model => {
  const next = { kind: model.kind, in: model.in, out: model.out, hidden: model.hidden, spec: model.spec };
  for (const key of paramKeys(model)) next[key] = Float32Array.from(model[key]);
  return next;
};

const paramKeys = model => (model.kind === 'linear' ? ['W', 'b'] : ['W1', 'b1', 'W2', 'b2']);

export const modelParamKeys = paramKeys;

export const saveModel = model => {
  const parts = {};
  for (const key of paramKeys(model)) parts[key] = Buffer.from(model[key].buffer, model[key].byteOffset, model[key].byteLength).toString('base64');
  return {
    kind: model.kind,
    in: model.in,
    out: model.out,
    hidden: model.hidden,
    params: model.spec.params,
    bytes: model.spec.bytes,
    parts,
  };
};

export const loadModel = saved => {
  const model = {
    kind: saved.kind,
    in: saved.in,
    out: saved.out,
    hidden: saved.hidden,
    spec: adapterSpec(saved.kind),
  };
  for (const [key, b64] of Object.entries(saved.parts)) {
    const buf = Buffer.from(b64, 'base64');
    model[key] = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    if (model[key].byteOffset % 4 !== 0) model[key] = Float32Array.from(model[key]);
  }
  return model;
};

const gemv = (x, W, b, z) => {
  z.set(b);
  const inn = x.length;
  const out = z.length;
  for (let i = 0; i < inn; i++) {
    const xi = x[i];
    if (xi === 0) continue;
    const row = i * out;
    for (let j = 0; j < out; j++) z[j] += xi * W[row + j];
  }
};

const normalize = (z, y) => {
  let s = 0;
  for (let i = 0; i < z.length; i++) s += z[i] * z[i];
  const n = Math.sqrt(s) || 1;
  for (let i = 0; i < z.length; i++) y[i] = z[i] / n;
  return n;
};

/** Forward one vector. y is normalized output. Cache feeds backward. */
export const forward = (model, x) => {
  if (model.kind === 'linear') {
    const z = new Float32Array(model.out);
    gemv(x, model.W, model.b, z);
    const y = new Float32Array(model.out);
    const n = normalize(z, y);
    return { y, z, n };
  }
  const hpre = new Float32Array(model.hidden);
  gemv(x, model.W1, model.b1, hpre);
  const h = new Float32Array(model.hidden);
  for (let i = 0; i < hpre.length; i++) h[i] = hpre[i] > 0 ? hpre[i] : 0;
  const proj = new Float32Array(model.out);
  gemv(h, model.W2, model.b2, proj);
  const z = new Float32Array(model.out);
  for (let i = 0; i < z.length; i++) z[i] = x[i] + proj[i];
  const y = new Float32Array(model.out);
  const n = normalize(z, y);
  return { y, z, n, hpre, h };
};

const dNormalize = (y, n, dy, dz) => {
  let dot = 0;
  for (let i = 0; i < y.length; i++) dot += dy[i] * y[i];
  for (let i = 0; i < y.length; i++) dz[i] = (dy[i] - y[i] * dot) / n;
};

/**
 * Accumulate dL/dparams given dL/dy. x is the frozen CLIP vector.
 * grads mirrors model parameter names.
 */
export const backward = (model, cache, x, dy, grads) => {
  const dz = new Float32Array(model.out);
  dNormalize(cache.y, cache.n, dy, dz);
  if (model.kind === 'linear') {
    const { W, b } = grads;
    for (let j = 0; j < model.out; j++) b[j] += dz[j];
    for (let i = 0; i < model.in; i++) {
      const xi = x[i];
      if (xi === 0) continue;
      const row = i * model.out;
      for (let j = 0; j < model.out; j++) W[row + j] += xi * dz[j];
    }
    return;
  }
  const dW2 = grads.W2;
  const db2 = grads.b2;
  const dh = new Float32Array(model.hidden);
  for (let j = 0; j < model.out; j++) db2[j] += dz[j];
  for (let k = 0; k < model.hidden; k++) {
    const hk = cache.h[k];
    const row = k * model.out;
    for (let j = 0; j < model.out; j++) {
      dW2[row + j] += hk * dz[j];
      dh[k] += model.W2[row + j] * dz[j];
    }
  }
  const dhpre = dh;
  for (let k = 0; k < model.hidden; k++) if (cache.hpre[k] <= 0) dhpre[k] = 0;
  const dW1 = grads.W1;
  const db1 = grads.b1;
  for (let k = 0; k < model.hidden; k++) db1[k] += dhpre[k];
  for (let i = 0; i < model.in; i++) {
    const xi = x[i];
    if (xi === 0) continue;
    const row = i * model.hidden;
    for (let k = 0; k < model.hidden; k++) dW1[row + k] += xi * dhpre[k];
  }
};

export const zeroLike = model => {
  const grads = {};
  for (const key of paramKeys(model)) grads[key] = new Float32Array(model[key].length);
  return grads;
};

export const adamState = model => {
  const state = {};
  for (const key of paramKeys(model)) {
    state[key] = { m: new Float32Array(model[key].length), v: new Float32Array(model[key].length) };
  }
  return state;
};

export const adamStep = (model, grads, state, { lr, t, clip = 5, b1 = 0.9, b2 = 0.999, eps = 1e-8 }) => {
  let norm2 = 0;
  for (const key of paramKeys(model)) {
    const g = grads[key];
    for (let i = 0; i < g.length; i++) norm2 += g[i] * g[i];
  }
  const norm = Math.sqrt(norm2) || 1;
  const scale = norm > clip ? clip / norm : 1;
  const bc1 = 1 - b1 ** t;
  const bc2 = 1 - b2 ** t;
  for (const key of paramKeys(model)) {
    const w = model[key];
    const g = grads[key];
    const { m, v } = state[key];
    for (let i = 0; i < w.length; i++) {
      const gi = g[i] * scale;
      m[i] = b1 * m[i] + (1 - b1) * gi;
      v[i] = b2 * v[i] + (1 - b2) * gi * gi;
      w[i] -= (lr * (m[i] / bc1)) / (Math.sqrt(v[i] / bc2) + eps);
    }
  }
};

/**
 * In-batch InfoNCE plus K hard negatives that belong to each query.
 * q, p, hard are normalized adapter outputs, flat [B,D] and [B,K,D].
 * Returns loss and dL/dy for each output. Label is the matching positive.
 */
export const infonce = (q, p, hard, B, D, K, tau) => {
  const classes = B + K;
  const prob = new Float32Array(B * classes);
  let loss = 0;
  for (let i = 0; i < B; i++) {
    const qo = i * D;
    let maxLogit = -Infinity;
    const logits = new Float32Array(classes);
    for (let j = 0; j < B; j++) {
      let dot = 0;
      const po = j * D;
      for (let d = 0; d < D; d++) dot += q[qo + d] * p[po + d];
      logits[j] = dot / tau;
      if (logits[j] > maxLogit) maxLogit = logits[j];
    }
    for (let k = 0; k < K; k++) {
      let dot = 0;
      const ho = (i * K + k) * D;
      for (let d = 0; d < D; d++) dot += q[qo + d] * hard[ho + d];
      logits[B + k] = dot / tau;
      if (logits[B + k] > maxLogit) maxLogit = logits[B + k];
    }
    let sum = 0;
    for (let c = 0; c < classes; c++) {
      const e = Math.exp(logits[c] - maxLogit);
      prob[i * classes + c] = e;
      sum += e;
    }
    for (let c = 0; c < classes; c++) prob[i * classes + c] /= sum;
    loss += -Math.log(Math.max(prob[i * classes + i], 1e-12));
  }
  loss /= B;

  const dq = new Float32Array(B * D);
  const dp = new Float32Array(B * D);
  const dh = new Float32Array(B * K * D);
  for (let i = 0; i < B; i++) {
    const qo = i * D;
    for (let j = 0; j < B; j++) {
      const g = (prob[i * classes + j] - (j === i ? 1 : 0)) / tau / B;
      const po = j * D;
      for (let d = 0; d < D; d++) {
        dq[qo + d] += g * p[po + d];
        dp[po + d] += g * q[qo + d];
      }
    }
    for (let k = 0; k < K; k++) {
      const g = prob[i * classes + (B + k)] / tau / B;
      const ho = (i * K + k) * D;
      for (let d = 0; d < D; d++) {
        dq[qo + d] += g * hard[ho + d];
        dh[ho + d] += g * q[qo + d];
      }
    }
  }
  return { loss, dq, dp, dh };
};

/** Apply the adapter to every row of a [count, dims] matrix. */
export const applyGallery = (model, embeddings, count, dims) => {
  const out = new Float32Array(count * dims);
  const x = new Float32Array(dims);
  for (let n = 0; n < count; n++) {
    x.set(embeddings.subarray(n * dims, (n + 1) * dims));
    const { y } = forward(model, x);
    out.set(y, n * dims);
  }
  return out;
};

const lossOf = (model, xs, B, D) => {
  const ys = xs.map(x => forward(model, x).y);
  const q = new Float32Array(B * D);
  const p = new Float32Array(B * D);
  for (let i = 0; i < B; i++) {
    q.set(ys[i], i * D);
    p.set(ys[B + i], i * D);
  }
  return infonce(q, p, new Float32Array(0), B, D, 0, 0.1).loss;
};

/** Finite-difference check on a tiny linear and residual MLP. Throws on failure. */
export const checkGradients = () => {
  const D = 4;
  const B = 2;
  const rng = mulberry32(7);
  const xs = [];
  for (let i = 0; i < B * 2; i++) {
    const x = new Float32Array(D);
    for (let d = 0; d < D; d++) x[d] = randn(rng);
    let n = 0;
    for (const v of x) n += v * v;
    n = Math.sqrt(n) || 1;
    for (let d = 0; d < D; d++) x[d] /= n;
    xs.push(x);
  }

  const checkKind = kind => {
    const model = kind === 'linear'
      ? { kind, in: D, out: D, hidden: 0, W: new Float32Array(D * D), b: new Float32Array(D), spec: { kind, params: 0, bytes: 0, hidden: 0 } }
      : {
          kind,
          in: D,
          out: D,
          hidden: 3,
          W1: new Float32Array(D * 3),
          b1: new Float32Array(3),
          W2: new Float32Array(3 * D),
          b2: new Float32Array(D),
          spec: { kind, params: 0, bytes: 0, hidden: 3 },
        };
    if (kind === 'linear') {
      for (let i = 0; i < D; i++) model.W[i * D + i] = 1;
      model.W[1] = 0.1;
    } else {
      for (let i = 0; i < model.W1.length; i++) model.W1[i] = randn(rng) * 0.2;
      for (let i = 0; i < model.W2.length; i++) model.W2[i] = randn(rng) * 0.2;
    }
    const grads = zeroLike(model);
    const caches = xs.map(x => forward(model, x));
    const q = new Float32Array(B * D);
    const p = new Float32Array(B * D);
    for (let i = 0; i < B; i++) {
      q.set(caches[i].y, i * D);
      p.set(caches[B + i].y, i * D);
    }
    const { dq, dp } = infonce(q, p, new Float32Array(0), B, D, 0, 0.1);
    for (let i = 0; i < B; i++) {
      const dyq = dq.subarray(i * D, (i + 1) * D);
      const dyp = dp.subarray(i * D, (i + 1) * D);
      backward(model, caches[i], xs[i], dyq, grads);
      backward(model, caches[B + i], xs[B + i], dyp, grads);
    }
    const eps = 1e-3;
    const probes = kind === 'linear' ? [['W', [0, 1, 5, D * D - 1]], ['b', [0, D - 1]]] : [['W1', [0, 3]], ['W2', [0, 2, model.W2.length - 1]]];
    for (const [key, indexes] of probes) {
      for (const index of indexes) {
        const orig = model[key][index];
        model[key][index] = orig + eps;
        const lp = lossOf(model, xs, B, D);
        model[key][index] = orig - eps;
        const lm = lossOf(model, xs, B, D);
        model[key][index] = orig;
        const numeric = (lp - lm) / (2 * eps);
        const analytic = grads[key][index];
        const err = Math.abs(numeric - analytic);
        if (err > 2e-3 && err / (Math.abs(numeric) + 1e-6) > 0.05) {
          throw new Error(`${kind} grad mismatch at ${key}[${index}] numeric ${numeric} analytic ${analytic}`);
        }
      }
    }
  };
  checkKind('linear');
  checkKind('mlp');
  return true;
};
