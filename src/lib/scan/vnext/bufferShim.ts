/**
 * detectFrameRegions builds a debug preview with Buffer.alloc().toString('base64').
 * Detection itself does not read that preview. On device, provide the two calls
 * it makes so a missing Node Buffer cannot zero the GBM structure features.
 */

type BufferLike = {
  alloc: (n: number) => Uint8Array;
};

export const ensureFrameBuffer = (): void => {
  const host = globalThis as { Buffer?: BufferLike };
  if (host.Buffer) {
    try {
      const probe = host.Buffer.alloc(1) as Uint8Array & { toString: (encoding?: string) => string };
      if (typeof probe.toString('base64') === 'string') return;
    } catch {
      /* replace a partial polyfill */
    }
  }
  host.Buffer = {
    alloc: (n: number) => {
      const bytes = new Uint8Array(n) as Uint8Array & { toString: (encoding?: string) => string };
      bytes.toString = () => '';
      return bytes;
    },
  };
};
