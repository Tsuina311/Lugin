// On-device OCR via Tesseract. Lazy-loaded so opening Collection doesn't pay for it.
//
// Languages: English + French + German + Italian (Latin script). First open downloads
// the traineddata packs; later scans reuse the same worker.

import { createWorker, type Worker } from 'tesseract.js';

/** EN / FR / DE / IT — matches the print languages we care about most. */
export const OCR_LANGS = 'eng+fra+deu+ita';

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

/** Read text from a canvas. `whitelist` narrows what Tesseract will invent. */
export const readText = async (
  canvas: HTMLCanvasElement,
  whitelist?: string,
): Promise<string> => {
  const w = await getWorker();
  if (whitelist) {
    await w.setParameters({
      tessedit_char_whitelist: whitelist,
    });
  } else {
    await w.setParameters({ tessedit_char_whitelist: '' });
  }
  const { data } = await w.recognize(canvas);
  return data.text ?? '';
};

/** Collector strip: digits, letters, and the foil markers OCR might emit. */
export const COLLECTOR_WHITELIST =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/•★*·. ';

/** Expansion-symbol crop: set codes only (e.g. M11, CMR, 2XM). */
export const SET_SYMBOL_WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export const disposeOcr = async (): Promise<void> => {
  if (worker) {
    await worker.terminate();
    worker = null;
    starting = null;
  }
};
