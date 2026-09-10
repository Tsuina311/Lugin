// Progressive recognition on one normalized card frame.
//
// Title OCR and artwork run independently. Strong title-only (or exceptional
// art-only) can surface oracle identity before the other channel finishes.
// Callable from the live session and from the offline eval harness.

import { createArtworkMatcher, type ArtworkMatcher } from '../artwork/match';
import { describeArtwork } from '../artwork/descriptors';
import type { ArtworkIndexData } from '../artwork/types';
import type { CardNameIndex, NameCandidate, Reading } from '../matchName';
import { matchReadings } from '../matchName';
import { TITLE_STRONG, TITLE_TOP_N, VISUAL_STRONG, VISUAL_TOP_N } from '../params';
import type { CollectorParts } from '../parseCollector';
import { mergePartsForScan } from '../parseCollector';
import { enhanceForOcr } from '../preprocess';
import {
  lookupPrinting,
  uniqueOracle,
  uniquePrinting,
  type PrintingIndex,
  type PrintingLookupHit,
} from '../printing/index';
import {
  extractFooterEvidence,
  lookupPrintingTitleRestricted,
  type FooterEvidence,
} from '../printing/footerEvidence';
import {
  applyTypeEvidenceScores,
  matchTypeReading,
  type TypeIndex,
} from '../typeIndex/index';
import {
  ARTWORK_ONLY_VISUAL_MARGIN,
  fuseEvidence,
  type CandidateEvidence,
  type FusedResult,
} from '../ranking/fuse';
import { readCollector, readTitle, readTypeLine } from '../readCard';
import { profileForCard, type ScanProfile } from '../regions';
import {
  idfForPool,
  lookupTextEntry,
  textEvidenceScore,
  tokenizeScanText,
  type TextIndexData,
} from '../text/evidence';
import type { TextRecognizer } from '../textRecognizer';
import {
  emptyTemporal,
  pushTemporal,
  temporalSupportFor,
  type TemporalState,
} from '../temporal/consensus';
import {
  buildTitleOcrDebug,
  captureTitleOcrBuffers,
  consumeOcrDebugMatrixSlot,
  runOcrDebugMatrix,
  type TitleOcrDebug,
} from '../ocrDebug';
import { cropImage, type ScanImage } from '../types';

export type EarlyIdentityReason =
  | 'title-only'
  | 'art-only'
  | 'dual'
  | 'footer-printing'
  | 'title-footer'
  | null;

export type ArtSearchMode = 'global' | 'restricted' | 'skipped';

export interface RecognizeDeps {
  artwork?: ArtworkMatcher | null;
  artworkIndex?: ArtworkIndexData | null;
  nameIndex: CardNameIndex | null;
  /** Local set+collector → printings (offline). */
  printingIndex?: PrintingIndex | null;
  /** Compact type-line index (supporting evidence). */
  typeIndex?: TypeIndex | null;
  /** Optional OCR — when omitted, only artwork (if any) runs. */
  ocr?: TextRecognizer | null;
  /**
   * Prefer this over reading `ocr` once (e.g. after `{...deps}` spread on a
   * Proxy). Live mobile wires this to `getOrCreateOcrRecognizer`.
   */
  resolveOcr?: () => TextRecognizer | null;
  textIndex?: TextIndexData | null;
  /**
   * Fired when a provisional identity/printing is ready before all channels
   * finish (title-only, footer-printing, dual, etc.).
   */
  onEarlyIdentity?: (result: RecognizeResult) => void;
  /** Optional per-pass recognize options (mobile perf baseline). */
  recognizeOptions?: () => RecognizeOptions;
}

export interface RecognizeOptions {
  /** Prefer these set codes when ranking printings (soft). */
  preferSets?: readonly string[];
  profile?: ScanProfile;
  /** Skip OCR entirely (art-only mode / eval). */
  skipOcr?: boolean;
  /** Force text-box OCR even when art+title are confident. */
  wantText?: boolean;
  /** Force footer OCR (always on by default when OCR present). */
  wantFooter?: boolean;
  /** Skip footer OCR. */
  skipFooter?: boolean;
  /** Force type-line OCR. */
  wantTypeLine?: boolean;
  /** Skip type-line OCR entirely (perf baseline). */
  skipTypeLine?: boolean;
  /** Eval: skip artwork matching. */
  skipArtwork?: boolean;
  /** Test/eval: delay artwork so title can win the race. */
  artworkDelayMs?: number;
  /** Test/eval: delay footer. */
  footerDelayMs?: number;
  /** Test/eval: delay title. */
  titleDelayMs?: number;
  /**
   * Debug: run the one-shot raw/enhanced/full/legacy OCR matrix.
   * Consumed at most once per process — never the production hot path.
   */
  runOcrDebugMatrix?: boolean;
  /** Debug: old base64 OCR bridge for a same-image comparison. */
  legacyOcr?: TextRecognizer | null;
  /**
   * Title preprocess. Live scanner defaults to fast.
   * Known-good baseline (`1dd4932`) used full `enhanceForOcr` (false).
   */
  fastPreprocess?: boolean;
  /**
   * Stop after the first tidied title framing. Live scanner defaults to true.
   * Known-good baseline ran every title framing (false).
   */
  stopAfterFirstTitle?: boolean;
}

