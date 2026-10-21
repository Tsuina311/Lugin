import { PRODUCT_NAMES } from '@/core/mobile/capabilities';

const asset = (path: string): string => `${import.meta.env.BASE_URL}${path}`;

const isIos = (): boolean =>
  /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const isStandalone = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches ||
  Boolean((navigator as Navigator & { standalone?: boolean }).standalone);

const webUrl = (): string => `${import.meta.env.BASE_URL}?app=1`;

export const Landing = () => {
  const showIosInstall = isIos() && !isStandalone();

  return (
    <main className="min-h-full overflow-y-auto bg-page px-4 pb-10 pt-[max(2rem,env(safe-area-inset-top))] text-ink">
      <div className="mx-auto max-w-2xl">
        <header className="mb-8 text-center">
          <img alt="Lugin" className="mx-auto h-10 w-auto" src={asset('icons/logo-dark.png')} />
          <h1 className="mt-5 text-2xl font-semibold">Your cards and decks, everywhere.</h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-muted">
            Choose the version that fits how you use Lugin.
          </p>
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          <section className="flex flex-col rounded-2xl border border-accent/50 bg-panel p-5 shadow-pop">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-accent">
              iPhone · Android · Desktop
            </p>
            <h2 className="mt-2 text-xl font-semibold">{PRODUCT_NAMES.web}</h2>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-muted">
              Open your collection and decks in any modern browser. Connect Google to sync with your
              other Lugin devices.
            </p>
            <a
              className="mt-5 block rounded-xl bg-accent px-4 py-3 text-center text-sm font-semibold text-accent-ink active:bg-accent-strong"
              href={webUrl()}
            >
              Open {PRODUCT_NAMES.web}
            </a>
            {showIosInstall ? (
              <p className="mt-3 text-center text-xs text-ink-faint">
                On iPhone: Safari → Share → Add to Home Screen
              </p>
            ) : null}
          </section>

          <section className="flex flex-col rounded-2xl border border-line-strong bg-panel p-5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint">
              Desktop Chrome · Cardmarket
            </p>
            <h2 className="mt-2 text-xl font-semibold">Install {PRODUCT_NAMES.chrome}</h2>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-muted">
              Adds Lugin collection and deck tools directly to Cardmarket on desktop Chrome.
            </p>
            <div
              aria-disabled="true"
              className="mt-5 rounded-xl border border-line-strong bg-raised px-4 py-3 text-center text-sm font-semibold text-ink-faint"
            >
              Public install coming soon
            </div>
            <p className="mt-3 text-center text-xs leading-relaxed text-ink-faint">
              A safe public Chrome installer is not available yet. Lugin Chrome does not run on
              iPhone.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
};
