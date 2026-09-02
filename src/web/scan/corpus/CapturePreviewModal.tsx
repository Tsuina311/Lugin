// Manual report preview: Save / Discard before high-value samples.

export const CapturePreviewModal = ({
  previewUrl,
  title,
  onDiscard,
  onSend,
  busy,
}: {
  busy?: boolean;
  onDiscard: () => void;
  onSend: () => void;
  previewUrl: string | null;
  title: string;
}) => (
  <div className="absolute inset-0 z-40 flex items-end justify-center bg-black/80 p-3 sm:items-center">
    <div className="w-full max-w-md rounded-xl bg-zinc-900 p-3 text-white">
      <div className="text-sm font-semibold">{title}</div>
      <p className="mt-1 text-xs text-white/55">
        Preview the frame that will be saved for development (your Google Drive when
        connected). Discard if it shows anything you do not want kept.
      </p>
      {previewUrl ? (
        <img
          alt="Capture preview"
          className="mt-3 max-h-64 w-full rounded-lg object-contain bg-black"
          src={previewUrl}
        />
      ) : (
        <div className="mt-3 rounded-lg bg-black/50 py-10 text-center text-xs text-white/40">
          Capturing…
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <button
          className="flex-1 rounded-lg bg-emerald-500 py-2 text-sm font-semibold text-black disabled:opacity-50"
          disabled={busy || !previewUrl}
          onClick={onSend}
          type="button"
        >
          Save sample
        </button>
        <button
          className="rounded-lg bg-white/10 px-4 py-2 text-sm"
          disabled={busy}
          onClick={onDiscard}
          type="button"
        >
          Discard
        </button>
      </div>
    </div>
  </div>
);
