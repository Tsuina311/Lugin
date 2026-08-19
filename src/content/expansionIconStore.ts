// Cardmarket expansion (set) icons, captured from its CSS sprite.
//
// Cardmarket renders each set's symbol as a slice of one shared sprite sheet
// (`expicons.png`) positioned with `background-position`. The full catalogue is
// listed on `/Magic/Expansions`, and the same `.expansion-symbol` markup appears
// on product / offer / order pages. We opportunistically scrape those sprites as
// the user browses (see extractionRunner) and persist a name → {url,pos,size}
// map so the collection can show real set icons instead of plain text — with the
// set name only shown on hover.
//
// Persisted to chrome.storage.local; mirrors the useSyncExternalStore contract.

import { normalizeSetName } from '@/lib/sets';

const STORAGE_KEY = 'lugin:expansionIcons';

/** Everything needed to paint one set's sprite slice. */
export interface ExpansionIcon {
  /** CSS `background-position`, e.g. "-63px -2856px". */
  pos: string;
  /** Sprite cell size in px (icons are square). */
  size: number;
  /** Absolute sprite-sheet URL. */
  url: string;
}

/** normalized set name -> icon. */
type IconMap = Record<string, ExpansionIcon>;

/**
 * Loose set-name key so Cardmarket's naming and imported (ManaBox) naming line
 * up. Shared with the edition filter, which has to reconcile the same two
 * spellings against Scryfall's.
 */
export { normalizeSetName };

let icons: IconMap = {};
let loading = true;
const listeners = new Set<() => void>();

const emit = () => {
  for (const l of listeners) l();
};

const persist = async () => {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: icons });
  } catch {
    // ignore storage failures — in-memory state still works this session
  }
};

void chrome.storage.local.get(STORAGE_KEY).then(stored => {
  const raw = stored[STORAGE_KEY] as IconMap | undefined;
  icons = raw && typeof raw === 'object' ? raw : {};
  loading = false;
  emit();
});

/** Pull every `.expansion-symbol` sprite (with a resolvable name) out of a DOM. */
const parseIcons = (root: ParentNode): { icon: ExpansionIcon; name: string }[] => {
  const out: { icon: ExpansionIcon; name: string }[] = [];
  root.querySelectorAll<HTMLElement>('.expansion-symbol').forEach(sym => {
    const name = (
      sym.getAttribute('aria-label') ||
      sym.getAttribute('data-bs-original-title') ||
      sym.getAttribute('data-bs-title') ||
      sym.closest<HTMLElement>('[data-local-name]')?.getAttribute('data-local-name') ||
      ''
    ).trim();
    if (!name) return;
    // The paintable slice is an inner span carrying the sprite background; some
    // layouts put the style on the symbol itself.
    const inner = sym.querySelector<HTMLElement>('span[style*="background-image"]') ?? sym;
    const style = inner.getAttribute('style') ?? '';
    const url = style.match(/background-image:\s*url\((['"]?)([^'")]+)\1\)/i)?.[2]?.trim();
    const pos = style.match(/background-position:\s*([^;]+)/i)?.[1]?.trim();
    if (!url || !pos) return;
    const size = Number.parseInt(style.match(/width:\s*(\d+)px/i)?.[1] ?? '21', 10) || 21;
    out.push({ icon: { pos, size, url: url.startsWith('//') ? `https:${url}` : url }, name });
  });
  return out;
};

export const expansionIconStore = {
  /** Merge any expansion sprites found in a DOM subtree; persists only if new. */
  captureFrom(root: ParentNode): void {
    let copy: IconMap | null = null;
    for (const { icon, name } of parseIcons(root)) {
      const key = normalizeSetName(name);
      if (!key) continue;
      const prev = icons[key];
      if (prev && prev.pos === icon.pos && prev.url === icon.url && prev.size === icon.size) {
        continue;
      }
      copy ??= { ...icons };
      copy[key] = icon;
    }
    if (copy) {
      icons = copy;
      emit();
      void persist();
    }
  },

  getSnapshot(): IconMap {
    return icons;
  },

  isLoading(): boolean {
    return loading;
  },

  /** Look up a set's icon by (loosely matched) name. */
  lookup(name?: string): ExpansionIcon | undefined {
    return name ? icons[normalizeSetName(name)] : undefined;
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
