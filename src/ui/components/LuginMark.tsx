import type { SVGProps } from 'react';

// The Lugin mark as SVG, so colour and size are props rather than a re-export
 // of a PNG. Two looks:
 //   color — the brand stack (MTG-ish mana colours behind a white L card)
 //   mono  — same geometry, filled with `currentColor` (L punched through so the
 //           button background shows). Use this on the floating restore control.

export type LuginMarkVariant = 'color' | 'mono';

type Props = SVGProps<SVGSVGElement> & {
  /** Pixel size when `className` doesn't set one. Defaults to 24. */
  size?: number;
  variant?: LuginMarkVariant;
};

/** Four-point sparkle used on the colour mark. */
const Spark = ({ cx, cy, r = 2.4 }: { cx: number; cy: number; r?: number }) => (
  <path
    d={`M${cx} ${cy - r} L${cx + r * 0.28} ${cy - r * 0.28} L${cx + r} ${cy} L${cx + r * 0.28} ${
      cy + r * 0.28
    } L${cx} ${cy + r} L${cx - r * 0.28} ${cy + r * 0.28} L${cx - r} ${cy} L${cx - r * 0.28} ${
      cy - r * 0.28
    } Z`}
    fill="#7EB6FF"
  />
);

/** One card in the fan. Drawn as a rounded rect, then translated/rotated. */
const Card = ({
  fill,
  stroke,
  strokeWidth = 2.2,
  tx,
  ty,
  rot,
}: {
  fill: string;
  rot: number;
  stroke: string;
  strokeWidth?: number;
  tx: number;
  ty: number;
}) => (
  <g transform={`translate(${tx} ${ty}) rotate(${rot} 22 30)`}>
    <rect
      fill={fill}
      height="44"
      rx="5"
      stroke={stroke}
      strokeWidth={strokeWidth}
      width="32"
      x="6"
      y="8"
    />
  </g>
);

const INK = '#0B1F3A';

export const LuginMark = ({
  className = '',
  size = 24,
  variant = 'color',
  ...rest
}: Props) => {
  const mono = variant === 'mono';
  const stroke = mono ? 'currentColor' : INK;
  // Back → front. Colour stack echoes the mana rainbow; mono collapses to one ink.
  const fills = mono
    ? ['currentColor', 'currentColor', 'currentColor', 'currentColor', 'currentColor', 'currentColor']
    : ['#E53935', '#FB8C00', '#FDD835', '#43A047', '#1E88E5', '#FFFFFF'];

  return (
    <svg
      aria-hidden
      className={className}
      fill="none"
      height={size}
      viewBox="0 0 64 64"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
      {...rest}
    >
      {/* Fan of cards, back to front. */}
      <Card fill={fills[0]} rot={18} stroke={stroke} tx={14} ty={4} />
      <Card fill={fills[1]} rot={14} stroke={stroke} tx={11} ty={3} />
      <Card fill={fills[2]} rot={10} stroke={stroke} tx={8} ty={2} />
      <Card fill={fills[3]} rot={6} stroke={stroke} tx={5} ty={1} />
      <Card fill={fills[4]} rot={3} stroke={stroke} tx={2} ty={0} />
      <Card fill={fills[5]} rot={0} stroke={stroke} strokeWidth={2.6} tx={0} ty={0} />

      {/* The L — punched out in mono so the button fill reads through. */}
      {mono ? (
        <path
          d="M20 18h7.2v22.4H36V48H20V18z"
          fill="var(--lugin-canvas, #fff)"
        />
      ) : (
        <>
          <path d="M20 18h7.2v22.4H36V48H20V18z" fill={INK} />
          <Spark cx={34.5} cy={16.5} r={2.6} />
          <Spark cx={15.5} cy={45} r={2.2} />
        </>
      )}
    </svg>
  );
};
