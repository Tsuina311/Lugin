// Build + query TypeIndex (compact inverted postings).

import { normalizeTypeLineText, parseTypeLineReading } from './parse';
import type {
  TypeEvidence,
  TypeIndex,
  TypeIndexData,
} from './types';
import { TYPE_INDEX_VERSION } from './types';

export type {
  TypeEvidence,
  TypeIndex,
  TypeIndexData,
  TypeIndexFace,
  RankedTypeToken,
} from './types';
export { TYPE_INDEX_VERSION } from './types';
export { normalizeTypeLineText, parseTypeLineReading } from './parse';

export const TYPE_INDEX_MIN_PRODUCTION_ORACLES = 5_000;

export const buildTypeIndex = (data: TypeIndexData): TypeIndex => {
  const oracleOrdinal = new Map<string, number>();
  data.oracles.forEach((id, i) => oracleOrdinal.set(id, i));
  const cardTypeId = new Map(data.cardTypes.map((t, i) => [t, i] as const));
  const supertypeId = new Map(data.supertypes.map((t, i) => [t, i] as const));
  const subtypeId = new Map(data.subtypes.map((t, i) => [t, i] as const));
  return {
    cardTypeId,
    data,
    oracleIdOf: (o: number) => data.oracles[o],
    oracleOrdinal,
    subtypeId,
    supertypeId,
  };
};

const intersectSorted = (a: readonly number[], b: readonly number[]): number[] => {
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push(a[i]);
      i += 1;
      j += 1;
    } else if (a[i] < b[j]) i += 1;
    else j += 1;
  }
  return out;
};

const postingForSubtype = (index: TypeIndex, id: number): number[] => {
  const key = String(id);
  return index.data.subtypePostings[key] ?? [];
};

/**
 * Match a type-line reading. When optionalCandidateOracleIds is set, only
 * score within that subset (title-restricted path).
 */
export const matchTypeReading = (
  reading: string,
  typeIndex: TypeIndex | null | undefined,
  optionalCandidateOracleIds?: readonly string[],
): TypeEvidence => {
  if (!typeIndex) {
    return {
      cardTypes: [],
      confidence: 0,
      normalizedText: normalizeTypeLineText(reading),
      rawText: reading,
      subtypes: [],
      supertypes: [],
    };
  }
  const evidence = parseTypeLineReading(reading, typeIndex);
  const norm = evidence.normalizedText;

  // Exact signature hit
  const sigHits = typeIndex.data.signatures[norm];
  if (sigHits?.length) {
    const ids = sigHits
      .map(fi => typeIndex.data.faces[fi]?.oracleOrdinal)
      .filter((o): o is number => o != null)
      .map(o => typeIndex.oracleIdOf(o))
      .filter((x): x is string => Boolean(x));
    evidence.candidateOracleIds = unique(ids);
    evidence.confidence = Math.max(evidence.confidence, 0.92);
  }

  // Subtype intersection (information-weighted: rarer subtypes weigh more)
  if (evidence.subtypes.length) {
    let pool: number[] | null = null;
    for (const su of evidence.subtypes) {
      const post = postingForSubtype(typeIndex, su.id);
      pool = pool == null ? [...post] : intersectSorted(pool, post);
      if (!pool.length) break;
    }
    if (pool?.length) {
      const ids = pool
        .map(o => typeIndex.oracleIdOf(o))
        .filter((x): x is string => Boolean(x));
      evidence.candidateOracleIds = unique([
        ...(evidence.candidateOracleIds ?? []),
        ...ids,
      ]);
      const rarityBoost = Math.min(
        0.25,
        evidence.subtypes.reduce((acc, su) => {
          const n = postingForSubtype(typeIndex, su.id).length || 1;
          return acc + Math.log((typeIndex.data.oracles.length + 1) / n);
        }, 0) / 20,
      );
      evidence.confidence = Math.min(0.98, evidence.confidence + rarityBoost);
    }
  }

  if (optionalCandidateOracleIds?.length && evidence.candidateOracleIds) {
    const allow = new Set(optionalCandidateOracleIds);
    evidence.candidateOracleIds = evidence.candidateOracleIds.filter(id => allow.has(id));
  }

  return evidence;
};

const unique = (xs: string[]): string[] => [...new Set(xs)];

export const validateTypeIndexData = (
  raw: unknown,
  opts: { minOracles?: number } = {},
): { data: TypeIndexData; reason?: undefined } | { data?: undefined; reason: string } => {
  if (!raw || typeof raw !== 'object') return { reason: 'type index is not an object' };
  const body = raw as Partial<TypeIndexData>;
  if (!Array.isArray(body.oracles) || !body.oracles.length) {
    return { reason: 'type index has no oracles' };
  }
  if (!Array.isArray(body.faces) || !body.faces.length) {
    return { reason: 'type index has no faces' };
  }
  if (!Array.isArray(body.cardTypes) || !Array.isArray(body.supertypes) || !Array.isArray(body.subtypes)) {
    return { reason: 'type index vocab missing' };
  }
  const min = opts.minOracles ?? 1;
  if (body.oracles.length < min) {
    return { reason: `type index too small (${body.oracles.length} < ${min})` };
  }
  if (body.version !== TYPE_INDEX_VERSION && body.version !== 1) {
    return { reason: `unsupported type index version ${body.version}` };
  }
  return { data: body as TypeIndexData };
};

/** Apply type evidence as soft scores onto candidate rows (by oracle id / name). */
export const applyTypeEvidenceScores = (
  rows: Map<string, { name: string; oracleId: string; typeLineScore?: number }>,
  evidence: TypeEvidence,
): void => {
  if (!evidence.candidateOracleIds?.length || evidence.confidence < 0.4) return;
  const boost = Math.min(0.85, 0.45 + evidence.confidence * 0.4);
  for (const oid of evidence.candidateOracleIds) {
    const keys = [`oracle:${oid}`, oid];
    for (const k of keys) {
      const row = rows.get(k);
      if (row) row.typeLineScore = Math.max(row.typeLineScore ?? 0, boost);
    }
    for (const [k, row] of rows) {
      if (row.oracleId === oid || row.oracleId === `oracle:${oid}`) {
        row.typeLineScore = Math.max(row.typeLineScore ?? 0, boost);
      }
      void k;
    }
  }
};
