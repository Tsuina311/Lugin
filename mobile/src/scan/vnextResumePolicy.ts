/** vNext recovery is development-only and must never run while its flag is off. */
export const shouldResumeVNextSavedCards = (
  benchmarkToolsEnabled: boolean,
  scannerVNextEnabled: boolean,
): boolean => benchmarkToolsEnabled && scannerVNextEnabled;
