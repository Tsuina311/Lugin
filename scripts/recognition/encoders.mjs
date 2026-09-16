/**
 * Visual encoder registry for host recognition bakeoff.
 *
 * CLIP_VIT_B32 remains the quality baseline — do not replace it.
 */

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** @typedef {{
 *   id: string,
 *   label: string,
 *   hfId: string,
 *   dims: number,
 *   quantized: boolean,
 *   estimatedModelMb: number,
 *   mobileCandidate: boolean,
 *   load: () => Promise<{ embedPath: (imagePath: string) => Promise<Float32Array>, dims: number }>,
 * }} EncoderDef */

export const PREPROCESS_VERSION = 1;
export const VISUAL_INDEX_VERSION = 2;

const l2Normalize = v => {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  return Float32Array.from(v, x => x / n);
};

const loadClipPipeline = async (hfId, quantized) => {
  const { pipeline: hfPipeline, env } = await import('@xenova/transformers');
  env.cacheDir = join(root, '.scan-fixtures/transformers-cache');
  env.allowLocalModels = false;
  const extractor = await hfPipeline('image-feature-extraction', hfId, { quantized });
  return {
    dims: 512,
    embedPath: async imagePath => {
      const out = await extractor(imagePath, { pooling: 'mean', normalize: true });
      const data = out?.data ?? out;
      return l2Normalize(Array.from(data));
    },
  };
};

/**
 * MobileCLIP vision tower via CLIPVisionModelWithProjection (transformers.js).
 * Falls back with a clear error if the runtime cannot load the model.
 */
const loadMobileClipVision = async hfId => {
  const transformers = await import('@xenova/transformers');
  const {
    AutoProcessor,
    CLIPVisionModelWithProjection,
    RawImage,
    env,
  } = transformers;
  env.cacheDir = join(root, '.scan-fixtures/transformers-cache');
  env.allowLocalModels = false;

  const processor = await AutoProcessor.from_pretrained(hfId);
  const vision = await CLIPVisionModelWithProjection.from_pretrained(hfId, {
    quantized: true,
  });

  return {
    dims: null, // filled after first forward
    embedPath: async imagePath => {
      const image = await RawImage.read(imagePath);
      const inputs = await processor(image);
      const { image_embeds } = await vision(inputs);
      const data = image_embeds?.data ?? image_embeds?.tolist?.()?.[0] ?? image_embeds;
      const arr = Array.isArray(data[0]) ? data[0] : Array.from(data);
      return l2Normalize(arr);
    },
  };
};

/** @type {Record<string, EncoderDef>} */
export const ENCODERS = {
  CLIP_VIT_B32: {
    id: 'CLIP_VIT_B32',
    label: 'CLIP ViT-B/32 (quality baseline)',
    hfId: 'Xenova/clip-vit-base-patch32',
    dims: 512,
    quantized: true,
    estimatedModelMb: 85,
    mobileCandidate: false,
    load: () => loadClipPipeline('Xenova/clip-vit-base-patch32', true),
  },
  MOBILECLIP_S0: {
    id: 'MOBILECLIP_S0',
    label: 'MobileCLIP S0',
    hfId: 'Xenova/mobileclip_s0',
    dims: 512,
    quantized: true,
    estimatedModelMb: 15,
    mobileCandidate: true,
    load: () => loadMobileClipVision('Xenova/mobileclip_s0'),
  },
  MOBILECLIP_S1: {
    id: 'MOBILECLIP_S1',
    label: 'MobileCLIP S1',
    hfId: 'Xenova/mobileclip_s1',
    dims: 512,
    quantized: true,
    estimatedModelMb: 20,
    mobileCandidate: true,
    load: () => loadMobileClipVision('Xenova/mobileclip_s1'),
  },
  MOBILECLIP_S2: {
    id: 'MOBILECLIP_S2',
    label: 'MobileCLIP S2',
    hfId: 'Xenova/mobileclip_s2',
    dims: 512,
    quantized: true,
    estimatedModelMb: 35,
    mobileCandidate: true,
    load: () => loadMobileClipVision('Xenova/mobileclip_s2'),
  },
};

export const DEFAULT_ENCODER_ID = 'CLIP_VIT_B32';

export const getEncoderDef = id => {
  const key = (id || DEFAULT_ENCODER_ID).toUpperCase().replace(/-/g, '_');
  const aliases = {
    CLIP: 'CLIP_VIT_B32',
    'CLIP_VIT_B32': 'CLIP_VIT_B32',
    'CLIP-VIT-B32': 'CLIP_VIT_B32',
    MOBILECLIP_S0: 'MOBILECLIP_S0',
    MOBILECLIP_S1: 'MOBILECLIP_S1',
    MOBILECLIP_S2: 'MOBILECLIP_S2',
  };
  const resolved = aliases[key] || aliases[id] || key;
  const def = ENCODERS[resolved];
  if (!def) throw new Error(`Unknown encoder: ${id}. Known: ${Object.keys(ENCODERS).join(', ')}`);
  return def;
};

const loaded = new Map();

export const loadEncoder = async id => {
  const def = getEncoderDef(id);
  if (!loaded.has(def.id)) {
    loaded.set(
      def.id,
      (async () => {
        const runtime = await def.load();
        return { def, runtime };
      })(),
    );
  }
  return loaded.get(def.id);
};
