import type { ComboBundle, ComboIndexMetadata, SpellbookBracketTag, StoredCombo } from './types';

const TAGS = new Set<string>(['B', 'C', 'E', 'O', 'P', 'R', 'S']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const bad = (message: string): never => {
  throw new Error(`Combo index rejected: ${message}`);
};

const asRecord = (value: unknown, message: string): Record<string, unknown> => {
  if (isRecord(value)) return value;
  return bad(message);
};

const asString = (value: unknown, message: string): string => {
  if (typeof value === 'string') return value;
  return bad(message);
};

const asStringList = (value: unknown, message: string): string[] => {
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) return value;
  return bad(message);
};

const readCard = (value: unknown, id: string): StoredCombo['cards'][0] => {
  const card = asRecord(value, `${id} has a card that is not an object`);
  const oracleId = asString(card.oracleId, `${id} is missing an oracle id`);
  if (!UUID.test(oracleId)) return bad(`${id} is missing an oracle id`);
  const name = asString(card.name, `${id} is missing a card name`);
  if (!name.trim()) return bad(`${id} is missing a card name`);
  if (typeof card.qty !== 'number' || card.qty < 1) return bad(`${id} has a bad quantity`);
  return {
    commander: card.commander === true,
    name,
    oracleId,
    qty: card.qty,
    zones: asStringList(card.zones, `${id} has bad zones`),
  };
};

const readCombo = (value: unknown): StoredCombo => {
  const combo = asRecord(value, 'a combo has no id');
  const id = asString(combo.id, 'a combo has no id');
  if (!Array.isArray(combo.cards) || combo.cards.length !== 2)
    return bad(`${id} is not a two-card combo`);
  const left = readCard(combo.cards[0], id);
  const right = readCard(combo.cards[1], id);
  if (left.oracleId === right.oracleId) return bad(`${id} repeats one card`);
  const tag = asString(combo.tag, `${id} has a bad bracket tag`);
  if (!TAGS.has(tag)) return bad(`${id} has a bad bracket tag`);
  if (typeof combo.legal !== 'boolean') return bad(`${id} has no Commander legality`);
  const status = asString(combo.status, `${id} has no status`);
  if (!Array.isArray(combo.req)) return bad(`${id} has bad requirements`);
  const reqIn = combo.req;
  const req = reqIn.map(item => {
    const requirement = asRecord(item, `${id} has a bad requirement`);
    return {
      commander: requirement.commander === true,
      name: asString(requirement.name, `${id} has a bad requirement`),
    };
  });
  return {
    cards: [left, right],
    desc: typeof combo.desc === 'string' ? combo.desc : '',
    easy: typeof combo.easy === 'string' ? combo.easy : '',
    id,
    legal: combo.legal,
    mana: typeof combo.mana === 'string' ? combo.mana : '',
    mv: typeof combo.mv === 'number' ? combo.mv : 0,
    notable: typeof combo.notable === 'string' ? combo.notable : '',
    req,
    results: asStringList(combo.results, `${id} has bad results`),
    status,
    tag: tag as SpellbookBracketTag,
  };
};

const readMetadata = (value: unknown): ComboIndexMetadata => {
  const metadata = asRecord(value, 'metadata is missing');
  if (metadata.schema !== 1) bad('schema is not 1');
  if (metadata.provider !== 'Commander Spellbook') bad('provider is not Commander Spellbook');
  const sha = asRecord(metadata.sha256, 'metadata is missing a hash');
  return {
    comboCount: typeof metadata.comboCount === 'number' ? metadata.comboCount : 0,
    generatedAt: typeof metadata.generatedAt === 'string' ? metadata.generatedAt : '',
    pairCount: typeof metadata.pairCount === 'number' ? metadata.pairCount : 0,
    productionBundle: false,
    provider: 'Commander Spellbook',
    redistribution: 'not-cleared',
    schema: 1,
    sha256: {
      combos: asString(sha.combos, 'metadata is missing a hash'),
      pairs: asString(sha.pairs, 'metadata is missing a hash'),
      runtime: asString(sha.runtime, 'metadata is missing a hash'),
    },
    sourceUrl: typeof metadata.sourceUrl === 'string' ? metadata.sourceUrl : '',
    sourceVersion: typeof metadata.sourceVersion === 'string' ? metadata.sourceVersion : '',
  };
};

/**
 * Reject a bundle that is not the compact index. A bad file loads nothing:
 * deck editing must not run on a half-parsed combo list.
 */
export const parseComboBundle = (value: unknown): ComboBundle => {
  const bundle = asRecord(value, 'the bundle is not an object');
  const metadata = readMetadata(bundle.metadata);
  const combosIn = asRecord(bundle.combos, 'combos, pairs, or names is missing');
  const pairsIn = asRecord(bundle.pairs, 'combos, pairs, or names is missing');
  const namesIn = asRecord(bundle.names, 'combos, pairs, or names is missing');
  const combos: ComboBundle['combos'] = {};
  for (const [id, combo] of Object.entries(combosIn)) {
    const read = readCombo(combo);
    if (read.id !== id) return bad(`${id} does not match its key`);
    combos[id] = read;
  }
  const pairs: ComboBundle['pairs'] = {};
  for (const [key, ids] of Object.entries(pairsIn)) {
    if (!Array.isArray(ids)) return bad(`pair ${key} points at an unknown combo`);
    const list = ids.map(id => asString(id, `pair ${key} points at an unknown combo`));
    if (list.some(id => !combos[id])) return bad(`pair ${key} points at an unknown combo`);
    pairs[key] = list;
  }
  const names: ComboBundle['names'] = {};
  for (const [name, oracleId] of Object.entries(namesIn)) {
    const id = asString(oracleId, `name ${name} has no oracle id`);
    if (!UUID.test(id)) return bad(`name ${name} has no oracle id`);
    names[name] = id;
  }
  return { combos, metadata, names, pairs };
};
