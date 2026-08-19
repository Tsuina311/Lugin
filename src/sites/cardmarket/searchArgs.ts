/**
 * The parts of Cardmarket's search protocol that are pure string work.
 *
 * Kept apart from `search.ts` — which needs the DOM, the page's session and the
 * extension's messaging — so the format itself can be tested against a real
 * captured request in plain Node. See `search.ts` for what the endpoint is and
 * why we speak it.
 */

/** Shorter than this and Cardmarket returns the whole catalogue. */
export const MIN_SEARCH_LENGTH = 3;

const ACTION = 'Product_Search';
const SEPARATOR = '***';
/** The XOR counter's first value. */
const XOR_SEED = 0x58;

/** RFC 3986 unreserved set — everything else goes out as %XX. */
const UNRESERVED = /[A-Za-z0-9\-._~]/;

/**
 * Scramble the action + token half of `args`: each character XORed with a
 * counter starting at 0x58 and stepping by one.
 *
 * Involutive, so running the output back through it returns the input — which
 * is how the format was read in the first place.
 */
export const obfuscate = (plain: string): string => {
  let out = '';
  for (let i = 0; i < plain.length; i++) {
    out += String.fromCharCode((plain.charCodeAt(i) ^ ((XOR_SEED + i) & 0xff)) & 0xff);
  }
  return out;
};

/**
 * Percent-encode a byte string.
 *
 * `encodeURIComponent` would UTF-8 the scrambled high bytes and double their
 * length; the wire format is raw bytes. This also has to cover the base64 tail,
 * where a stray `+` would otherwise reach the server as a space.
 */
export const encodeArgs = (raw: string): string => {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i) & 0xff;
    const char = String.fromCharCode(code);
    out += UNRESERVED.test(char) ? char : `%${code.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
};

export interface SearchParams {
  /** Restrict to Singles (1), Boosters (2), … or null for everything. */
  productCategoryIds?: number[] | null;
  searchString: string;
}

/**
 * Build the `args` body value for one search.
 *
 * The JSON's field order is Cardmarket's own rather than alphabetical. This is a
 * wire format being reproduced, and a request that is byte-identical to the
 * search box's cannot be rejected for a reason we failed to imagine.
 */
export const buildArgs = (token: string, params: SearchParams): string => {
  /* eslint-disable sort-keys-fix/sort-keys-fix -- the order is load-bearing, see above */
  const json = JSON.stringify({
    searchString: params.searchString,
    searchMode: 'v2',
    productCategoryIds: params.productCategoryIds ?? null,
    responsive: '1',
  });
  /* eslint-enable sort-keys-fix/sort-keys-fix */
  const scrambled = obfuscate(`${ACTION}${SEPARATOR}${token}`);
  return encodeArgs(`${scrambled}${SEPARATOR}${btoa(json)}`);
};

const ENCODED_SEP = '%2A%2A%2A';

/** Scrambled bytes from the prefix of a percent-encoded `args` value. */
const scrambledPrefix = (encodedArgs: string): string => {
  const cut = encodedArgs.indexOf(ENCODED_SEP);
  const head = cut === -1 ? encodedArgs : encodedArgs.slice(0, cut);
  return head.replace(/%([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
};

/**
 * Session token embedded in a captured Product_Search `args` body.
 *
 * The site's own search box sends the same token we need; if the interceptor
 * caught one of those calls, reading it back is cheaper than fetching a page.
 */
export const tokenFromArgs = (args: string): string | null => {
  if (!args.includes(ENCODED_SEP) && !args.includes(SEPARATOR)) return null;
  const plain = obfuscate(scrambledPrefix(args));
  const match = plain.match(/\*\*\*([0-9a-f]{32,})$/i);
  return match ? match[1] : null;
};

/**
 * Read the set code and product id out of a Cardmarket product image URL, which
 * spells both out:
 *
 *   https://product-images.s3.cardmarket.com/1/RTR/258288/258288.jpg
 *
 * An autocomplete row carries no other machine-readable id — the name and the
 * expansion arrive as display text — so this is how a suggestion gets pinned to
 * a specific printing.
 */
export const productFactsFromImage = (
  src: string | undefined,
): { productId?: string; setCode?: string } => {
  const match = src?.match(/product-images[^/]*\/\d+\/([A-Za-z0-9]+)\/(\d+)\//);
  return match ? { productId: match[2], setCode: match[1].toUpperCase() } : {};
};
