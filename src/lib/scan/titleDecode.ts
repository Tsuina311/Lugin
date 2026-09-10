// Bounded title decoding: exact first pass, then at most two more OCR variants
// and a strong-fuzzy consensus rule. Does not change TITLE_ONLY_MIN (0.94).

import {
  candidateMargin,
  editDistance,
  foldName,
  matchName,
  type CardNameIndex,
  type NameCandidate,
} from './matchName';
import { TITLE_TOP_N } from './params';
import { tidyName } from './parseCollector';
import { TITLE_ONLY_MIN } from './ranking/fuse';
import { TITLE_WHITELIST, readTitle } from './readCard';
import type { ScanProfile } from './regions';
import type { TextRecognizer } from './textRecognizer';
import type { ScanImage } from './types';

const clock = (): number =>
  typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();

/** Distinct agreeing variants required before strong-fuzzy may publish. */
export const STRONG_FUZZY_MIN_VARIANTS = 2;
/** Leader must beat #2 by at least this on the best agreeing variant. */
export const STRONG_FUZZY_MIN_MARGIN = 0.12;
/** Token-weighted similarity floor (not a second global title threshold). */
export const STRONG_FUZZY_MIN_TOKEN = 0.78;
/** Folded OCR must keep this many letters — rejects "gate" / "ate". */
export const STRONG_FUZZY_MIN_FOLDED_LEN = 8;
/** Folded OCR length vs candidate length. */
export const STRONG_FUZZY_MIN_LEN_RATIO = 0.55;

export type TitleDecodeDecisionKind = 'exact-title' | 'strong-fuzzy' | 'ambiguous' | 'ocr-empty';

export interface TitleVariantRecord {
  margin: number | null;
  ocrMs: number;
  ocrText: string;
  secondName: string | null;
  secondScore: number | null;
  source: string;
  tokenSimilarity: number | null;
  topName: string | null;
  topScore: number | null;
}

export interface TitleDecodeResult {
  consensusCount: number;
  decision: TitleDecodeDecisionKind;
  fallbackOcrMs: number;
  fallbackUsed: boolean;
  firstOcrMs: number;
  matchName: string | null;
  matchScore: number | null;
  ocrText: string;
  reason: string;
  titleCandidates: NameCandidate[];
  titleMargin: number | null;
  titleSecondScore: number | null;
  titleTopScore: number | null;
  variants: TitleVariantRecord[];
}

export const emptyTitleDecode = (): TitleDecodeResult => ({
  consensusCount: 0,
  decision: 'ocr-empty',
  fallbackOcrMs: 0,
  fallbackUsed: false,
  firstOcrMs: 0,
  matchName: null,
  matchScore: null,
  ocrText: '',
  reason: 'no-ocr',
  titleCandidates: [],
  titleMargin: null,
  titleSecondScore: null,
  titleTopScore: null,
  variants: [],
});

export const tokenizeTitle = (raw: string): string[] =>
  raw
    .split(/[\s/,]+/)
    .map(part => foldName(part))
    .filter(part => part.length > 0);

/**
 * Length-weighted token similarity. A correct long token plus a noisy short
 * tail scores higher than two unrelated fragments of the same total edit cost.
 */
export const tokenWeightedSimilarity = (ocr: string, name: string): number => {
  const ocrTok = tokenizeTitle(ocr);
  const nameTok = tokenizeTitle(name);
  if (!ocrTok.length || !nameTok.length) return 0;
  const pairCount = Math.min(ocrTok.length, nameTok.length);
  let weighted = 0;
  let weight = 0;
  for (let i = 0; i < pairCount; i++) {
    const a = ocrTok[i];
    const b = nameTok[i];
    const w = Math.max(a.length, b.length);
    const dist = w ? editDistance(a, b) / w : 1;
    weighted += w * (1 - dist);
    weight += w;
  }
  const extra = Math.abs(ocrTok.length - nameTok.length);
  if (extra) {
    const leftover = ocrTok.length > nameTok.length ? ocrTok.slice(pairCount) : nameTok.slice(pairCount);
    const extraW = leftover.reduce((n, t) => n + t.length, 0);
    weight += extraW;
  }
  return weight ? weighted / weight : 0;
};

