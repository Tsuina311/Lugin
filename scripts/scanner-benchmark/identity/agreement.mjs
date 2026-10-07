/**
 * Frozen recognition publish rule. Reference only. Not wired into Android.
 *
 * Publish the prototype Top1 when both are true:
 *   prototype Top1 score − prototype Top2 score >= 0.05
 *   clean Top1 oracle identity == prototype Top1 oracle identity
 *
 * The clean-gallery margin is not an input to the decision.
 * Identity is the oracle id used by the gallery. Printing ids are not compared.
 * The same oracle under two printings is one identity.
 */

export const PUBLISH_MARGIN = 0.05;

export const sameIdentity = (a, b) => {
  if (!a || !b) return false;
  if (a.oracleId && b.oracleId) return a.oracleId === b.oracleId;
  return false;
};

/** Collapse a gallery to one best score per oracle identity. */
export const rankIdentities = (embeddings, refs, query, dims = 512) => {
  const best = new Map();
  for (let i = 0; i < refs.length; i++) {
    let score = 0;
    const offset = i * dims;
    for (let d = 0; d < dims; d++) score += query[d] * embeddings[offset + d];
    const ref = refs[i];
    const prev = best.get(ref.oracleId);
    if (!prev || score > prev.score) {
      best.set(ref.oracleId, {
        name: ref.canonicalName,
        oracleId: ref.oracleId,
        printingId: ref.scryfallId ?? ref.id ?? null,
        score,
      });
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score || String(a.oracleId).localeCompare(String(b.oracleId)));
};

export const decideAgreement = ({ cleanTop1, prototypeTop1, prototypeTop2, cleanMargin = null }) => {
  const prototypeMargin = prototypeTop1.score - prototypeTop2.score;
  const agreement = sameIdentity(cleanTop1, prototypeTop1);
  const marginPasses = prototypeMargin >= PUBLISH_MARGIN;
  return {
    cleanTop1,
    prototypeTop1,
    prototypeTop2,
    prototypeMargin,
    cleanMargin,
    agreement,
    marginPasses,
    publish: marginPasses && agreement,
  };
};

/**
 * @param {Float32Array} query adapted query
 * @param {{ embeddings: Float32Array, refs: object[] }} cleanGallery
 * @param {{ embeddings: Float32Array, refs: object[] }} prototypeGallery
 */
export const recognizeAgreement = (query, cleanGallery, prototypeGallery, dims = 512) => {
  const clean = rankIdentities(cleanGallery.embeddings, cleanGallery.refs, query, dims);
  const prototype = rankIdentities(prototypeGallery.embeddings, prototypeGallery.refs, query, dims);
  const cleanTop2 = clean[1] ?? null;
  const decision = decideAgreement({
    cleanTop1: clean[0] ?? null,
    prototypeTop1: prototype[0] ?? null,
    prototypeTop2: prototype[1] ?? null,
    cleanMargin: clean[0] && cleanTop2 ? clean[0].score - cleanTop2.score : null,
  });
  return { ...decision, cleanRanked: clean, prototypeRanked: prototype };
};
