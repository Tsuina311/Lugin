// First-run / re-prompt consent for development capture.

export const CaptureConsentDialog = ({
  onAccept,
  onDecline,
}: {
  onAccept: () => void;
  onDecline: () => void;
}) => (
  <div
    className="absolute inset-0 z-30 flex items-end justify-center bg-black/70 p-4 sm:items-center"
    role="dialog"
    aria-labelledby="corpus-consent-title"
  >
    <div className="w-full max-w-md rounded-xl bg-zinc-900 p-4 text-white shadow-xl">
      <h2 className="text-base font-semibold" id="corpus-consent-title">
        Help improve card scanning?
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-white/75">
        When enabled, Lugin can save selected scanner frames and diagnostics to a
        Scanner Corpus folder in your Google Drive. These samples help test and
        improve detection. Camera images may include the surface and objects around
        the card. No video or audio is recorded.
      </p>
      <p className="mt-2 text-xs text-white/50">
        Samples stay in your Drive. They are not automatically shared with the
        Lugin developer. You can turn this off at any time.
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button
          className="flex-1 rounded-lg bg-sky-500 py-2.5 text-sm font-semibold text-black"
          onClick={onAccept}
          type="button"
        >
          Help development
        </button>
        <button
          className="flex-1 rounded-lg bg-white/10 py-2.5 text-sm font-medium"
          onClick={onDecline}
          type="button"
        >
          No thanks
        </button>
      </div>
    </div>
  </div>
);
