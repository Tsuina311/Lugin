declare module 'jsqr' {
  export interface DecodedQr {
    data: string;
  }

  export default function jsQR(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    options?: {
      inversionAttempts?: 'dontInvert' | 'onlyInvert' | 'attemptBoth' | 'invertFirst';
    },
  ): DecodedQr | null;
}
