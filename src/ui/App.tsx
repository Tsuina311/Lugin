import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { ErrorBoundary } from './ErrorBoundary';
import { ApiTester } from './components/ApiTester';
import { Badge } from './components/Badge';
import { Button } from './components/Button';
import { CallDetail } from './components/CallDetail';
import { CallList } from './components/CallList';
import { CollectionPanel } from './components/CollectionPanel';
import { DeckPanel } from './components/DeckPanel';
import { SearchInput } from './components/Field';
import { IconButton } from './components/IconButton';
import { CheckingSession, LoginGate, RequiresLogin } from './components/LoginGate';
import { LuginMark } from './components/LuginMark';
import { DESKTOP_VERSION } from '@/desktopVersion';
import { PreviewLayer } from './components/PreviewLayer';
import { SyncButton } from './components/SyncButton';
import { Tabs } from './components/Tabs';
import type { TabItem } from './components/Tabs';
import { TaskIndicator } from './components/TaskIndicator';
import { CartPanel } from './components/CartPanel';
import { PurchasesPanel } from './components/PurchasesPanel';
import { WantListsPanel } from './components/WantListsPanel';
import { WantsPanel } from './components/WantsPanel';
import { WelcomeScreen } from './components/WelcomeScreen';
import {
  ClipboardList,
  FlaskConical,
  Layers,
  Library,
  Maximize2,
  Minimize2,
  PanelLeft,
  PanelRight,
  ReceiptEuro,
  Search,
  ShoppingCart,
  SunMoon,
  TrendingUp,
  X,
} from './components/icons';
import { useCalls } from './useCalls';

import { callStore } from '@/content/callStore';
import { cartStore } from '@/content/cartStore';
import { catalogueSearchStore } from '@/content/catalogueSearchStore';
import { sellerBrowseStore } from '@/content/sellerBrowseStore';
import {
  LAST_VISIBLE_VIEW_KEY,
  OVERLAY_HIDE_EVENT,
  OVERLAY_OPEN_CART_EVENT,
  OVERLAY_SHOW_EVENT,
  OVERLAY_VIEW_KEY,
  reopenOverlayIfPending,
} from '@/content/overlay';
import { sessionStore } from '@/content/sessionStore';
import { taskQueue } from '@/content/taskQueue';
import { flags } from '@/lib/flags';
import { PREFS_APPLIED_EVENT } from '@/platform/chrome/localRepository';
import { useFirstRun } from '@/ui/useFirstRun';

type Tab =
  | 'search'
  | 'collection'
  | 'purchases'
  | 'wantlists'
  | 'decks'
  | 'cart'
  | 'traffic'
  | 'api';

// Dev-only tabs (Traffic + API) are hidden behind the feature flag.
const TABS: TabItem<Tab>[] = [
  { icon: Search, id: 'search', label: 'Search', title: 'Find a card and see who has it' },
  { icon: Library, id: 'collection', label: 'Collection', title: 'The cards you own' },
  {
    icon: ReceiptEuro,
    id: 'purchases',
    label: 'Purchases',
    title: 'Order history by seller — pick favourites from evidence',
  },
  { icon: ClipboardList, id: 'wantlists', label: 'Wants', title: 'Your want lists' },
  { icon: Layers, id: 'decks', label: 'Decks', title: 'Build and price decks' },
  { icon: ShoppingCart, id: 'cart', label: 'Cart', title: 'Your shopping cart' },
  ...(flags.devTools
    ? [
        { icon: TrendingUp, id: 'traffic' as Tab, label: 'Traffic' },
        { icon: FlaskConical, id: 'api' as Tab, label: 'API' },
      ]
    : []),
];

const TAB_KEY = 'lugin:tab';
const ALL_TABS: Tab[] = [
  'search',
  'collection',
  'purchases',
  'wantlists',
  'decks',
  'cart',
  'traffic',
  'api',
];
const isTab = (v: string | null): v is Tab => !!v && (ALL_TABS as string[]).includes(v);
const onShoppingCartPage = (): boolean => /\/Magic\/ShoppingCart\/?$/i.test(location.pathname);
const cartPageUrl = (): string => {
  const first = location.pathname.split('/').filter(Boolean)[0] ?? '';
  const lang = /^[a-z]{2}$/.test(first) ? first : 'en';
  return `${location.origin}/${lang}/Magic/ShoppingCart`;
};
const readTab = (): Tab => {
  // Always restore the last tab the user was on. Opening Cart explicitly
  // (header total, site cart link) still switches via setTab / openOverlayCart —
  // being on Cardmarket’s cart URL must not trap them on the Cart tab forever.
  try {
    const saved = localStorage.getItem(TAB_KEY);
    if (saved === 'filter') return 'search';
    if (isTab(saved) && (saved !== 'traffic' && saved !== 'api' ? true : flags.devTools)) {
      return saved;
    }
  } catch {
    /* ignore */
  }
  return 'search';
};

