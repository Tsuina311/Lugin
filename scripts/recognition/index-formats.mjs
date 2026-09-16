/**
 * Index storage formats for visual retrieval bakeoff.
 * CLIP_VIT_B32_F32 remains the frozen quality baseline.
 *
 * F16: IEEE half of L2-normalized f32 (query stays f32; refs dequantized on the fly
 *      or promoted for dot — we promote per-vector to f32 for correctness).
 * INT8: per-vector absmax scale; store int8 coeffs of already L2-normalized vectors.
 *      score = scale * dot(query_f32, int8_as_f32)
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const f32ToF16Bits = x => {
  const f32 = new Float32Array(1);
  const u32 = new Uint32Array(f32.buffer);
  f32[0] = x;
  const bits = u32[0];
  const sign = (bits >>> 16) & 0x8000;
  let exp = ((bits >>> 23) & 0xff) - 127 + 15;
  let frac = bits & 0x7fffff;
  if (exp <= 0) {
    if (exp < -10) return sign;
    frac = (frac | 0x800000) >> (1 - exp);
    return sign | (frac >> 13);
  }
  if (exp >= 31) return sign | 0x7c00; // Inf
  return sign | (exp << 10) | (frac >> 13);
};

const f16BitsToF32 = h => {
  const sign = (h & 0x8000) << 16;
  let exp = (h >> 10) & 0x1f;
  let frac = h & 0x3ff;
  let out;
  if (exp === 0) {
    if (frac === 0) out = sign;
    else {
      exp = 1;
      while (!(frac & 0x400)) {
        frac <<= 1;
        exp -= 1;
      }
      frac &= 0x3ff;
      out = sign | ((exp + 127 - 15) << 23) | (frac << 13);
    }
  } else if (exp === 31) {
    out = sign | 0x7f800000 | (frac << 13);
  } else {
    out = sign | ((exp + 127 - 15) << 23) | (frac << 13);
  }
  const u32 = new Uint32Array([out]);
  return new Float32Array(u32.buffer)[0];
};

export const sha256File = path => {
  const buf = readFileSync(path);
  return createHash('sha256').update(buf).digest('hex');
};

export const convertF32ToF16Index = (f32Index, outDir) => {
  mkdirSync(outDir, { recursive: true });
  const { embeddings, refs, dims, count, metadata } = f32Index;
  const f16 = new Uint16Array(count * dims);
  for (let i = 0; i < embeddings.length; i++) f16[i] = f32ToF16Bits(embeddings[i]);
  const embPath = join(outDir, 'embeddings.f16.bin');
  writeFileSync(embPath, Buffer.from(f16.buffer, f16.byteOffset, f16.byteLength));
  writeFileSync(join(outDir, 'refs.json'), JSON.stringify(refs));
  const meta = {
    ...metadata,
    configId: 'CLIP_VIT_B32_F16',
    dtype: 'f16',
    float32Bytes: embeddings.byteLength,
    float16Bytes: f16.byteLength,
    diskBytes: f16.byteLength,
    generated: new Date().toISOString(),
    sourceDtype: 'f32',
  };
  writeFileSync(join(outDir, 'metadata.json'), JSON.stringify(meta, null, 2));
  return {
    outDir,
    metadata: meta,
    refs,
    dims,
    count,
    dtype: 'f16',
    embeddingsF16: f16,
    diskBytes: f16.byteLength,
  };
};

/**
 * Per-vector absmax int8 of L2-normalized embeddings.
 * scales[i] = max(|v|) / 127; stored[i,d] = round(v[d] / scales[i])
 */
export const convertF32ToInt8Index = (f32Index, outDir) => {
  mkdirSync(outDir, { recursive: true });
  const { embeddings, refs, dims, count, metadata } = f32Index;
  const ints = new Int8Array(count * dims);
  const scales = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const off = i * dims;
    let maxAbs = 0;
    for (let d = 0; d < dims; d++) {
      const a = Math.abs(embeddings[off + d]);
      if (a > maxAbs) maxAbs = a;
    }
    const scale = maxAbs > 0 ? maxAbs / 127 : 1;
    scales[i] = scale;
    for (let d = 0; d < dims; d++) {
      ints[off + d] = Math.max(-127, Math.min(127, Math.round(embeddings[off + d] / scale)));
    }
  }
  writeFileSync(join(outDir, 'embeddings.i8.bin'), Buffer.from(ints.buffer, ints.byteOffset, ints.byteLength));
  writeFileSync(join(outDir, 'scales.f32.bin'), Buffer.from(scales.buffer, scales.byteOffset, scales.byteLength));
  writeFileSync(join(outDir, 'refs.json'), JSON.stringify(refs));
  const diskBytes = ints.byteLength + scales.byteLength;
  const meta = {
    ...metadata,
    configId: 'CLIP_VIT_B32_I8',
    dtype: 'i8_per_vector',
    quantization: {
      scheme: 'absmax_per_vector',
      zeroPoint: 0,
      note: 'Vectors were L2-normalized before quant. score = scale_i * dot(q_f32, i8_i)',
    },
    float32Bytes: embeddings.byteLength,
    int8Bytes: ints.byteLength,
    scalesBytes: scales.byteLength,
    diskBytes,
    generated: new Date().toISOString(),
    sourceDtype: 'f32',
  };
  writeFileSync(join(outDir, 'metadata.json'), JSON.stringify(meta, null, 2));
  return {
    outDir,
    metadata: meta,
    refs,
    dims,
    count,
    dtype: 'i8_per_vector',
    embeddingsI8: ints,
    scales,
    diskBytes,
  };
};

