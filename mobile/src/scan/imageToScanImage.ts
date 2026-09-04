// VisionCamera Photo / nitro-image Image → ScanImage.
//
// Native-only. Pixel math lives in rawPixelsToScanImage.

import { Platform } from 'react-native';
import type { Image } from 'react-native-nitro-image';
import type { Photo } from 'react-native-vision-camera';

import { HIRES_MAX_LONG_EDGE } from './hiresCapture';
import { parsePixelOrder, rawPixelsToScanImage, type RawPixelOrder } from './rawPixelsToScanImage';
import type { ScanImage } from './sharedCore';

/**
 * Nitro labels Android `ARGB_8888` bitmaps as `BGRA` (int / endian layout).
 * `copyPixelsToBuffer` for PreviewView / CameraX-derived bitmaps on device has
 * delivered R,G,B,A bytes instead — applying a BGRA→RGBA swap then turns red
 * cards blue and blue cards yellow. Trust sequential bytes as RGBA on Android.
 */
const orderForNitroBitmap = (reported: RawPixelOrder): RawPixelOrder => {
  if (Platform.OS === 'android' && reported === 'bgra') return 'rgba';
  return reported;
};

export const imageToScanImage = async (
  image: Image,
  maxLongEdge = HIRES_MAX_LONG_EDGE,
): Promise<ScanImage> => {
  const raw = await image.toRawPixelDataAsync(false);
  const parsed = parsePixelOrder(raw.pixelFormat);
  if (!parsed) {
    throw new Error(`Unsupported snapshot pixel format '${raw.pixelFormat}'`);
  }
  const order = orderForNitroBitmap(parsed);
  const bytes = new Uint8Array(raw.buffer);
  return rawPixelsToScanImage(
    {
      bytes,
      height: raw.height,
      pixelOrder: order,
      width: raw.width,
    },
    { maxLongEdge },
  );
};

export const photoToScanImage = async (
  photo: Photo,
  maxLongEdge = HIRES_MAX_LONG_EDGE,
): Promise<{ image: ScanImage; nativeSize: { height: number; width: number } }> => {
  const nativeSize = { height: photo.height, width: photo.width };
  const converted = await photo.toImageAsync();
  try {
    const image = await imageToScanImage(converted, maxLongEdge);
    return { image, nativeSize };
  } finally {
    converted.dispose();
  }
};