export const titlePreservedEnough = (ocr: string, name: string): boolean => {
  const q = foldName(ocr);
  const n = foldName(name);
  if (q.length < STRONG_FUZZY_MIN_FOLDED_LEN) return false;
  if (q.length / Math.max(n.length, 1) < STRONG_FUZZY_MIN_LEN_RATIO) return false;
  const ocrTok = tokenizeTitle(ocr);
  const nameTok = tokenizeTitle(name);
  if (nameTok.length >= 2 && ocrTok.length === 1 && ocrTok[0].length < STRONG_FUZZY_MIN_FOLDED_LEN) {
    return false;
  }
  return true;
};

export const recordTitleVariant = (
  source: string,
  ocrText: string,
  index: CardNameIndex | null,
  ocrMs: number,
): TitleVariantRecord => {
  const text = ocrText.trim();
  if (!text || !index) {
    return {
      margin: null,
      ocrMs,
      ocrText: text,
      secondName: null,
      secondScore: null,
      source,
      tokenSimilarity: null,
      topName: null,
      topScore: null,
    };
  }
  const candidates = matchName(text, index, { limit: TITLE_TOP_N });
  const top = candidates[0] ?? null;
  const second = candidates[1] ?? null;
  const label = top?.printedName ?? top?.name ?? '';
  return {
    margin: candidates.length ? candidateMargin(candidates) : null,
    ocrMs,
    ocrText: text,
    secondName: second?.name ?? null,
    secondScore: second?.score ?? null,
    source,
    tokenSimilarity: top ? tokenWeightedSimilarity(text, label) : null,
    topName: top?.name ?? null,
    topScore: top?.score ?? null,
  };
};

const independentKey = (variant: TitleVariantRecord): string => foldName(variant.ocrText);

export const decideStrongFuzzyTitle = (
  variants: readonly TitleVariantRecord[],
): { accepted: boolean; name: string | null; reason: string; consensusCount: number } => {
  const withText = variants.filter(v => v.ocrText.trim().length > 0);
  const unique = new Map<string, TitleVariantRecord>();
  for (const variant of withText) {
    const key = independentKey(variant);
    if (!key) continue;
    const previous = unique.get(key);
    if (!previous || (variant.topScore ?? 0) > (previous.topScore ?? 0)) unique.set(key, variant);
  }
  const independent = [...unique.values()].filter(v => v.topName);
  if (independent.length < STRONG_FUZZY_MIN_VARIANTS) {
    return {
      accepted: false,
      consensusCount: independent.length,
      name: null,
      reason: independent.length ? 'single-reading' : 'no-match',
    };
  }

  const counts = new Map<string, TitleVariantRecord[]>();
  for (const variant of independent) {
    const name = variant.topName!;
    const list = counts.get(name) ?? [];
    list.push(variant);
    counts.set(name, list);
  }
  let agreed: string | null = null;
  let agreedList: TitleVariantRecord[] = [];
  for (const [name, list] of counts) {
    if (list.length > agreedList.length) {
      agreed = name;
      agreedList = list;
    }
  }
  const consensusCount = agreedList.length;
  if (!agreed || consensusCount < STRONG_FUZZY_MIN_VARIANTS) {
    return {
      accepted: false,
      consensusCount,
      name: agreed,
      reason: independent.length >= STRONG_FUZZY_MIN_VARIANTS ? 'variants-disagree' : 'no-consensus',
    };
  }

  for (const variant of independent) {
    if (variant.topName === agreed) continue;
    if ((variant.topScore ?? 0) >= TITLE_ONLY_MIN) {
      return { accepted: false, consensusCount, name: agreed, reason: 'competing-strong' };
    }
    return { accepted: false, consensusCount, name: agreed, reason: 'variants-disagree' };
  }

  const best = [...agreedList].sort((a, b) => (b.topScore ?? 0) - (a.topScore ?? 0))[0];
  if ((best.margin ?? 0) < STRONG_FUZZY_MIN_MARGIN) {
    return { accepted: false, consensusCount, name: agreed, reason: 'thin-margin' };
  }
  for (const variant of agreedList) {
    const label = variant.topName ?? agreed;
    if (!titlePreservedEnough(variant.ocrText, label)) {
      return { accepted: false, consensusCount, name: agreed, reason: 'generic-fragment' };
    }
    const token = variant.tokenSimilarity ?? tokenWeightedSimilarity(variant.ocrText, label);
    if (token < STRONG_FUZZY_MIN_TOKEN) {
      return { accepted: false, consensusCount, name: agreed, reason: 'implausible-edit' };
    }
  }
  return { accepted: true, consensusCount, name: agreed, reason: 'strong-fuzzy' };
};

