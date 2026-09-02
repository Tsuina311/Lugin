// Colored live card outline — product UI, not a fixed guide rectangle.
//
// Maps detector corners (analysis-frame space) through video source pixels and
// object-fit:cover into the overlay element.

import { useLayoutEffect, useState } from 'react';

import { mapCornersToOverlay } from '@/lib/scan/videoMap';
import type { CardCorners } from '@/lib/scan/types';
import type { ScannerPhase } from '@/lib/scan/session/controller';

export type OutlineVisual =
  | 'searching'
  | 'candidate'
  | 'focusing'
  | 'locked'
  | 'recognizing'
  | 'found'
  | 'rejected';

export const outlineVisualForPhase = (phase: ScannerPhase): OutlineVisual => {
  switch (phase) {
    case 'detected':
      return 'candidate';
    case 'focusing':
      return 'focusing';
    case 'locking':
      return 'locked';
    case 'recognizing':
      return 'recognizing';
    case 'found':
      return 'found';
    case 'ambiguous':
      return 'candidate';
    default:
      return 'searching';
  }
};

const STYLES: Record<
  OutlineVisual,
  { dash?: string; fill: string; label: string; stroke: string; width: number }
> = {
  searching: {
    fill: 'transparent',
    label: '',
    stroke: 'transparent',
    width: 0,
  },
  candidate: {
    dash: '8 6',
    fill: 'rgba(251, 191, 36, 0.12)',
    label: 'Hold steady',
    stroke: 'rgb(251, 191, 36)',
    width: 2.5,
  },
  focusing: {
    dash: '10 5',
    fill: 'rgba(250, 204, 21, 0.14)',
    label: 'Focusing…',
    stroke: 'rgb(250, 204, 21)',
    width: 2.75,
  },
  locked: {
    fill: 'rgba(52, 211, 153, 0.14)',
    label: 'Card locked',
    stroke: 'rgb(52, 211, 153)',
    width: 3,
  },
  recognizing: {
    fill: 'rgba(56, 189, 248, 0.16)',
    label: 'Recognizing…',
    stroke: 'rgb(56, 189, 248)',
    width: 3,
  },
  found: {
    fill: 'rgba(52, 211, 153, 0.2)',
    label: 'Found',
    stroke: 'rgb(16, 185, 129)',
    width: 3.5,
  },
  rejected: {
    dash: '4 4',
    fill: 'rgba(248, 113, 113, 0.1)',
    label: 'Lost lock',
    stroke: 'rgb(248, 113, 113)',
    width: 2,
  },
};

export const CardOutline = ({
  analysisSize,
  corners,
  phase,
  video,
}: {
  analysisSize: { height: number; width: number } | null;
  corners: CardCorners | null;
  phase: ScannerPhase;
  video: HTMLVideoElement | null;
}) => {
  const [box, setBox] = useState({ height: 0, width: 0 });

  useLayoutEffect(() => {
    if (!video) return;
    const update = () =>
      setBox({ height: video.clientHeight, width: video.clientWidth });
    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(video);
    return () => ro?.disconnect();
  }, [video]);

  const visual = outlineVisualForPhase(phase);
  const style = STYLES[visual];
  if (!corners || !video?.videoWidth || !analysisSize || !box.width || visual === 'searching') {
    return null;
  }

  const source = { height: video.videoHeight, width: video.videoWidth };
  const mapped = mapCornersToOverlay(corners, analysisSize, source, box);
  const pts = [
    mapped.topLeft,
    mapped.topRight,
    mapped.bottomRight,
    mapped.bottomLeft,
  ];
  const points = pts.map(p => `${p.x},${p.y}`).join(' ');
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
  const cy = Math.min(...pts.map(p => p.y)) - 8;

  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`0 0 ${box.width} ${box.height}`}
    >
      <polygon
        fill={style.fill}
        points={points}
        stroke={style.stroke}
        strokeDasharray={style.dash}
        strokeLinejoin="round"
        strokeWidth={style.width}
      />
      {style.label ? (
        <text
          fill={style.stroke}
          fontSize={13}
          fontWeight={600}
          textAnchor="middle"
          x={cx}
          y={Math.max(16, cy)}
        >
          {style.label}
        </text>
      ) : null}
    </svg>
  );
};