// Remember the overlay's view mode across page navigations. We use the page
// origin's localStorage (synchronous, so no flash before we know the
// preference) rather than async chrome.storage.
//   hidden — collapsed to a small restore button
//   panel  — the docked right-hand sidebar (default)
//   full   — full-screen (the site is barely needed once features pile up)
type View = 'hidden' | 'panel' | 'full';
const VIEW_KEY = OVERLAY_VIEW_KEY;
const OPEN_KEY = 'lugin:overlayOpen'; // legacy boolean, migrated on read

// Visual theme: our own dark palette, or "site" — remapped to Cardmarket's
// colors/spacing/radius (sampled into --lugin-* vars; see index.css / index.tsx).
type Theme = 'dark' | 'site';
const THEME_KEY = 'lugin:theme';
const readTheme = (): Theme => {
  try {
    return localStorage.getItem(THEME_KEY) === 'site' ? 'site' : 'dark';
  } catch {
    return 'dark';
  }
};

// The wordmark ships as two inkings rather than one image we tint, because the
// stacked cards are coloured and would lose their point in a single colour.
// Site theme means Cardmarket's palette, which is a light page.
const WORDMARK: Record<Theme, string> = {
  dark: chrome.runtime.getURL('icons/logo-dark.png'),
  site: chrome.runtime.getURL('icons/logo.png'),
};

// Which screen edge the panel docks to. Persisted like the other prefs.
type Side = 'left' | 'right';
const SIDE_KEY = 'lugin:dockSide';
const readSide = (): Side => {
  try {
    return localStorage.getItem(SIDE_KEY) === 'left' ? 'left' : 'right';
  } catch {
    return 'right';
  }
};
// How wide the docked panel is, dragged by its inner edge. Kept between the
// point where the dense two-column rows still fit and half a large screen.
const WIDTH_KEY = 'lugin:panelWidth';
const MIN_WIDTH = 320;
const MAX_WIDTH = 900;
const DEFAULT_WIDTH = 440;
const clampWidth = (n: number): number => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(n)));
const readWidth = (): number => {
  try {
    const raw = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(raw) && raw > 0 ? clampWidth(raw) : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
};

const readView = (): View => {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === 'hidden' || v === 'panel' || v === 'full') return v;
    return localStorage.getItem(OPEN_KEY) === '0' ? 'hidden' : 'panel';
  } catch {
    return 'panel';
  }
};

