// Tesseract-backed TextRecognizer. The only file in the app that imports tesseract.js.
//
// Lazy-loaded so opening Collection doesn't pay for the traineddata download.

import { createWorker, PSM, type Worker } from 'tesseract.js';

import { toCanvas } from './canvasBridge';

import {
  meanConfidence,
  type RecognitionMode,
  type RecognizeOptions,
  type TextRecognitionResult,
  type TextRecognizer,
  type RecognizedWord,
} from '@/lib/scan/textRecognizer';
import type { ScanImage } from '@/lib/scan/types';

/**
 * EN / FR / DE / IT — the print languages we care about most.
 *
 * Not free: four traineddata packs is a ~10–15 MB first-scan download and a much
 * larger search space for a two-word title. Phase B measures English-only
 * against this before deciding what to load by default.
 */
export const OCR_LANGS = 'eng+fra+deu+ita';

const PAGE_MODE: Record<RecognitionMode, PSM> = {
  block: PSM.AUTO,
  line: PSM.SINGLE_LINE,
  word: PSM.SINGLE_WORD,
};

let worker: Worker | null = null;
let starting: Promise<Worker> | null = null;

const getWorker = async (): Promise<Worker> => {
  if (worker) return worker;
  starting ??= (async () => {
    const w = await createWorker(OCR_LANGS, 1, {
      // Keep logs quiet in production; failures still throw.
      logger: () => undefined,
    });
    worker = w;
    return w;
  })();
  return starting;
};

/**
 * One job at a time.
 *
 * `setParameters` and `recognize` are separate jobs on one worker queue, so
 * firing several differently-configured reads concurrently could apply the last
 * caller's whitelist and page mode to every image. Serializing is what makes a
 * recorded OCR sample trustworthy.
 */
let queue: Promise<unknown> = Promise.resolve();

const serialize = <T>(job: () => Promise<T>): Promise<T> => {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
};

/** The shapes we read out of tesseract.js, which vary by version and output flags. */
interface TessWord {
  bbox?: { x0: number; x1: number; y0: number; y1: number };
  confidence?: number;
  text?: string;
}
interface TessResult {
  blocks?: Array<{ paragraphs?: Array<{ lines?: Array<{ words?: TessWord[] }> }> }> | null;
  confidence?: number;
  text?: string;
  words?: TessWord[];
}

const collectWords = (result: TessResult): RecognizedWord[] => {
  const raw: TessWord[] = result.words?.length
    ? result.words
    : (result.blocks ?? []).flatMap(
        block =>
          block.paragraphs?.flatMap(paragraph => paragraph.lines?.flatMap(line => line.words ?? []) ?? []) ??
          [],
      );

  return raw
    .filter((word): word is TessWord => Boolean(word?.text))
    .map(word => ({
      ...(word.bbox
        ? {
            boundingBox: {
              h: word.bbox.y1 - word.bbox.y0,
              w: word.bbox.x1 - word.bbox.x0,
              x: word.bbox.x0,
              y: word.bbox.y0,
            },
          }
        : {}),
      confidence: (word.confidence ?? 0) / 100,
      text: word.text ?? '',
    }));
};

export const tesseractRecognizer: TextRecognizer = {
  recognize: (image: ScanImage, options: RecognizeOptions = {}) =>
    serialize(async () => {
      const w = await getWorker();
      await w.setParameters({
        tessedit_char_whitelist: options.whitelist ?? '',
        tessedit_pageseg_mode: PAGE_MODE[options.mode ?? 'block'],
      });
      const { data } = await w.recognize(toCanvas(image), {}, { blocks: true, text: true });
      const result = data as unknown as TessResult;
      const words = collectWords(result);
      return {
        // Prefer per-word confidence; fall back to the engine's page score.
        confidence: words.length ? meanConfidence(words) : (result.confidence ?? 0) / 100,
        text: result.text ?? '',
        words,
      } satisfies TextRecognitionResult;
    }),
};

export const disposeOcr = async (): Promise<void> => {
  if (worker) {
    await worker.terminate();
    worker = null;
    starting = null;
  }
};