const finish = (args: {
  decision: TitleDecodeDecisionKind;
  fallbackOcrMs: number;
  firstOcrMs: number;
  nameIndex: CardNameIndex | null;
  reason: string;
  variants: TitleVariantRecord[];
  winner?: TitleVariantRecord | null;
}): TitleDecodeResult => {
  const winner = args.winner ?? null;
  const candidates =
    winner?.ocrText && args.nameIndex
      ? matchName(winner.ocrText, args.nameIndex, { limit: TITLE_TOP_N })
      : [];
  const fuzzy = decideStrongFuzzyTitle(args.variants);
  return {
    consensusCount: args.decision === 'exact-title' ? (winner?.topName ? 1 : 0) : fuzzy.consensusCount,
    decision: args.decision,
    fallbackOcrMs: args.fallbackOcrMs,
    fallbackUsed: args.fallbackOcrMs > 0 || args.variants.length > 1,
    firstOcrMs: args.firstOcrMs,
    matchName: winner?.topName ?? null,
    matchScore: winner?.topScore ?? null,
    ocrText: winner?.ocrText ?? args.variants.find(v => v.ocrText)?.ocrText ?? '',
    reason: args.reason,
    titleCandidates: candidates,
    titleMargin: winner?.margin ?? null,
    titleSecondScore: winner?.secondScore ?? null,
    titleTopScore: winner?.topScore ?? null,
    variants: args.variants,
  };
};

const exactWinner = (variant: TitleVariantRecord): boolean =>
  Boolean(variant.topName && (variant.topScore ?? 0) >= TITLE_ONLY_MIN);

/** Host-side path: Samsung OCR strings already captured. No ML Kit. */
export const decodeRecordedTitleVariants = (
  readings: readonly { source?: string; text: string }[],
  index: CardNameIndex,
): TitleDecodeResult => {
  const variants = readings.map((reading, i) =>
    recordTitleVariant(reading.source ?? `recorded-${i + 1}`, reading.text, index, 0),
  );
  if (!variants.some(v => v.ocrText.trim())) {
    return finish({
      decision: 'ocr-empty',
      fallbackOcrMs: 0,
      firstOcrMs: 0,
      nameIndex: index,
      reason: 'ocr-empty',
      variants,
    });
  }
  if (variants[0] && exactWinner(variants[0])) {
    return finish({
      decision: 'exact-title',
      fallbackOcrMs: 0,
      firstOcrMs: 0,
      nameIndex: index,
      reason: 'exact-title',
      variants,
      winner: variants[0],
    });
  }
  const fuzzy = decideStrongFuzzyTitle(variants);
  if (fuzzy.accepted && fuzzy.name) {
    const winner = [...variants]
      .filter(v => v.topName === fuzzy.name)
      .sort((a, b) => (b.topScore ?? 0) - (a.topScore ?? 0))[0];
    return finish({
      decision: 'strong-fuzzy',
      fallbackOcrMs: 0,
      firstOcrMs: 0,
      nameIndex: index,
      reason: fuzzy.reason,
      variants,
      winner,
    });
  }
  const best = [...variants].sort((a, b) => (b.topScore ?? 0) - (a.topScore ?? 0))[0];
  return finish({
    decision: 'ambiguous',
    fallbackOcrMs: 0,
    firstOcrMs: 0,
    nameIndex: index,
    reason: fuzzy.reason,
    variants,
    winner: best?.topName ? best : null,
  });
};

