// Development-only scanner diagnostics.
//
// Gated behind `flags.scanDebug`, never part of the end-user experience. Answers
// the only question that matters while building this: which stage went wrong?

import { toDataUrl } from './canvasBridge';

import type { ScanDiagnostics } from '@/lib/scan/diagnostics';

const pct = (v: number) => `${Math.round(v * 100)}%`;
const ms = (v: number) => `${v.toFixed(0)}ms`;

export const ScanDebugPanel = ({
  diagnostics,
  onClose,
}: {
  diagnostics: ScanDiagnostics;
  onClose: () => void;
}) => (
  <div className="absolute inset-0 z-20 flex flex-col bg-black/95 text-[11px] text-white">
    <div className="flex shrink-0 items-center gap-2 border-b border-white/15 px-3 py-2">
      <span className="font-semibold uppercase tracking-wide text-amber-300">Scan debug</span>
      <span className="min-w-0 flex-1 truncate text-white/60">{diagnostics.outcome}</span>
      <button
        className="rounded border border-white/30 px-2 py-1"
        onClick={onClose}
        type="button"
      >
        Close
      </button>
    </div>

    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
        <dt className="text-white/50">Card source</dt>
        <dd>
          {diagnostics.source}
          {diagnostics.detectionScore ? ` (${diagnostics.detectionScore.toFixed(2)})` : ''}
        </dd>
        <dt className="text-white/50">Frame</dt>
        <dd>
          {diagnostics.frameWidth}×{diagnostics.frameHeight}
        </dd>
        <dt className="text-white/50">Sharpness</dt>
        <dd>{diagnostics.sharpness.toFixed(0)}</dd>
        <dt className="text-white/50">Total</dt>
        <dd>{ms(diagnostics.totalMs)}</dd>
      </dl>

      {diagnostics.corners ? (
        <p className="mt-1 text-white/50">
          corners{' '}
          {(
            [
              diagnostics.corners.topLeft,
              diagnostics.corners.topRight,
              diagnostics.corners.bottomRight,
              diagnostics.corners.bottomLeft,
            ] as const
          )
            .map(p => `${Math.round(p.x)},${Math.round(p.y)}`)
            .join(' → ')}
        </p>
      ) : null}

      {diagnostics.timings.length ? (
        <p className="mt-2 text-white/60">
          {diagnostics.timings.map(t => `${t.stage} ${ms(t.ms)}`).join(' · ')}
        </p>
      ) : null}

      {diagnostics.cardImage ? (
        <div className="mt-2">
          <p className="text-white/50">Normalized card</p>
          <img
            alt="perspective-corrected card"
            className="mt-1 h-40 w-auto border border-white/20"
            src={toDataUrl(diagnostics.cardImage)}
          />
        </div>
      ) : null}

      <p className="mt-3 text-white/50">OCR passes</p>
      <ul className="mt-1 flex flex-col gap-2">
        {diagnostics.ocr.map((sample, i) => (
          <li key={`${sample.region}-${i}`} className="border-t border-white/10 pt-2">
            <div className="flex items-baseline gap-2">
              <span className="font-medium text-sky-300">{sample.region}</span>
              <span className="text-white/40">
                {sample.cropWidth}×{sample.cropHeight} · {sample.variant} · {ms(sample.ms)}
              </span>
              <span
                className={
                  sample.confidence >= 0.7
                    ? 'ml-auto text-emerald-300'
                    : sample.confidence >= 0.4
                      ? 'ml-auto text-amber-300'
                      : 'ml-auto text-red-300'
                }
              >
                {pct(sample.confidence)}
              </span>
            </div>
            {sample.crop ? (
              <img
                alt=""
                className="mt-1 max-h-14 w-auto max-w-full border border-white/20"
                src={toDataUrl(sample.crop)}
              />
            ) : null}
            <p className="mt-1 break-words font-mono text-white/80">
              {sample.rawText.trim() || <span className="text-white/30">(nothing)</span>}
            </p>
            {sample.normalizedText ? (
              <p className="break-words font-mono text-emerald-200/80">
                → {sample.normalizedText}
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      {diagnostics.candidates.length ? (
        <>
          <p className="mt-3 text-white/50">Candidates</p>
          <ol className="mt-1">
            {diagnostics.candidates.map((c, i) => (
              <li key={`${c.name}-${i}`}>
                {i + 1}. {c.name}
                {c.setCode ? ` (${c.setCode.toUpperCase()})` : ''} — {pct(c.score)}
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </div>
  </div>
);