export const App = () => {
  const calls = useCalls();
  const [view, setView] = useState<View>(readView);
  // Last non-hidden mode, so restoring returns to panel/full as it was.
  const lastVisibleRef = useRef<Exclude<View, 'hidden'>>(view === 'full' ? 'full' : 'panel');
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [side, setSide] = useState<Side>(readSide);
  const [width, setWidth] = useState<number>(readWidth);
  const [resizing, setResizing] = useState(false);
  const [tab, setTabState] = useState<Tab>(readTab);
  const setTab = (next: Tab) => {
    setTabState(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      /* ignore */
    }
  };
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const cart = useSyncExternalStore(cartStore.subscribe, cartStore.getSnapshot);
  const catalogueRequest = useSyncExternalStore(
    catalogueSearchStore.subscribe,
    catalogueSearchStore.getSnapshot,
  );
  const sellerBrowseRequest = useSyncExternalStore(
    sellerBrowseStore.subscribe,
    sellerBrowseStore.getSnapshot,
  );
  const session = useSyncExternalStore(sessionStore.subscribe, sessionStore.getSnapshot);

  // A want-list (or other) click asked to search a card — open the Search tab.
  useEffect(() => {
    if (catalogueRequest) setTab('search');
  }, [catalogueRequest?.id]);

  useEffect(() => {
    if (sellerBrowseRequest) setTab('search');
  }, [sellerBrowseRequest?.id]);

  const openCart = () => {
    // Persist before navigate — React's view effect may not flush before unload.
    try {
      localStorage.setItem(TAB_KEY, 'cart');
      if (view === 'hidden') localStorage.setItem(VIEW_KEY, lastVisibleRef.current);
    } catch {
      /* ignore */
    }
    setTab('cart');
    if (view === 'hidden') setView(lastVisibleRef.current);
    // Same tab: load Cardmarket’s cart HTML, then show Lugin’s clearer view of it.
    if (!onShoppingCartPage()) {
      location.assign(cartPageUrl());
      return;
    }
    void cartStore.refresh();
  };

  // `null` until the stores have read storage — see useFirstRun for why this is
  // not a plain subscription.
  const { close: finishWelcome, welcome } = useFirstRun();

  // Seed stores, wire overlay events, and reopen after Cardmarket login once the
  // session check succeeds (listener must exist before sessionStore.init() runs).
  useEffect(() => {
    const show = () => setView(readView());
    const toggle = () => setView(v => (v === 'hidden' ? lastVisibleRef.current : 'hidden'));
    const hide = () => setView('hidden');
    const showCart = () => {
      setTab('cart');
      setView(v => (v === 'hidden' ? lastVisibleRef.current : v));
      void cartStore.refresh();
    };

    window.addEventListener('lugin:toggle', toggle);
    window.addEventListener(OVERLAY_HIDE_EVENT, hide);
    window.addEventListener(OVERLAY_SHOW_EVENT, show);
    window.addEventListener(OVERLAY_OPEN_CART_EVENT, showCart);

    const tryReopenAfterLogin = () => {
      reopenOverlayIfPending();
      setView(readView());
    };

    let prevSignedIn = sessionStore.getSnapshot().signedIn;
    const unsubSession = sessionStore.subscribe(() => {
      const { signedIn } = sessionStore.getSnapshot();
      if (signedIn === true && prevSignedIn !== true) tryReopenAfterLogin();
      prevSignedIn = signedIn;
    });

    cartStore.seedFromDom();
    void cartStore.refresh();
    taskQueue.init();
    sessionStore.init();

    return () => {
      unsubSession();
      window.removeEventListener('lugin:toggle', toggle);
      window.removeEventListener(OVERLAY_HIDE_EVENT, hide);
      window.removeEventListener(OVERLAY_SHOW_EVENT, show);
      window.removeEventListener(OVERLAY_OPEN_CART_EVENT, showCart);
    };
  }, []);

  // Persist the view mode so it survives page navigations, and remember the
  // last visible mode for restoring from hidden.
  useEffect(() => {
    if (view !== 'hidden') {
      lastVisibleRef.current = view;
      try {
        localStorage.setItem(LAST_VISIBLE_VIEW_KEY, view);
      } catch {
        /* ignore */
      }
    }
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // ignore storage failures (private mode, disabled storage, etc.)
    }
  }, [view]);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore storage failures
    }
  }, [theme]);

  // A theme chosen on another device arrives through storage, which React can't
  // see; without this it would only appear after a reload.
  useEffect(() => {
    const adopt = (e: Event) => {
      const applied = (e as CustomEvent<{ theme: Theme }>).detail;
      if (applied?.theme) setTheme(applied.theme);
    };
    window.addEventListener(PREFS_APPLIED_EVENT, adopt);
    return () => window.removeEventListener(PREFS_APPLIED_EVENT, adopt);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SIDE_KEY, side);
    } catch {
      // ignore storage failures
    }
  }, [side]);

  useEffect(() => {
    try {
      localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      // ignore storage failures
    }
  }, [width]);

  // Dragging the panel's inner edge resizes it. The listeners go on the page
  // (not the handle) so the pointer can outrun the element, and `select-none` on
  // the document stops the drag from highlighting the site's text.
  useEffect(() => {
    if (!resizing) return;
    const move = (e: PointerEvent) => {
      setWidth(clampWidth(side === 'left' ? e.clientX : window.innerWidth - e.clientX));
    };
    const stop = () => setResizing(false);
    const previous = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      document.body.style.userSelect = previous;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, [resizing, side]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return calls;
    return calls.filter(c => c.url.toLowerCase().includes(q) || c.method.toLowerCase().includes(q));
  }, [calls, filter]);

  const selected = useMemo(() => calls.find(c => c.id === selectedId) ?? null, [calls, selectedId]);

  // Panels are always mounted (visibility toggled with `hidden`) so state — and
  // any active page filter — persists across tab switches and while hidden.
  const panelClass = (active: boolean, extra = '') =>
    active ? `min-h-0 flex-1 ${extra}` : 'hidden';

  return (
    <div data-lugin-theme={theme} style={{ display: 'contents' }}>
      {/* Hover image preview — rendered outside the backdrop-blur overlay so
          `position: fixed` stays viewport-relative, and outside this component's
          state so hovering a card doesn't re-render the panel behind it. */}
      <PreviewLayer />

      {view === 'hidden' && (
        <button
          aria-label="Open Lugin"
          // `hover:bg-raised`, not the usual `hover:bg-tint`: tint is a 5% wash
          // meant to sit *over* an opaque surface, and everything else using it
          // does. This button floats on Cardmarket itself, so swapping its fill
          // for the wash made it 95% transparent — it faded out on hover instead
          // of lighting up. `raised` is opaque in both themes.
          className={`pointer-events-auto fixed top-4 z-[2147483000] flex h-10 w-10 items-center justify-center rounded-full border border-line-strong bg-panel p-2 shadow-pop transition hover:bg-raised ${
            side === 'left' ? 'left-4' : 'right-4'
          }`}
          onClick={() => setView(lastVisibleRef.current)}
          title={`Open Lugin · v${DESKTOP_VERSION}`}
          type="button"
        >
          <LuginMark size={22} variant="color" />
        </button>
      )}

      <div
        className={
          // `overflow-hidden`: a panel that lays itself out taller than the
          // overlay must scroll inside its own list, not spill over the site.
          // `pointer-events-auto`: the host ignores the mouse so the page stays
          // usable; only this panel (and the restore button above) catch it.
          view === 'full'
            ? 'pointer-events-auto fixed inset-0 z-[2147483000] flex h-screen w-screen flex-col overflow-hidden bg-canvas text-ink shadow-panel'
            : view === 'panel'
              ? `pointer-events-auto fixed top-0 z-[2147483000] flex h-screen w-full flex-col overflow-hidden bg-canvas text-ink shadow-panel ${
                  side === 'left' ? 'left-0 border-r border-line' : 'right-0 border-l border-line'
                }`
              : 'hidden'
        }
        style={view === 'panel' ? { maxWidth: width } : undefined}
      >
        {view === 'panel' && (
          // A 5px grab strip on the inner edge; it only shows itself under the
          // pointer or while dragging, so it doesn't read as another border.
          <div
            aria-label="Drag to resize the panel"
            aria-orientation="vertical"
            className={`absolute inset-y-0 z-20 w-[5px] cursor-col-resize transition-colors hover:bg-accent ${
              resizing ? 'bg-accent' : 'bg-transparent'
            } ${side === 'left' ? 'right-0' : 'left-0'}`}
            onDoubleClick={() => setWidth(DEFAULT_WIDTH)}
            onPointerDown={e => {
              e.preventDefault();
              setResizing(true);
            }}
            role="separator"
            title="Drag to resize · double-click to reset"
          />
        )}
        {/* Full screen gets the room it promises — panels lay themselves out for
            the width they're given. The cap only stops an ultrawide from
            stretching rows into a scavenger hunt. */}
        <div
          className={
            view === 'full'
              ? 'mx-auto flex h-full w-full max-w-[1600px] flex-col'
              : 'flex h-full flex-col'
          }
        >
          {/* Header — one line at any width: wordmark, cart, then icon controls. */}
          <div className="flex flex-none items-center gap-1 border-b border-line bg-panel px-2 py-1.5">
            <img
              alt="Lugin"
              className="h-4 w-auto flex-none select-none"
              draggable={false}
              src={WORDMARK[theme]}
            />
            <span
              className="flex-none rounded bg-tint px-1 py-0.5 text-[11px] font-semibold tabular-nums text-ink"
              title="Desktop code version — bumps every change so you can confirm a reload picked it up"
            >
              v{DESKTOP_VERSION}
            </span>

            <button
              className={`ml-1 flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium tabular-nums transition-colors hover:bg-tint ${
                cart.status === 'error' ? 'text-neg' : 'text-pos'
              } ${tab === 'cart' ? 'bg-tint' : ''}`}
              onClick={openCart}
              title={`Shopping cart${cart.count ? ` — ${cart.count} item${cart.count === 1 ? '' : 's'}` : ' (empty)'}${
                cart.status === 'error' ? ` · ${cart.error ?? 'refresh failed'}` : ''
              }`}
              type="button"
            >
              <ShoppingCart
                aria-hidden
                className={cart.status === 'loading' ? 'animate-pulse' : ''}
                size={13}
              />
              {cart.total ?? (cart.status === 'loading' ? '…' : '0,00 €')}
              {cart.count > 0 && <Badge tone="pos">{cart.count}</Badge>}
            </button>

            <div className="ml-auto flex items-center gap-0.5">
              {flags.devTools && (
                <Button
                  onClick={() => {
                    callStore.clear();
                    setSelectedId(null);
                  }}
                  size="xs"
                  variant="subtle"
                >
                  Clear log
                </Button>
              )}
              <TaskIndicator />
              <SyncButton />
              {view === 'panel' && (
                <IconButton
                  icon={side === 'left' ? PanelLeft : PanelRight}
                  label={side === 'left' ? 'Docked left — dock right' : 'Docked right — dock left'}
                  onClick={() => setSide(s => (s === 'left' ? 'right' : 'left'))}
                />
              )}
              <IconButton
                active={theme === 'site'}
                icon={SunMoon}
                label={
                  theme === 'site'
                    ? 'Matching the site — switch to the dark theme'
                    : 'Match the site’s colors & spacing'
                }
                onClick={() => setTheme(theme === 'site' ? 'dark' : 'site')}
              />
              <IconButton
                icon={view === 'full' ? Minimize2 : Maximize2}
                label={view === 'full' ? 'Dock to the side panel' : 'Expand to full screen'}
                onClick={() => setView(view === 'full' ? 'panel' : 'full')}
              />
              <IconButton icon={X} label="Hide the panel" onClick={() => setView('hidden')} />
            </div>
          </div>

          {/* Until storage has answered, `welcome` is undecided — and we show the
              app, because that is what almost every render is. A new user sees the
              tab bar for a few milliseconds first; the alternative is a blank panel
              on every page load for everyone who is already set up. */}
          {welcome ? (
            <ErrorBoundary label="Welcome">
              {session.signedIn === false ? (
                <LoginGate feature="Reading your want lists and purchases" />
              ) : session.signedIn === null ? (
                <CheckingSession />
              ) : (
                <WelcomeScreen onDone={finishWelcome} />
              )}
            </ErrorBoundary>
          ) : (
            <>
              <Tabs
                items={TABS.map(t =>
                  t.id === 'traffic'
                    ? { ...t, count: calls.length }
                    : t.id === 'cart'
                      ? { ...t, count: cart.count || undefined }
                      : t,
                )}
                onChange={setTab}
                value={tab}
              />

              <div className={panelClass(tab === 'search')}>
                <ErrorBoundary label="Search">
                  <RequiresLogin active={tab === 'search'} feature="Search">
                    <WantsPanel active={tab === 'search'} />
                  </RequiresLogin>
                </ErrorBoundary>
              </div>

              <div className={panelClass(tab === 'collection')}>
                <ErrorBoundary label="Collection">
                  <CollectionPanel />
                </ErrorBoundary>
              </div>

              <div className={panelClass(tab === 'purchases')}>
                <ErrorBoundary label="Purchases">
                  <PurchasesPanel />
                </ErrorBoundary>
              </div>

              <div className={panelClass(tab === 'wantlists')}>
                <ErrorBoundary label="Wants">
                  <RequiresLogin active={tab === 'wantlists'} feature="Want lists">
                    <WantListsPanel />
                  </RequiresLogin>
                </ErrorBoundary>
              </div>

              <div className={panelClass(tab === 'decks')}>
                <ErrorBoundary label="Decks">
                  <DeckPanel />
                </ErrorBoundary>
              </div>

              <div className={panelClass(tab === 'cart')}>
                <ErrorBoundary label="Cart">
                  <RequiresLogin active={tab === 'cart'} feature="Cart">
                    <CartPanel />
                  </RequiresLogin>
                </ErrorBoundary>
              </div>

              {flags.devTools && (
                <div className={panelClass(tab === 'traffic', 'flex flex-col')}>
                  <div className="flex border-b border-line p-1.5">
                    <SearchInput
                      onChange={e => setFilter(e.target.value)}
                      onClear={() => setFilter('')}
                      placeholder="Filter by URL or method…"
                      value={filter}
                    />
                  </div>
                  <div className="grid min-h-0 flex-1 grid-rows-2">
                    <div className="min-h-0 overflow-auto border-b border-line">
                      <CallList calls={filtered} onSelect={setSelectedId} selectedId={selectedId} />
                    </div>
                    <div className="min-h-0 overflow-auto">
                      {selected ? (
                        <CallDetail call={selected} />
                      ) : (
                        <div className="flex h-full items-center justify-center text-xs text-ink-faint">
                          Select a call to inspect it.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {flags.devTools && (
                <div className={panelClass(tab === 'api')}>
                  <ApiTester />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