export interface RecognizeTimings {
  [key: string]: number | EarlyIdentityReason | string | undefined;
  artworkDescriptorMs?: number;
  artworkMatcherMs?: number;
  artworkMs?: number;
  titleMs?: number;
  parallelMs?: number;
  textMs?: number;
  typeLineMs?: number;
  footerMs?: number;
  footerLookupMs?: number;
  totalMs?: number;
  titleDoneAt?: number;
  artDoneAt?: number;
  footerDoneAt?: number;
  earlyIdentityAt?: number;
  printingResolvedAt?: number;
  earlyReason?: EarlyIdentityReason;
  artMode?: ArtSearchMode;
  /** OCR scheduling: title-first | parallel | atlas */
  ocrSchedule?: string;
  titleCropW?: number;
  titleCropH?: number;
  titleBytes?: number;
  titleMlkitMs?: number;
  titleNativeMs?: number;
  titleEncodeMs?: number;
  titleJsBridgeMs?: number;
  titleTransport?: string;
  footerCropW?: number;
  footerCropH?: number;
  footerBytes?: number;
  footerMlkitMs?: number;
  footerNativeMs?: number;
  footerTransport?: string;
}

export interface RecognizeResult {
  fused: FusedResult;
  profile: ScanProfile;
  readings: Reading[];
  titleCandidates: NameCandidate[];
  collector?: CollectorParts;
  /** Local PrintingIndex hit for the footer parse. */
  printingLookup?: PrintingLookupHit | null;
  /** Title vs footer name conflict. */
  titleFooterConflict?: boolean;
  artMode?: ArtSearchMode;
  visualTop: ReturnType<ArtworkMatcher['findCandidates']>;
  timings: RecognizeTimings;
  /** True when identity was accepted without waiting for all stages. */
  earlyIdentity?: boolean;
  /** How provisional identity was first surfaced (if at all). */
  earlyReason?: EarlyIdentityReason;
  /** Exact title-OCR buffers + metadata for the debug inbox. */
  ocrDebug?: TitleOcrDebug;
}

const now = (): number =>
  typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

const runArtwork = (
  card: ScanImage,
  profile: ScanProfile,
  matcher: ArtworkMatcher,
  skip: boolean,
): {
  visualTop: ReturnType<ArtworkMatcher['findCandidates']>;
  artworkDescriptorMs: number;
  artworkMatcherMs: number;
  artworkMs: number;
} => {
  if (skip) {
    return { visualTop: [], artworkDescriptorMs: 0, artworkMatcherMs: 0, artworkMs: 0 };
  }
  const t0 = now();
  const artCrop = cropImage(card, profile.artwork);
  const descriptor = describeArtwork(artCrop);
  const artworkDescriptorMs = now() - t0;
  const matchAt = now();
  const visualTop = matcher.findCandidates(descriptor, VISUAL_TOP_N);
  const artworkMatcherMs = now() - matchAt;
  return {
    visualTop,
    artworkDescriptorMs,
    artworkMatcherMs,
    artworkMs: now() - t0,
  };
};