export const loadTypedIndex = outDir => {
  const metaPath = join(outDir, 'metadata.json');
  if (!existsSync(metaPath)) return null;
  const metadata = JSON.parse(readFileSync(metaPath, 'utf8'));
  const refs = JSON.parse(readFileSync(join(outDir, 'refs.json'), 'utf8'));
  const dims = metadata.dims;
  const count = metadata.count;
  if (metadata.dtype === 'f16' || existsSync(join(outDir, 'embeddings.f16.bin'))) {
    const buf = readFileSync(join(outDir, 'embeddings.f16.bin'));
    const embeddingsF16 = new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
    return {
      outDir,
      metadata,
      refs,
      dims,
      count,
      dtype: 'f16',
      embeddingsF16,
      diskBytes: buf.byteLength,
    };
  }
  if (metadata.dtype === 'i8_per_vector' || existsSync(join(outDir, 'embeddings.i8.bin'))) {
    const ibuf = readFileSync(join(outDir, 'embeddings.i8.bin'));
    const sbuf = readFileSync(join(outDir, 'scales.f32.bin'));
    return {
      outDir,
      metadata,
      refs,
      dims,
      count,
      dtype: 'i8_per_vector',
      embeddingsI8: new Int8Array(ibuf.buffer, ibuf.byteOffset, ibuf.byteLength),
      scales: new Float32Array(sbuf.buffer, sbuf.byteOffset, sbuf.byteLength / 4),
      diskBytes: ibuf.byteLength + sbuf.byteLength,
    };
  }
  // f32
  const buf = readFileSync(join(outDir, 'embeddings.bin'));
  return {
    outDir,
    metadata: { ...metadata, dtype: metadata.dtype || 'f32' },
    refs,
    dims,
    count,
    dtype: 'f32',
    embeddings: new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4),
    diskBytes: buf.byteLength,
  };
};

/**
 * Brute-force cosine / equivalent with oracle collapse.
 */
export const searchTypedIndex = (index, queryEmbedding, topK = 10) => {
  const t0 = performance.now();
  const { refs, dims, count, dtype } = index;
  const best = new Map();

  if (dtype === 'f32') {
    const { embeddings } = index;
    for (let i = 0; i < count; i++) {
      const offset = i * dims;
      let dot = 0;
      for (let d = 0; d < dims; d++) dot += queryEmbedding[d] * embeddings[offset + d];
      const ref = refs[i];
      const prev = best.get(ref.oracleId);
      if (!prev || dot > prev.score) {
        best.set(ref.oracleId, {
          name: ref.canonicalName,
          oracleId: ref.oracleId,
          scryfallId: ref.scryfallId,
          artId: ref.artId,
          score: dot,
        });
      }
    }
  } else if (dtype === 'f16') {
    // Expand once to f32 working set (realistic mobile: f16 asset → RAM f32 or SIMD half).
    if (!index._f32Working) {
      const { embeddingsF16 } = index;
      const f32w = new Float32Array(count * dims);
      for (let i = 0; i < embeddingsF16.length; i++) f32w[i] = f16BitsToF32(embeddingsF16[i]);
      index._f32Working = f32w;
    }
    const embeddings = index._f32Working;
    for (let i = 0; i < count; i++) {
      const offset = i * dims;
      let dot = 0;
      for (let d = 0; d < dims; d++) dot += queryEmbedding[d] * embeddings[offset + d];
      const ref = refs[i];
      const prev = best.get(ref.oracleId);
      if (!prev || dot > prev.score) {
        best.set(ref.oracleId, {
          name: ref.canonicalName,
          oracleId: ref.oracleId,
          scryfallId: ref.scryfallId,
          artId: ref.artId,
          score: dot,
        });
      }
    }
  } else if (dtype === 'i8_per_vector') {
    const { embeddingsI8, scales } = index;
    for (let i = 0; i < count; i++) {
      const offset = i * dims;
      let dot = 0;
      for (let d = 0; d < dims; d++) dot += queryEmbedding[d] * embeddingsI8[offset + d];
      const score = dot * scales[i];
      const ref = refs[i];
      const prev = best.get(ref.oracleId);
      if (!prev || score > prev.score) {
        best.set(ref.oracleId, {
          name: ref.canonicalName,
          oracleId: ref.oracleId,
          scryfallId: ref.scryfallId,
          artId: ref.artId,
          score,
        });
      }
    }
  } else {
    throw new Error(`unknown dtype ${dtype}`);
  }

  const collapseT0 = performance.now();
  const hits = [...best.values()].sort((a, b) => b.score - a.score).slice(0, topK);
  const searchMs = performance.now() - t0;
  return {
    hits,
    searchMs,
    oracleCollapseMs: performance.now() - collapseT0,
    scoredArts: count,
  };
};

/** Pure search loop timing without oracle map overhead (approx). */
export const benchSearchOnly = (index, queryEmbedding, repeats = 20) => {
  const times = [];
  for (let r = 0; r < repeats; r++) {
    const t0 = performance.now();
    searchTypedIndex(index, queryEmbedding, 10);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return {
    medianMs: times[Math.floor(times.length * 0.5)],
    p95Ms: times[Math.min(times.length - 1, Math.floor(times.length * 0.95))],
    diskBytes: index.diskBytes ?? (index.metadata?.diskBytes ?? null),
    dtype: index.dtype,
    count: index.count,
  };
};

export const indexDiskMb = index =>
  (index.diskBytes ?? statSync(join(index.outDir, 'embeddings.bin')).size) / 1e6;