export const runBoundedTitleDecode = async (args: {
  nameIndex: CardNameIndex | null;
  ocr: TextRecognizer;
  profile: ScanProfile;
  titleRaw: ScanImage;
  warp: ScanImage;
}): Promise<TitleDecodeResult> => {
  const variants: TitleVariantRecord[] = [];
  const tFast = clock();
  const fast = await readTitle(args.warp, args.ocr, {
    profile: args.profile,
    keepCrops: true,
    fastPreprocess: true,
    stopAfterFirstTitle: true,
  });
  const firstOcrMs = clock() - tFast;
  const fastText = fast.readings[0]?.text ?? fast.name ?? fast.samples[0]?.rawText ?? '';
  variants.push(recordTitleVariant('title-fast', fastText, args.nameIndex, firstOcrMs));
  if (exactWinner(variants[0])) {
    return finish({
      decision: 'exact-title',
      fallbackOcrMs: 0,
      firstOcrMs,
      nameIndex: args.nameIndex,
      reason: 'exact-title',
      variants,
      winner: variants[0],
    });
  }

  let fallbackOcrMs = 0;
  if (args.nameIndex) {
    const tRaw = clock();
    const rawResult = await args.ocr.recognize(args.titleRaw, {
      mode: 'line',
      whitelist: TITLE_WHITELIST,
    });
    const rawMs = clock() - tRaw;
    fallbackOcrMs += rawMs;
    const rawText = tidyName(rawResult.text) ?? rawResult.text.trim();
    variants.push(recordTitleVariant('title-raw', rawText, args.nameIndex, rawMs));
    if (exactWinner(variants[1])) {
      return finish({
        decision: 'exact-title',
        fallbackOcrMs,
        firstOcrMs,
        nameIndex: args.nameIndex,
        reason: 'exact-title',
        variants,
        winner: variants[1],
      });
    }
    const afterTwo = decideStrongFuzzyTitle(variants);
    if (afterTwo.accepted && afterTwo.name) {
      const winner = [...variants]
        .filter(v => v.topName === afterTwo.name)
        .sort((a, b) => (b.topScore ?? 0) - (a.topScore ?? 0))[0];
      return finish({
        decision: 'strong-fuzzy',
        fallbackOcrMs,
        firstOcrMs,
        nameIndex: args.nameIndex,
        reason: afterTwo.reason,
        variants,
        winner,
      });
    }

    const tFull = clock();
    const full = await readTitle(args.warp, args.ocr, {
      profile: args.profile,
      keepCrops: true,
      fastPreprocess: false,
      stopAfterFirstTitle: true,
    });
    const fullMs = clock() - tFull;
    fallbackOcrMs += fullMs;
    const fullText = full.readings[0]?.text ?? full.name ?? '';
    variants.push(recordTitleVariant('title-full', fullText, args.nameIndex, fullMs));
    if (exactWinner(variants[variants.length - 1])) {
      return finish({
        decision: 'exact-title',
        fallbackOcrMs,
        firstOcrMs,
        nameIndex: args.nameIndex,
        reason: 'exact-title',
        variants,
        winner: variants[variants.length - 1],
      });
    }
  }

  const hasText = variants.some(v => v.ocrText.trim());
  if (!hasText) {
    return finish({
      decision: 'ocr-empty',
      fallbackOcrMs,
      firstOcrMs,
      nameIndex: args.nameIndex,
      reason: 'ocr-empty',
      variants,
    });
  }
  const fuzzy = decideStrongFuzzyTitle(variants);
  if (fuzzy.accepted && fuzzy.name) {
    const winner = [...variants]
      .filter(v => v.topName === fuzzy.name)
      .sort((a, b) => (b.topScore ?? 0) - (a.topScore ?? 0))[0];
    return finish({
      decision: 'strong-fuzzy',
      fallbackOcrMs,
      firstOcrMs,
      nameIndex: args.nameIndex,
      reason: fuzzy.reason,
      variants,
      winner,
    });
  }
  const best = [...variants].sort((a, b) => (b.topScore ?? 0) - (a.topScore ?? 0))[0];
  return finish({
    decision: 'ambiguous',
    fallbackOcrMs,
    firstOcrMs,
    nameIndex: args.nameIndex,
    reason: fuzzy.reason,
    variants,
    winner: best?.topName ? best : null,
  });
};

export const formatTitleDecodeReport = (decode: TitleDecodeResult): string => {
  const lines: string[] = [];
  decode.variants.forEach((variant, i) => {
    lines.push(`Variant ${i + 1} (${variant.source}):`);
    lines.push(`  OCR: ${variant.ocrText || '(empty)'}`);
    lines.push(`  top: ${variant.topName ?? 'none'}  score=${variant.topScore ?? 'n/a'}`);
    lines.push(`  #2: ${variant.secondName ?? 'none'}  score=${variant.secondScore ?? 'n/a'}`);
    lines.push(`  margin: ${variant.margin ?? 'n/a'}`);
    if (variant.tokenSimilarity != null) {
      lines.push(`  tokenSimilarity: ${variant.tokenSimilarity}`);
    }
  });
  lines.push(`Consensus: ${decode.consensusCount}`);
  lines.push(
    `Final decision: ${decode.decision === 'exact-title' || decode.decision === 'strong-fuzzy' ? 'identified' : 'ambiguous'} (${decode.reason})`,
  );
  lines.push(`first OCR: ${decode.firstOcrMs.toFixed(1)}ms`);
  lines.push(`fallback OCR: ${decode.fallbackOcrMs.toFixed(1)}ms`);
  lines.push(`fallback used: ${decode.fallbackUsed}`);
  return lines.join('\n');
};
