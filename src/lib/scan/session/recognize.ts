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
  /** Optional OCR — when omitted, only artwork (if any) runs. */
  ocr?: TextRecognizer | null;
  textIndex?: TextIndexData | null;
  /**
   * Fired when a provisional identity/printing is ready before all channels
   * finish (title-only, footer-printing, dual, etc.).
   */
  onEarlyIdentity?: (result: RecognizeResult) => void;
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
  /** Eval: skip artwork matching. */
  skipArtwork?: boolean;
  /** Test/eval: delay artwork so title can win the race. */
  artworkDelayMs?: number;
  /** Test/eval: delay footer. */
  footerDelayMs?: number;
  /** Test/eval: delay title. */
  titleDelayMs?: number;
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
  skip: boolean,
): Promise<{
  readings: Reading[];
  titleCandidates: NameCandidate[];
  titleMs: number;
}> => {
  if (skip || !deps.ocr || !deps.nameIndex) {
    return { readings: [], titleCandidates: [], titleMs: 0 };
  }
  const t0 = now();
  const title = await readTitle(card, deps.ocr, { profile });
  const titleCandidates = matchReadings(title.readings, deps.nameIndex, { limit: TITLE_TOP_N });
  return {
    readings: title.readings,
    titleCandidates,
    titleMs: now() - t0,
  };
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
  const top = fused.candidates[0];
  const second = fused.candidates[1];
  if (!top?.titleScore) return false;
  const titleMargin = top.titleScore - (second?.titleScore ?? 0);
  return top.titleScore >= 0.94 && titleMargin >= 0.2 && fused.margin >= 0.1;
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
  const timings: RecognizeTimings = {};
  const profile = options.profile ?? profileForCard(card.width, card.height);
  const matcher = deps.artwork ?? createArtworkMatcher(deps.artworkIndex ?? null);
  const totalAt = now();

  type ArtOut = ReturnType<typeof runArtwork> & { mode: ArtSearchMode };
  type TitleOut = Awaited<ReturnType<typeof runTitle>>;
  type FooterOut = {
    collector: CollectorParts;
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
      else if (isStrongArtOnly(fused)) fireEarly('art-only', fused);
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

  // --- parallel channels ---
  const footerPromise = (async (): Promise<FooterOut | null> => {
    if (options.skipOcr || options.skipFooter || !deps.ocr) return null;
    if (options.footerDelayMs && options.footerDelayMs > 0) await sleep(options.footerDelayMs);
    const t0 = now();
    const { parts } = await readCollector(card, deps.ocr, (into, incoming) =>
      mergePartsForScan(into, incoming, { nameLocked: true }),
    );
    const tLookup = now();
    const hit = lookupPrinting(deps.printingIndex, parts);
    const out: FooterOut = {
      collector: parts,
      hit,
      lookupMs: now() - tLookup,
      ms: now() - t0,
    };
    footerOut = out;
    timings.footerMs = out.ms;
    timings.footerLookupMs = out.lookupMs;
    timings.footerDoneAt = now() - totalAt;
    tryEarlyFromPartial();
    return out;
  })();

  const titlePromise = (async (): Promise<TitleOut> => {
    if (options.titleDelayMs && options.titleDelayMs > 0) await sleep(options.titleDelayMs);
    const out = await runTitle(card, profile, deps, options.skipOcr === true);
    titleOut = out;
    timings.titleMs = out.titleMs;
    timings.titleDoneAt = now() - totalAt;
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
    // Prefer waiting briefly for footer/title restrict signal without hard barrier.
    const raceMs = 40;
    await Promise.race([
      Promise.all([footerPromise, titlePromise]),
      sleep(raceMs),
    ]);
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

  if (needType && !options.skipOcr && deps.ocr) {
    const t0 = now();
    const typeRead = await readTypeLine(card, deps.ocr, { profile });
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
    },
    temporal: nextTemporal,
  };
};
