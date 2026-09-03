// VisionCamera Photo / nitro-image Image → ScanImage.
//
// Native-only. Pixel math lives in rawPixelsToScanImage.

import type { Image } from 'react-native-nitro-image';
import type { Photo } from 'react-native-vision-camera';

import { HIRES_MAX_LONG_EDGE } from './hiresCapture';
import { parsePixelOrder, rawPixelsToScanImage } from './rawPixelsToScanImage';
import type { ScanImage } from './sharedCore';

export const imageToScanImage = async (
  image: Image,
  maxLongEdge = HIRES_MAX_LONG_EDGE,
): Promise<ScanImage> => {
  const raw = await image.toRawPixelDataAsync(false);
  const order = parsePixelOrder(raw.pixelFormat);
  if (!order) {
    throw new Error(`Unsupported snapshot pixel format '${raw.pixelFormat}'`);
  }
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
