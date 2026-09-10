// RGBA buffer contract for the title-OCR path.
//
// ScanImage is packed RGBA like ImageData (R,G,B,A per pixel, stride = width*4).
// Native `recognizeFromRgbaBytes` documents the same layout and converts to
// ARGB_8888 itself. Do not invent a different channel order or Y-plane stride.

import { NAME_REGION } from './regions';
import {
  cropRect,
  regionToRect,
  type Rect,
  type ScanImage,
} from './types';

/** Portable ScanImage / crop / enhance output. */
export const INPUT_CHANNEL_ORDER = 'RGBA' as const;

/**
 * What `LuginOcrModule.recognizeFromRgbaBytes` documents and `rgbaToBitmap` reads.
 * Native then packs ARGB_8888 for Bitmap — that conversion is native-side only.
 */
export const NATIVE_EXPECTED_CHANNEL_ORDER = 'RGBA' as const;

export const RGBA_CHANNELS = 4;

export const expectedRgbaByteLength = (width: number, height: number): number =>
  width * height * RGBA_CHANNELS;

export interface RgbaBufferCheck {
  actualByteLength: number;
  alphaHandling: 'straight-unpremultiplied';
  channelOrder: typeof INPUT_CHANNEL_ORDER;
  channels: typeof RGBA_CHANNELS;
  expectedByteLength: number;
  height: number;
  nativeExpectedChannelOrder: typeof NATIVE_EXPECTED_CHANNEL_ORDER;
  ocrInputInvalid: boolean;
  ok: boolean;
  rowStrideBytes: number;
  width: number;
}

export const validateRgbaScanImage = (image: ScanImage): RgbaBufferCheck => {
  const expectedByteLength = expectedRgbaByteLength(image.width, image.height);
  const actualByteLength = image.data.byteLength;
  const ok = actualByteLength === expectedByteLength && image.width > 0 && image.height > 0;
  return {
    actualByteLength,
    alphaHandling: 'straight-unpremultiplied',
    channelOrder: INPUT_CHANNEL_ORDER,
    channels: RGBA_CHANNELS,
    expectedByteLength,
    height: image.height,
    nativeExpectedChannelOrder: NATIVE_EXPECTED_CHANNEL_ORDER,
    ocrInputInvalid: !ok,
    ok,
    rowStrideBytes: image.width * RGBA_CHANNELS,
    width: image.width,
  };
};

/** Packed view of the ScanImage bytes that native OCR should receive. */
export const packedRgbaBytes = (image: ScanImage): Uint8Array =>
  new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength);

/** FNV-1a over the pixel buffer — cheap identity for duplicate-input skip. */
export const hashScanImage = (image: ScanImage): string => {
  let h = 2166136261;
  const data = image.data;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i];
    h = Math.imul(h, 16777619);
  }
  return `${image.width}x${image.height}:${(h >>> 0).toString(16)}`;
};

export const titleCropRect = (card: ScanImage): Rect => regionToRect(card, NAME_REGION);

export const extractTitleCrop = (card: ScanImage): { image: ScanImage; rect: Rect } => {
  const rect = titleCropRect(card);
  return { image: cropRect(card, rect), rect };
};

export const ocrInputHashFor = (recognitionHash: string, titleCropHash: string): string =>
  `${recognitionHash}|${titleCropHash}`;

export const shouldSkipDuplicateOcr = (args: {
  currentRecognitionHash: string;
  currentTitleCropHash: string;
  previousRecognitionHash: string | null;
  previousStatus: string | null;
  previousTitleCropHash: string | null;
}): boolean =>
  args.previousStatus === 'ocr-empty' &&
  args.previousRecognitionHash != null &&
  args.previousTitleCropHash != null &&
  args.previousRecognitionHash === args.currentRecognitionHash &&
  args.previousTitleCropHash === args.currentTitleCropHash;
