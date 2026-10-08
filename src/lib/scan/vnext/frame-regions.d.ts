declare module '../../../../scripts/geometry/lib/frame-regions/detect.mjs' {
  export function detectFrameRegions(image: {
    data: Uint8ClampedArray;
    width: number;
    height: number;
  }): {
    regions?: {
      artBox?: {
        quad?: {
          tl: [number, number];
          tr: [number, number];
          br: [number, number];
          bl: [number, number];
        };
        confidence?: number;
      } | null;
    };
    debug?: { boundaries?: { id?: string; confidence?: number }[] };
  };
}