const runTitle = async (
  card: ScanImage,
  profile: ScanProfile,
  deps: RecognizeDeps,
  options: RecognizeOptions,
  skip: boolean,
): Promise<{
  ocrDebug: TitleOcrDebug;
  readings: Reading[];
  titleCandidates: NameCandidate[];
  titleMs: number;
  ocrEngineSamples: OcrSampleLite[];
}> => {
  const buffers = captureTitleOcrBuffers(card);
  const ocrEngine = deps.resolveOcr?.() ?? deps.ocr ?? null;
  if (skip || !ocrEngine) {
    return {
      ocrDebug: buildTitleOcrDebug({
        card,
        enhanced: buffers.enhanced,
        invoked: false,
        ocrSkippedReason: skip ? 'skipOcr' : 'no-ocr',
        raw: buffers.raw,
        rect: buffers.rect,
      }),
      readings: [],
      titleCandidates: [],
      titleMs: 0,
      ocrEngineSamples: [],
    };
  }
  const t0 = now();
  let firstPass: {
    enhancedCrop: ScanImage;
    rawCrop: ScanImage;
    cropRect: typeof buffers.rect;
  } | null = null;
  let firstResult: Awaited<ReturnType<TextRecognizer['recognize']>> | null = null;
  const ocr: TextRecognizer = {
    recognize: async (image, opts) => {
      const result = await ocrEngine.recognize(image, opts);
      if (!firstResult) firstResult = result;
      return result;
    },
  };
  const title = await readTitle(card, ocr, {
    profile,
    stopAfterFirstTitle: options.stopAfterFirstTitle !== false,
    fastPreprocess: options.fastPreprocess !== false,
    onTitlePass: info => {
      if (!firstPass) {
        firstPass = {
          cropRect: info.cropRect,
          enhancedCrop: info.enhancedCrop,
          rawCrop: info.rawCrop,
        };
      }
    },
  });
  const raw = firstPass?.rawCrop ?? buffers.raw;
  const enhanced = firstPass?.enhancedCrop ?? buffers.enhanced;
  const rect = firstPass?.cropRect ?? buffers.rect;
  let matrix = null;
  if (options.runOcrDebugMatrix === true && consumeOcrDebugMatrixSlot()) {
    matrix = await runOcrDebugMatrix({
      card,
      enhancedTitle: enhanced,
      legacyRecognize: options.legacyOcr ?? null,
      rawTitle: raw,
      recognize: deps.ocr,
    });
  }
  const titleCandidates = deps.nameIndex
    ? matchReadings(title.readings, deps.nameIndex, { limit: TITLE_TOP_N })
    : [];
  return {
    ocrDebug: buildTitleOcrDebug({
      card,
      completedAt: now(),
      enhanced,
      invoked: true,
      matrix,
      ocrSkippedReason: deps.nameIndex ? null : 'no-name-index',
      raw,
      rect,
      result: firstResult,
      submittedAt: t0,
    }),
    readings: title.readings,
    titleCandidates,
    titleMs: now() - t0,
    ocrEngineSamples: title.samples.map(s => ({
      region: s.region,
      ms: s.ms,
      cropWidth: s.cropWidth,
      cropHeight: s.cropHeight,
      engineBytes: s.engineBytes,
      engineTransport: s.engineTransport,
      engineMlkitMs: s.engineMlkitMs,
      engineNativeMs: s.engineNativeMs,
      engineEncodeMs: s.engineEncodeMs,
      engineJsBridgeMs: s.engineJsBridgeMs,
    })),
  };
};

type OcrSampleLite = {
  region: string;
  ms: number;
  cropWidth: number;
  cropHeight: number;
  engineBytes?: number;
  engineTransport?: string;
  engineMlkitMs?: number;
  engineNativeMs?: number;
  engineEncodeMs?: number;
  engineJsBridgeMs?: number;
};

const mergeCandidates = (
  visualTop: ReturnType<ArtworkMatcher['findCandidates']>,
  titleCandidates: NameCandidate[],
  temporal: TemporalState,
): Map<string, CandidateEvidence> => {
  const byOracle = new Map<string, CandidateEvidence>();
  const touch = (oracleId: string, name: string): CandidateEvidence => {
    let row = byOracle.get(oracleId);
    if (!row) {
      row = { name, oracleId, possiblePrintingIds: [] };
      byOracle.set(oracleId, row);
    }
    return row;
  };

  for (const v of visualTop) {
    const row = touch(v.oracleId, v.name);
    row.visualScore = Math.max(row.visualScore ?? 0, v.visualScore);
    if (v.scryfallId && !row.possiblePrintingIds.includes(v.scryfallId)) {
      row.possiblePrintingIds.push(v.scryfallId);
    }
  }
  for (const c of titleCandidates) {
    // Prefer merging onto a visual row with the same English name so art + title
    // reinforce one oracle id. Fall back to a name-keyed stub when art missed.
    const visualSame = [...byOracle.values()].find(r => r.name === c.name);
    if (visualSame) {
      visualSame.titleScore = Math.max(visualSame.titleScore ?? 0, c.score);
      continue;
    }
    const oracleId = `name:${c.name}`;
    const row = touch(oracleId, c.name);
    row.titleScore = Math.max(row.titleScore ?? 0, c.score);
  }

  for (const row of byOracle.values()) {
    row.temporalSupport = temporalSupportFor(temporal, row.oracleId);
  }
  return byOracle;
};

const provisionalResult = (
  fused: FusedResult,
  profile: ScanProfile,
  readings: Reading[],
  titleCandidates: NameCandidate[],
  visualTop: ReturnType<ArtworkMatcher['findCandidates']>,
  timings: RecognizeTimings,
  earlyReason: EarlyIdentityReason,
  extras: Partial<RecognizeResult> = {},
): RecognizeResult => ({
  earlyIdentity: true,
  earlyReason,
  fused,
  profile,
  readings,
  timings: { ...timings, earlyReason },
  titleCandidates,
  visualTop,
  ...extras,
});

/** Dual evidence (strong title + agreeing art) may accept on one observation. */
export const isStrongDualEvidence = (fused: FusedResult): boolean => {
  const top = fused.candidates[0];
  if (!top) return false;
  const title = top.titleScore ?? 0;
  const visual = top.visualScore ?? 0;
  return title >= TITLE_STRONG && visual >= VISUAL_STRONG * 0.9 && fused.margin >= 0.08;
};

