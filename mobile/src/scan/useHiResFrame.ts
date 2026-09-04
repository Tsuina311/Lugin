// Dedicated higher-resolution frame output, armed only for one copy.
//
// The worklet cannot read a JS ref. Arming attaches onFrame; the next
// sampled buffer is copied and the callback is detached. That may hitch
// the session — it is one of the things Samsung must measure.

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { useFrameOutput, type Frame } from 'react-native-vision-camera';
import { scheduleOnRN } from 'react-native-worklets';

import { parseOrientation, spacesFor } from './analysisGeometry';
import { frameToScanImage, pixelOrderFor } from './frameToScanImage';
import { HIRES_MAX_LONG_EDGE } from './hiresCapture';
import { PORTRAIT_OUTPUT_ORIENTATION } from './orientationLifecycle';
import type { ScanImage } from './sharedCore';

const TARGET = { height: 1920, width: 1440 };

export const useHiResFrameLatch = (opts: {
  enabled?: boolean;
  previewSize: { height: number; width: number };
}) => {
  const { enabled = true, previewSize } = opts;
  const previewRef = useRef(previewSize);
  previewRef.current = previewSize;
  const waiter = useRef<{
    reject: (err: Error) => void;
    resolve: (image: ScanImage) => void;
  } | null>(null);
  const [armed, setArmed] = useState(false);

  const finish = useCallback((image: ScanImage | null, error?: string) => {
    const pending = waiter.current;
    waiter.current = null;
    setArmed(false);
    if (!pending) return;
    if (image) pending.resolve(image);
    else pending.reject(new Error(error ?? 'hi-res frame failed'));
  }, []);

  const onPixels = useCallback(
    (
      bytes: ArrayBuffer,
      width: number,
      height: number,
      bytesPerRow: number,
      orientation: string,
      isMirrored: boolean,
      pixelFormat: string,
    ) => {
      if (width <= 0) {
        finish(null, 'hi-res frame had no pixel buffer');
        return;
      }
      try {
        const pixelOrder = pixelOrderFor(pixelFormat, Platform.OS);
        if (!pixelOrder) throw new Error(`hi-res frame format '${pixelFormat}'`);
        const orient = parseOrientation(orientation);
        const spaces = spacesFor(
          { height, width },
          orient,
          previewRef.current,
          HIRES_MAX_LONG_EDGE,
        );
        const image = frameToScanImage(
          {
            bytes: new Uint8Array(bytes),
            bytesPerRow,
            height,
            isMirrored,
            orientation: orient,
            pixelOrder,
            width,
          },
          { crop: spaces.visible, maxLongEdge: HIRES_MAX_LONG_EDGE },
        );
        finish(image);
      } catch (err) {
        finish(null, err instanceof Error ? err.message : String(err));
      }
    },
    [finish],
  );

  const onFrame = useCallback(
    (frame: Frame) => {
      'worklet';
      try {
        if (!frame.hasPixelBuffer || frame.isPlanar) {
          scheduleOnRN(onPixels, new ArrayBuffer(0), 0, 0, 0, '', false, '');
          return;
        }
        let copy: Uint8Array;
        let stride = frame.bytesPerRow;
        // Prefer plane 0 for RGB (CameraX documents R,G,B,A there).
        try {
          const planes = frame.getPlanes();
          if (planes.length > 0) {
            const source = new Uint8Array(planes[0].getPixelBuffer());
            copy = new Uint8Array(source.length);
            copy.set(source);
            stride = planes[0].bytesPerRow;
          } else {
            throw new Error('no planes');
          }
        } catch {
          const source = new Uint8Array(frame.getPixelBuffer());
          copy = new Uint8Array(source.length);
          copy.set(source);
        }
        scheduleOnRN(
          onPixels,
          copy.buffer as ArrayBuffer,
          frame.width,
          frame.height,
          stride,
          frame.orientation,
          frame.isMirrored,
          frame.pixelFormat,
        );
      } finally {
        frame.dispose();
      }
    },
    [onPixels],
  );

  const frameOutput = useFrameOutput({
    dropFramesWhileBusy: true,
    onFrame: enabled && armed ? onFrame : undefined,
    pixelFormat: 'rgb',
    targetResolution: TARGET,
  });

  useLayoutEffect(() => {
    frameOutput.outputOrientation = PORTRAIT_OUTPUT_ORIENTATION;
  }, [frameOutput]);

  const take = useCallback((): Promise<ScanImage> => {
    if (waiter.current) return Promise.reject(new Error('hi-res frame already armed'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (waiter.current) {
          waiter.current = null;
          setArmed(false);
          reject(new Error('hi-res frame timed out'));
        }
      }, 2000);
      waiter.current = {
        reject: err => {
          clearTimeout(timer);
          reject(err);
        },
        resolve: image => {
          clearTimeout(timer);
          resolve(image);
        },
      };
      setArmed(true);
    });
  }, []);

  return { armed, frameOutput, take };
};
