/**
 * The capture button must accept another card one second after a tap.
 * Naming and the full-size save wait until that window is clear, so they
 * do not hold the button on "Captured".
 */

let idleAt = 0;

export const CAPTURE_GAP_MS = 1000;

export const holdScannerWork = (ms = CAPTURE_GAP_MS): void => {
  idleAt = Math.max(idleAt, Date.now() + ms);
};

export const waitUntilCaptureGap = async (): Promise<void> => {
  while (Date.now() < idleAt) {
    const wait = Math.min(50, idleAt - Date.now());
    await new Promise<void>(resolve => {
      setTimeout(resolve, Math.max(0, wait));
    });
  }
};
