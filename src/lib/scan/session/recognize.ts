// Progressive recognition on one normalized card frame.
//
// Order: artwork + title (always) → fuse → if ambiguous, text → if card known
// but printing unclear, footer. Callable from the live session and from the
// offline eval harness with the same inputs.

import { createArtworkMatcher, type ArtworkMatcher } from '../artwork/match';
import { describeArtwork } from '../artwork/descriptors';
import type { ArtworkIndexData } from '../artwork/types';
import type { CardNameIndex, NameCandidate, Reading } from '../matchName';
import { matchReadings } from '../matchName';
import { TITLE_TOP_N, VISUAL_TOP_N } from '../params';
import type { CollectorParts } from '../parseCollector';
import { mergePartsForScan } from '../parseCollector';
import { enhanceForOcr } from '../preprocess';
import { fuseEvidence, type CandidateEvidence, type FusedResult } from '../ranking/fuse';
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

export interface RecognizeDeps {
  artwork?: ArtworkMatcher | null;
  artworkIndex?: ArtworkIndexData | null;
  nameIndex: CardNameIndex | null;
  /** Optional OCR — when omitted, only artwork (if any) runs. */
  ocr?: TextRecognizer | null;
  textIndex?: TextIndexData | null;
}

export interface RecognizeOptions {
  /** Prefer these set codes when ranking printings (soft). */
  preferSets?: readonly string[];
  profile?: ScanProfile;
  /** Skip OCR entirely (art-only mode / eval). */
  skipOcr?: boolean;
  /** Force text-box OCR even when art+title are confident. */
  wantText?: boolean;
  /** Force footer OCR. */
  wantFooter?: boolean;
  /** Force type-line OCR. */
  wantTypeLine?: boolean;
  /** Eval: skip artwork matching. */
  skipArtwork?: boolean;
}

export interface RecognizeResult {
  fused: FusedResult;
  profile: ScanProfile;
  readings: Reading[];
  titleCandidates: NameCandidate[];
  collector?: CollectorParts;
  visualTop: ReturnType<ArtworkMatcher['findCandidates']>;
  timings: Record<string, number>;
}

const now = (): number =>
  typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();