/** Near-exact title alone may identify the oracle (printing stays pending). */
export const isStrongTitleOnly = (fused: FusedResult): boolean => {
  const byTitle = fused.candidates
    .filter(r => (r.titleScore ?? 0) > 0)
    .sort((a, b) => (b.titleScore ?? 0) - (a.titleScore ?? 0));
  const top = byTitle[0];
  const second = byTitle[1];
  if (!top?.titleScore) return false;
  const titleMargin = top.titleScore - (second?.titleScore ?? 0);
  // Accept when title is sticky even if fused #1 was art (sticky fusion promotes).
  if (top.titleScore >= 0.94 && titleMargin >= 0.2) return true;
  if (
    fused.card &&
    fused.card.name === top.name &&
    top.titleScore >= TITLE_STRONG &&
    titleMargin >= 0.12
  ) {
    return true;
  }
  return false;
};

/**
 * Exceptionally strong visual-only leader — same bar as artwork-only accept
 * (do not weaken weak-cluster rejection).
 */
export const isStrongArtOnly = (fused: FusedResult): boolean => {
  const top = fused.candidates[0];
  const second = fused.candidates[1];
  if (!top?.visualScore) return false;
  if (fused.status !== 'identified' && fused.status !== 'printing-ambiguous') return false;
  const visualMargin = top.visualScore - (second?.visualScore ?? 0);
  return top.visualScore >= VISUAL_STRONG && visualMargin >= ARTWORK_ONLY_VISUAL_MARGIN;
};

/** Footer PrintingIndex uniquely resolved oracle (+ optionally exact scryfall id). */
export const isStrongFooterPrinting = (fused: FusedResult): boolean => {
  if (!fused.printing) return false;
  return (
    fused.status === 'identified' ||
    (fused.status === 'printing-ambiguous' && Boolean(fused.card))
  );
};

const applyPrintingHit = (
  byOracle: Map<string, CandidateEvidence>,
  hit: PrintingLookupHit,
): FusedResult['printing'] | undefined => {
  const uniqPrint = uniquePrinting(hit);
  const uniqOra = uniqueOracle(hit);
  const primary = uniqPrint ?? uniqOra;
  const touch = (oracleId: string, name: string): CandidateEvidence => {
    // Prefer existing visual/title row with same English name.
    const byName = [...byOracle.values()].find(r => r.name === name);
    if (byName) return byName;
    let row = byOracle.get(oracleId);
    if (!row) {
      row = { name, oracleId, possiblePrintingIds: [] };
      byOracle.set(oracleId, row);
    }
    return row;
  };
  if (!primary) {
    for (const c of hit.candidates) {
      const row = touch(c.oracleId, c.name);
      row.footerScore = Math.max(row.footerScore ?? 0, 0.55);
      if (!row.possiblePrintingIds.includes(c.scryfallId)) {
        row.possiblePrintingIds = [...row.possiblePrintingIds, c.scryfallId];
      }
    }
    return undefined;
  }
  const row = touch(primary.oracleId, primary.name);
  row.footerScore = Math.max(row.footerScore ?? 0, 0.98);
  row.possiblePrintingIds = uniqPrint
    ? [primary.scryfallId]
    : [...new Set(hit.candidates.map(c => c.scryfallId))];
  return {
    collectorNumber: primary.collectorNumber,
    confidence: uniqPrint ? 0.99 : 0.9,
    finishes: primary.finishes,
    lang: primary.lang,
    name: primary.name,
    oracleId: row.oracleId,
    scryfallId: primary.scryfallId,
    setCode: primary.setCode,
  };
};

const attachPrinting = (fused: FusedResult, printing?: FusedResult['printing']): FusedResult => {
  if (!printing) return fused;
  const status =
    printing.confidence >= 0.95 && fused.card
      ? ('identified' as const)
      : fused.card
        ? fused.status === 'insufficient-confidence'
          ? ('printing-ambiguous' as const)
          : fused.status
        : ('printing-ambiguous' as const);
  return {
    ...fused,
    card: fused.card ?? {
      confidence: printing.confidence,
      name: printing.name,
      oracleId: printing.oracleId,
    },
    printing,
    status:
      fused.card && printing.confidence >= 0.95 && printing.scryfallId
        ? 'identified'
        : status === 'identified' && !fused.card
          ? 'printing-ambiguous'
          : fused.status === 'card-ambiguous' || fused.status === 'insufficient-confidence'
            ? 'printing-ambiguous'
            : fused.candidates[0]?.possiblePrintingIds.length === 1
              ? 'identified'
              : 'printing-ambiguous',
  };
};

