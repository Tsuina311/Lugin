// On-device OCR via Tesseract. Lazy-loaded so opening Collection doesn't pay for it.
//
// Languages: English + French + German + Italian (Latin script). First open downloads
// the traineddata packs; later scans reuse the same worker.

import { createWorker, PSM, type Worker } from 'tesseract.js';

/** EN / FR / DE / IT — matches the print languages we care about most. */
export const OCR_LANGS = 'eng+fra+deu+ita';

export type ReadTextOptions = {
  /** Page segmentation — titles use a single-line/block mode. */
  psm?: string | number;
  whitelist?: string;
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

/** Read text from a canvas. */
export const readText = async (
  canvas: HTMLCanvasElement,
  opts?: string | ReadTextOptions,
): Promise<string> => {
  const options: ReadTextOptions =
    typeof opts === 'string' ? { whitelist: opts } : (opts ?? {});
  const w = await getWorker();
  await w.setParameters({
    tessedit_char_whitelist: options.whitelist ?? '',
    ...(options.psm != null
      ? { tessedit_pageseg_mode: options.psm as typeof PSM.AUTO }
      : { tessedit_pageseg_mode: PSM.AUTO }),
  });
  const { data } = await w.recognize(canvas);
  return data.text ?? '';
};

/** Single-line title OCR — best when the name bar fills the crop. */
export const readTitleLine = (canvas: HTMLCanvasElement): Promise<string> =>
  readText(canvas, {
    psm: PSM.SINGLE_LINE,
    whitelist:
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåæçèéêëìíîïñòóôõöùúûüýÿ0123456789,',. -",
  });

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
