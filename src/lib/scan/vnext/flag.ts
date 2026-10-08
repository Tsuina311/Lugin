/**
 * Development-only Scanner vNext switch. Default OFF.
 * Production recognition does not read this. The phone checks it only at the
 * start of a recognition attempt, and only when developer tools are enabled.
 */

let enabled = false;

export const isScannerVNextEnabled = (): boolean => enabled;

export const setScannerVNextEnabled = (value: boolean): void => {
  enabled = value;
};