export const recognizeCard = async (
  card: ScanImage,
  deps: RecognizeDeps,
  options: RecognizeOptions = {},
  temporal: TemporalState = emptyTemporal(),
): Promise<{ result: RecognizeResult; temporal: TemporalState }> => {
  const timings: RecognizeTimings = { ocrSchedule: 'title-first' };
  const profile = options.profile ?? profileForCard(card.width, card.height);
  const matcher = deps.artwork ?? createArtworkMatcher(deps.artworkIndex ?? null);
  const totalAt = now();

  type ArtOut = ReturnType<typeof runArtwork> & { mode: ArtSearchMode };
  type TitleOut = Awaited<ReturnType<typeof runTitle>>;
  type FooterOut = {
    collector: CollectorParts;
    evidence: FooterEvidence;
    hit: PrintingLookupHit | null;
    lookupMs: number;
    ms: number;
  };

  let artOut: ArtOut | null = null;
  let titleOut: TitleOut | null = null;
  let footerOut: FooterOut | null = null;
  let earlyReason: EarlyIdentityReason = null;
  let earlyFired = false;
  let printingResolvedAt: number | undefined;
  let titleFooterConflict = false;
  let lastPrinting: FusedResult['printing'] | undefined;

  const refineFooterHit = (): void => {
    if (!footerOut || !deps.printingIndex) return;
    const title = titleOut?.titleCandidates[0];
    if (!title || (title.score ?? 0) < 0.82) return;
    const restricted = lookupPrintingTitleRestricted(deps.printingIndex, {
      evidence: footerOut.evidence,
      titleName: title.name,
    });
    if (restricted?.candidates?.length) {
      footerOut = { ...footerOut, hit: restricted };
    }
  };

  const fireEarly = (
    reason: Exclude<EarlyIdentityReason, null>,
    fused: FusedResult,
  ) => {
    if (earlyFired) {
      const prior = earlyReason;
      const canUpgrade =
        (prior === 'title-only' || prior === 'art-only' || prior === 'dual') &&
        (reason === 'footer-printing' || reason === 'title-footer');
      if (!canUpgrade) return;
    }
    if (fused.status !== 'identified' && fused.status !== 'printing-ambiguous') return;
    const first = !earlyFired;
    earlyFired = true;
    earlyReason = reason;
    if (first) {
      timings.earlyIdentityAt = now() - totalAt;
      timings.earlyReason = reason;
    }
    if (fused.printing && printingResolvedAt == null) {
      printingResolvedAt = now() - totalAt;
      timings.printingResolvedAt = printingResolvedAt;
    }
    deps.onEarlyIdentity?.(
      provisionalResult(
        fused,
        profile,
        titleOut?.readings ?? [],
        titleOut?.titleCandidates ?? [],
        artOut?.visualTop ?? [],
        timings,
        reason,
        {
          collector: footerOut ? footerOut.collector : undefined,
          printingLookup: footerOut ? footerOut.hit : null,
          titleFooterConflict,
          artMode: artOut ? artOut.mode : undefined,
        },
      ),
    );
  };

  const fusePartial = (): FusedResult => {
    const byOracle = mergeCandidates(
      artOut?.visualTop ?? [],
      titleOut?.titleCandidates ?? [],
      temporal,
    );
    let printing: FusedResult['printing'] | undefined;
    if (footerOut?.hit) {
      printing = applyPrintingHit(byOracle, footerOut.hit);
      lastPrinting = printing ?? lastPrinting;
    }
    // Title ↔ footer conflict: same set/number family must agree on name.
    titleFooterConflict = false;
    if (printing && titleOut?.titleCandidates[0]) {
      const tName = titleOut.titleCandidates[0].name.toLowerCase();
      if (tName && printing.name.toLowerCase() !== tName) {
        const titleStrong = (titleOut.titleCandidates[0].score ?? 0) >= 0.9;
        if (titleStrong) {
          titleFooterConflict = true;
        }
      }
    }
    let fused = fuseEvidence([...byOracle.values()], {
      artworkOnly: !deps.ocr || options.skipOcr === true,
      allowTitleOnly: Boolean(deps.ocr) && options.skipOcr !== true,
      allowStrongDual: true,
    });
    if (titleFooterConflict) {
      // Do not identify — keep both candidate sets.
      fused = {
        ...fused,
        card: undefined,
        printing: undefined,
        status: 'card-ambiguous',
      };
      return fused;
    }
    fused = attachPrinting(fused, printing ?? lastPrinting);
    // Title + footer agree → extremely high confidence.
    if (
      printing &&
      titleOut?.titleCandidates[0] &&
      titleOut.titleCandidates[0].name.toLowerCase() === printing.name.toLowerCase() &&
      (titleOut.titleCandidates[0].score ?? 0) >= 0.9
    ) {
      fused = {
        ...fused,
        card: {
          confidence: Math.max(fused.card?.confidence ?? 0, 0.99),
          name: printing.name,
          oracleId: printing.oracleId,
        },
        printing: { ...printing, confidence: Math.max(printing.confidence, 0.99) },
        status: printing.confidence >= 0.95 ? 'identified' : 'printing-ambiguous',
      };
    }
    return fused;
  };

  const tryEarlyFromPartial = () => {
    const fused = fusePartial();

    if (titleFooterConflict) return;

    if (
      footerOut?.hit &&
      fused.printing &&
      fused.card &&
      !titleOut
    ) {
      if (isStrongFooterPrinting(fused)) fireEarly('footer-printing', fused);
    }

    if (footerOut?.hit && fused.printing && titleOut && fused.card) {
      fireEarly('title-footer', fused);
      return;
    }

    if (earlyFired && earlyReason !== 'title-only') return;

    if (titleOut && !artOut && !footerOut?.hit) {
      if (isStrongTitleOnly(fused)) fireEarly('title-only', fused);
      return;
    }

    if (artOut && !titleOut && !footerOut?.hit) {
      if (isStrongArtOnly(fused)) fireEarly('art-only', fused);
      return;
    }

    if (titleOut && artOut && !footerOut?.hit) {
      if (isStrongDualEvidence(fused)) fireEarly('dual', fused);
      else if (isStrongTitleOnly(fused)) fireEarly('title-only', fused);
      // Never early-fire art-only when a sticky title already identified the card.
      else if (!fused.card && isStrongArtOnly(fused)) fireEarly('art-only', fused);
    }
  };

  const restrictFromEvidence = (): {
    illustrationIds?: string[];
    oracleIds?: string[];
    scryfallIds?: string[];
  } | null => {
    if (lastPrinting) {
      return {
        oracleIds: [lastPrinting.oracleId.replace(/^oracle:/, '')],
        scryfallIds: [lastPrinting.scryfallId],
        illustrationIds: footerOut?.hit?.candidates
          .map(c => c.illustrationId)
          .filter((x): x is string => Boolean(x)),
      };
    }
    if (titleOut?.titleCandidates[0] && titleOut.titleCandidates[0].score >= 0.94) {
      // Restrict by name via oracle from name index isn't stored on NameCandidate —
      // use name match against art after global if needed. Skip restrict.
      return null;
    }
    return null;
  };

  // --- channels: title first (MODE A), then footer; art parallel with title ---
  const titlePromise: Promise<TitleOut> = (async (): Promise<TitleOut> => {
    if (options.titleDelayMs && options.titleDelayMs > 0) await sleep(options.titleDelayMs);
    const out = await runTitle(card, profile, deps, options, options.skipOcr === true);
    titleOut = out;
    timings.titleMs = out.titleMs;
    timings.titleDoneAt = now() - totalAt;
    if (out.ocrEngineSamples[0]) {
      const s = out.ocrEngineSamples[0];
      timings.titleCropW = s.cropWidth;
      timings.titleCropH = s.cropHeight;
      timings.titleBytes = s.engineBytes;
      timings.titleMlkitMs = s.engineMlkitMs;
      timings.titleNativeMs = s.engineNativeMs;
      timings.titleEncodeMs = s.engineEncodeMs;
      timings.titleJsBridgeMs = s.engineJsBridgeMs;
      timings.titleTransport = s.engineTransport;
    }
    tryEarlyFromPartial();
    return out;
  })();

  const footerPromise = (async (): Promise<FooterOut | null> => {
    if (options.skipOcr || options.skipFooter || !deps.ocr) return null;
    // Wait for title so ML Kit isn't contended and identity can publish first.
    await titlePromise;
    refineFooterHit();
    if (options.footerDelayMs && options.footerDelayMs > 0) await sleep(options.footerDelayMs);
    const t0 = now();
    const { parts, samples } = await readCollector(
      card,
      deps.ocr,
      (into, incoming) => mergePartsForScan(into, incoming, { nameLocked: true }),
      { fastPreprocess: true, footerPrimaryOnly: true },
    );
    const rawBlob = [parts.raw, ...samples.map(s => s.rawText)].filter(Boolean).join('\n');
    const evidence = extractFooterEvidence(rawBlob);
    const collector: CollectorParts = {
      ...parts,
      collectorNumber: parts.collectorNumber ?? evidence.collectorCandidates[0]?.value,
      setCode: parts.setCode ?? evidence.setCodeCandidates[0]?.value,
      raw: evidence.rawText || parts.raw,
    };
    const tLookup = now();
    let hit = lookupPrinting(deps.printingIndex, collector);
    const titleSnap = titleOut as {
      titleCandidates: NameCandidate[];
    } | null;
    const title = titleSnap?.titleCandidates[0];
    if ((!hit || !uniquePrinting(hit)) && title && (title.score ?? 0) >= 0.82) {
      hit =
        lookupPrintingTitleRestricted(deps.printingIndex, {
          evidence,
          titleName: title.name,
        }) ?? hit;
    }
    const out: FooterOut = {
      collector,
      evidence,
      hit,
      lookupMs: now() - tLookup,
      ms: now() - t0,
    };
    footerOut = out;
    timings.footerMs = out.ms;
    timings.footerLookupMs = out.lookupMs;
    timings.footerDoneAt = now() - totalAt;
    if (samples[0]) {
      timings.footerCropW = samples[0].cropWidth;
      timings.footerCropH = samples[0].cropHeight;
      timings.footerBytes = samples.reduce((sum, s) => sum + (s.engineBytes ?? 0), 0);
      timings.footerMlkitMs = samples.reduce((sum, s) => sum + (s.engineMlkitMs ?? 0), 0);
      timings.footerNativeMs = samples.reduce((sum, s) => sum + (s.engineNativeMs ?? 0), 0);
      timings.footerTransport = samples[0].engineTransport;
    }
    tryEarlyFromPartial();
    return out;
  })();

  const artPromise = (async (): Promise<ArtOut> => {
    if (options.artworkDelayMs && options.artworkDelayMs > 0) {
      await sleep(options.artworkDelayMs);
    }
    if (options.skipArtwork === true) {
      const empty = {
        artworkDescriptorMs: 0,
        artworkMatcherMs: 0,
        artworkMs: 0,
        visualTop: [] as ReturnType<ArtworkMatcher['findCandidates']>,
        mode: 'skipped' as ArtSearchMode,
      };
      artOut = empty;
      timings.artDoneAt = now() - totalAt;
      timings.artMode = 'skipped';
      tryEarlyFromPartial();
      return empty;
    }
    // Brief wait for title restrict signal only — never gate art on footer OCR.
    const raceMs = 40;
    await Promise.race([titlePromise, sleep(raceMs)]);
    const restrict = restrictFromEvidence();
    const t0 = now();
    const artCrop = cropImage(card, profile.artwork);
    const tDesc = now();
    const descriptor = describeArtwork(artCrop);
    const descriptorMs = now() - tDesc;
    const tMatch = now();
    let visualTop: ReturnType<ArtworkMatcher['findCandidates']>;
    let mode: ArtSearchMode = 'global';
    if (restrict && matcher.findCandidatesRestricted) {
      visualTop = matcher.findCandidatesRestricted(descriptor, restrict, VISUAL_TOP_N);
      mode = 'restricted';
      // If restricted pool is empty / weak, fall back to global.
      if (!visualTop.length || (visualTop[0]?.visualScore ?? 0) < 0.5) {
        visualTop = matcher.findCandidates(descriptor, VISUAL_TOP_N);
        mode = 'global';
      }
    } else {
      visualTop = matcher.findCandidates(descriptor, VISUAL_TOP_N);
    }
    const out: ArtOut = {
      artworkDescriptorMs: descriptorMs,
      artworkMatcherMs: now() - tMatch,
      artworkMs: now() - t0,
      visualTop,
      mode,
    };
    artOut = out;
    timings.artworkDescriptorMs = out.artworkDescriptorMs;
    timings.artworkMatcherMs = out.artworkMatcherMs;
    timings.artworkMs = out.artworkMs;
    timings.artDoneAt = now() - totalAt;
    timings.artMode = mode;
    tryEarlyFromPartial();
    return out;
  })();

  await Promise.all([artPromise, titlePromise, footerPromise]);
  timings.parallelMs = now() - totalAt;

  // Async channel writes aren't narrowed by tsc — assert after join.
  const finalArt = artOut as unknown as ArtOut;
  const finalTitle = titleOut as unknown as TitleOut;
  const finalFooter = footerOut as unknown as FooterOut | null;

  const visualTop = finalArt.visualTop;
  const readings = finalTitle.readings;
  const titleCandidates = finalTitle.titleCandidates;
  const collector = finalFooter?.collector;

  let fused = fusePartial();

  let earlyIdentity =
    fused.status === 'identified' || fused.status === 'printing-ambiguous'
      ? Boolean(earlyReason) ||
        isStrongDualEvidence(fused) ||
        isStrongTitleOnly(fused) ||
        isStrongFooterPrinting(fused)
      : false;

  const identitySolved =
    !titleFooterConflict &&
    (fused.status === 'identified' || fused.status === 'printing-ambiguous');

  let byOracle = mergeCandidates(visualTop, titleCandidates, temporal);
  if (finalFooter?.hit) applyPrintingHit(byOracle, finalFooter.hit);

  const needText =
    !identitySolved &&
    (options.wantText ||
      fused.status === 'card-ambiguous' ||
      fused.status === 'insufficient-confidence');

  if (needText && !options.skipOcr && deps.ocr && deps.textIndex?.entries?.length) {
    const t0 = now();
    const textCrop = cropImage(card, profile.textBox);
    const prepared = enhanceForOcr(textCrop);
    const ocr = await deps.ocr.recognize(prepared, { mode: 'block' });
    const tokens = tokenizeScanText(ocr.text);
    const pool = fused.candidates
      .slice(0, 8)
      .map(c => lookupTextEntry(deps.textIndex!, c.oracleId.replace(/^oracle:/, '')))
      .filter((e): e is NonNullable<typeof e> => !!e);
    const byName = new Map(deps.textIndex.entries.map(e => [e.name, e]));
    const idf = idfForPool(
      pool.length
        ? pool
        : (fused.candidates
            .slice(0, 8)
            .map(c => byName.get(c.name))
            .filter(Boolean) as typeof pool),
    );
    for (const c of fused.candidates.slice(0, 8)) {
      const entry =
        lookupTextEntry(deps.textIndex, c.oracleId.replace(/^oracle:/, '')) ?? byName.get(c.name);
      if (!entry) continue;
      const row = byOracle.get(c.oracleId) ?? {
        name: c.name,
        oracleId: c.oracleId,
        possiblePrintingIds: [...(c.possiblePrintingIds ?? [])],
      };
      row.textScore = textEvidenceScore(tokens, entry.tokens, idf);
      byOracle.set(c.oracleId, row);
    }
    fused = fuseEvidence(
      [...byOracle.values()].map(r => ({
        ...r,
        temporalSupport: temporalSupportFor(temporal, r.oracleId),
      })),
      { allowTitleOnly: true, allowStrongDual: true },
    );
    fused = attachPrinting(fused, lastPrinting);
    timings.textMs = now() - t0;
  }

  const needType =
    !identitySolved &&
    (options.wantTypeLine ||
      fused.status === 'card-ambiguous' ||
      fused.status === 'insufficient-confidence');

  if (
    needType &&
    !options.skipOcr &&
    !options.skipTypeLine &&
    deps.ocr
  ) {
    const t0 = now();
    const typeRead = await readTypeLine(card, deps.ocr, { profile });
    const titleOracleHints = fused.candidates
      .slice(0, 8)
      .map(c => c.oracleId.replace(/^oracle:/, '').replace(/^name:/, ''))
      .filter(Boolean);
    if (deps.typeIndex) {
      const typeEv = matchTypeReading(
        typeRead.raw,
        deps.typeIndex,
        titleOracleHints.length ? titleOracleHints : undefined,
      );
      applyTypeEvidenceScores(byOracle, typeEv);
      // Weak type must not override exact/sticky title — fuseEvidence sticky handles that.
      fused = fuseEvidence(
        [...byOracle.values()].map(r => ({
          ...r,
          temporalSupport: temporalSupportFor(temporal, r.oracleId),
        })),
        { allowTitleOnly: true, allowStrongDual: true },
      );
      fused = attachPrinting(fused, lastPrinting);
    } else {
      const typeTokens = new Set(typeRead.tokens);
      if (typeTokens.size && deps.textIndex) {
        const byName = new Map(deps.textIndex.entries.map(e => [e.name, e]));
        for (const c of fused.candidates.slice(0, 8)) {
          const entry =
            lookupTextEntry(
              deps.textIndex,
              c.oracleId.replace(/^name:/, '').replace(/^oracle:/, ''),
            ) ?? byName.get(c.name);
          if (!entry) continue;
          const hit = entry.tokens.some(t => typeTokens.has(t));
          if (!hit) continue;
          const row = byOracle.get(c.oracleId) ?? {
            name: c.name,
            oracleId: c.oracleId,
            possiblePrintingIds: [...(c.possiblePrintingIds ?? [])],
          };
          row.typeLineScore = Math.max(row.typeLineScore ?? 0, 0.55);
          byOracle.set(c.oracleId, row);
        }
        fused = fuseEvidence(
          [...byOracle.values()].map(r => ({
            ...r,
            temporalSupport: temporalSupportFor(temporal, r.oracleId),
          })),
          { allowTitleOnly: true, allowStrongDual: true },
        );
        fused = attachPrinting(fused, lastPrinting);
      }
    }
    timings.typeLineMs = now() - t0;
  }

  // PreferSets soft boost when footer had set but weak lookup.
  if (collector?.setCode && options.preferSets?.length && !lastPrinting) {
    const prefer = new Set(options.preferSets.map(s => s.toLowerCase()));
    if (prefer.has(collector.setCode.toLowerCase())) {
      for (const row of byOracle.values()) {
        row.footerScore = Math.max(row.footerScore ?? 0, 0.7);
      }
      fused = fuseEvidence(
        [...byOracle.values()].map(r => ({
          ...r,
          temporalSupport: temporalSupportFor(temporal, r.oracleId),
        })),
        { allowTitleOnly: true, allowStrongDual: true },
      );
    }
  }

  timings.totalMs = now() - totalAt;
  if (earlyReason != null) timings.earlyReason = earlyReason;
  if (printingResolvedAt != null) timings.printingResolvedAt = printingResolvedAt;
  timings.artMode = finalArt.mode;

  let nextTemporal = pushTemporal(temporal, fused);
  if (
    isStrongDualEvidence(fused) ||
    isStrongTitleOnly(fused) ||
    isStrongFooterPrinting(fused)
  ) {
    earlyIdentity = true;
    nextTemporal = pushTemporal(nextTemporal, fused);
  }

  return {
    result: {
      artMode: finalArt.mode,
      collector,
      earlyIdentity,
      earlyReason,
      fused,
      printingLookup: finalFooter?.hit ?? null,
      profile,
      readings,
      timings,
      titleCandidates,
      titleFooterConflict,
      visualTop,
      ocrDebug: finalTitle.ocrDebug,
    },
    temporal: nextTemporal,
  };
};