export const recognizeCard = async (
  card: ScanImage,
  deps: RecognizeDeps,
  options: RecognizeOptions = {},
  temporal: TemporalState = emptyTemporal(),
): Promise<{ result: RecognizeResult; temporal: TemporalState }> => {
  const timings: Record<string, number> = {};
  const profile = options.profile ?? profileForCard(card.width, card.height);
  const matcher =
    deps.artwork ?? createArtworkMatcher(deps.artworkIndex ?? null);

  let t0 = now();
  let visualTop: ReturnType<ArtworkMatcher['findCandidates']> = [];
  if (!options.skipArtwork) {
    const artCrop = cropImage(card, profile.artwork);
    const descriptor = describeArtwork(artCrop);
    timings.artworkDescriptorMs = now() - t0;
    const matchAt = now();
    visualTop = matcher.findCandidates(descriptor, VISUAL_TOP_N);
    timings.artworkMatcherMs = now() - matchAt;
  } else {
    timings.artworkDescriptorMs = 0;
    timings.artworkMatcherMs = 0;
  }
  timings.artworkMs = now() - t0;

  let readings: Reading[] = [];
  let titleCandidates: NameCandidate[] = [];
  if (!options.skipOcr && deps.ocr && deps.nameIndex) {
    t0 = now();
    const title = await readTitle(card, deps.ocr, { profile });
    readings = title.readings;
    titleCandidates = matchReadings(readings, deps.nameIndex, { limit: TITLE_TOP_N });
    timings.titleMs = now() - t0;
  }

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

  let fused = fuseEvidence([...byOracle.values()].map(r => ({
    ...r,
    temporalSupport: temporalSupportFor(temporal, r.oracleId),
  })));

  const needText =
    options.wantText ||
    fused.status === 'card-ambiguous' ||
    fused.status === 'insufficient-confidence';

  if (needText && !options.skipOcr && deps.ocr && deps.textIndex?.entries?.length) {
    t0 = now();
    const textCrop = cropImage(card, profile.textBox);
    const prepared = enhanceForOcr(textCrop);
    const ocr = await deps.ocr.recognize(prepared, { mode: 'block' });
    const tokens = tokenizeScanText(ocr.text);
    const pool = fused.candidates
      .slice(0, 8)
      .map(c => lookupTextEntry(deps.textIndex!, c.oracleId.replace(/^oracle:/, '')))
      .filter((e): e is NonNullable<typeof e> => !!e);
    // Also try by name when oracle ids are name: stubs.
    const byName = new Map(deps.textIndex.entries.map(e => [e.name, e]));
    const idf = idfForPool(
      pool.length
        ? pool
        : fused.candidates.slice(0, 8).map(c => byName.get(c.name)).filter(Boolean) as typeof pool,
    );
    for (const c of fused.candidates.slice(0, 8)) {
      const entry =
        lookupTextEntry(deps.textIndex, c.oracleId.replace(/^oracle:/, '')) ??
        byName.get(c.name);
      if (!entry) continue;
      const row = byOracle.get(c.oracleId) ?? touch(c.oracleId, c.name);
      row.textScore = textEvidenceScore(tokens, entry.tokens, idf);
    }
    fused = fuseEvidence([...byOracle.values()].map(r => ({
      ...r,
      temporalSupport: temporalSupportFor(temporal, r.oracleId),
    })));
    timings.textMs = now() - t0;
  }

  const needType =
    options.wantTypeLine ||
    fused.status === 'card-ambiguous' ||
    fused.status === 'insufficient-confidence';

  if (needType && !options.skipOcr && deps.ocr) {
    t0 = now();
    const typeRead = await readTypeLine(card, deps.ocr, { profile });
    const typeTokens = new Set(typeRead.tokens);
    // Soft: if OCR says "creature", prefer candidates whose text tokens include it.
    if (typeTokens.size && deps.textIndex) {
      const byName = new Map(deps.textIndex.entries.map(e => [e.name, e]));
      for (const c of fused.candidates.slice(0, 8)) {
        const entry =
          lookupTextEntry(deps.textIndex, c.oracleId.replace(/^name:/, '').replace(/^oracle:/, '')) ??
          byName.get(c.name);
        if (!entry) continue;
        const hit = entry.tokens.some(t => typeTokens.has(t));
        if (!hit) continue;
        const row = byOracle.get(c.oracleId) ?? touch(c.oracleId, c.name);
        row.typeLineScore = Math.max(row.typeLineScore ?? 0, 0.55);
      }
      fused = fuseEvidence([...byOracle.values()].map(r => ({
        ...r,
        temporalSupport: temporalSupportFor(temporal, r.oracleId),
      })));
    }
    timings.typeLineMs = now() - t0;
  }

  let collector: CollectorParts | undefined;
  const needFooter =
    options.wantFooter ||
    fused.status === 'printing-ambiguous' ||
    (fused.status === 'identified' && (fused.candidates[0]?.possiblePrintingIds.length ?? 0) !== 1);

  if (needFooter && !options.skipOcr && deps.ocr) {
    t0 = now();
    const { parts } = await readCollector(
      card,
      deps.ocr,
      (into, incoming) => mergePartsForScan(into, incoming, { nameLocked: true }),
    );
    collector = parts;
    if (parts.setCode && options.preferSets?.length) {
      const prefer = new Set(options.preferSets.map(s => s.toLowerCase()));
      if (prefer.has(parts.setCode.toLowerCase())) {
        for (const row of byOracle.values()) {
          row.footerScore = Math.max(row.footerScore ?? 0, 0.7);
        }
      }
    } else if (parts.setCode || parts.collectorNumber) {
      for (const row of byOracle.values()) {
        row.footerScore = Math.max(row.footerScore ?? 0, 0.35);
      }
    }
    // Soft boost from raw collector parse matching candidate set codes.
    if (parts.setCode) {
      for (const v of visualTop) {
        if (v.setCode?.toLowerCase() === parts.setCode.toLowerCase()) {
          const row = byOracle.get(v.oracleId);
          if (row) row.footerScore = Math.max(row.footerScore ?? 0, 0.85);
        }
      }
    }
    fused = fuseEvidence([...byOracle.values()].map(r => ({
      ...r,
      temporalSupport: temporalSupportFor(temporal, r.oracleId),
    })));
    timings.footerMs = now() - t0;
  }

  const nextTemporal = pushTemporal(temporal, fused);
  return {
    result: {
      collector,
      fused,
      profile,
      readings,
      timings,
      titleCandidates,
      visualTop,
    },
    temporal: nextTemporal,
  };
};
