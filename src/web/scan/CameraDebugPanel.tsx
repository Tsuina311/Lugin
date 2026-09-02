// scanDebug camera acquisition panel — requested vs actual settings.

import type { CameraDiagnostics } from './camera';

export const CameraDebugPanel = ({
  diagnostics,
  onClose,
  onSelectDevice,
  onToggleTorch,
  torchOn,
}: {
  diagnostics: CameraDiagnostics;
  onClose: () => void;
  onSelectDevice?: (deviceId: string) => void;
  onToggleTorch?: () => void;
  torchOn?: boolean;
}) => {
  const { capabilities: caps, settings, video, display, requested, devices } = diagnostics;
  return (
    <div className="absolute inset-x-0 bottom-0 z-20 max-h-[55%] overflow-y-auto rounded-t-xl bg-black/95 px-3 py-2 text-[11px] text-white">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-semibold uppercase tracking-wide text-amber-300">
          Camera
        </span>
        <button
          className="ml-auto rounded border border-white/30 px-2 py-0.5"
          onClick={onClose}
          type="button"
        >
          Close
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
        <dt className="text-white/50">Requested</dt>
        <dd>{requested}</dd>
        <dt className="text-white/50">Actual video</dt>
        <dd>
          {video.width}×{video.height}
          {settings.frameRate ? ` · ${settings.frameRate.toFixed(0)} fps` : ''}
        </dd>
        <dt className="text-white/50">Display</dt>
        <dd>
          {display.width}×{display.height}
        </dd>
        <dt className="text-white/50">Focus mode</dt>
        <dd>{settings.focusMode ?? '(browser default)'}</dd>
        <dt className="text-white/50">Focus distance</dt>
        <dd>{settings.focusDistance ?? '—'}</dd>
        <dt className="text-white/50">Zoom</dt>
        <dd>{settings.zoom ?? '—'}</dd>
        <dt className="text-white/50">Facing</dt>
        <dd>{settings.facingMode ?? '—'}</dd>
        <dt className="text-white/50">deviceId</dt>
        <dd className="truncate font-mono text-[10px]">{settings.deviceId ?? '—'}</dd>
        <dt className="text-white/50">Focus modes</dt>
        <dd>{caps.focusModes?.join(', ') || 'none reported'}</dd>
        <dt className="text-white/50">POI / tap</dt>
        <dd>
          {caps.pointsOfInterest ? 'yes' : 'no'}
          {diagnostics.supportsTapFocus ? ' · tap supported' : ' · tap unsupported'}
        </dd>
        <dt className="text-white/50">Torch</dt>
        <dd>{caps.torch ? 'available' : 'unavailable'}</dd>
        <dt className="text-white/50">Zoom range</dt>
        <dd>
          {caps.zoom
            ? `${caps.zoom.min ?? '?'}–${caps.zoom.max ?? '?'}`
            : '—'}
        </dd>
      </dl>

      {caps.torch && onToggleTorch ? (
        <button
          className="mt-2 rounded bg-white/10 px-2 py-1"
          onClick={onToggleTorch}
          type="button"
        >
          Light: {torchOn ? 'On' : 'Off'}
        </button>
      ) : null}

      {devices.length > 1 && onSelectDevice ? (
        <div className="mt-2">
          <p className="text-white/50">Video inputs</p>
          <ul className="mt-1 space-y-1">
            {devices.map(d => (
              <li key={d.deviceId}>
                <button
                  className={`w-full rounded px-2 py-1 text-left ${
                    d.deviceId === settings.deviceId ? 'bg-sky-500/30' : 'bg-white/5'
                  }`}
                  onClick={() => onSelectDevice(d.deviceId)}
                  type="button"
                >
                  {d.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-2 text-white/40">
        Compare visually with the native Camera app at the same distance. If native
        is sharp and Lugin is soft, check focus mode / lens / resolution above.
      </p>
    </div>
  );
};
