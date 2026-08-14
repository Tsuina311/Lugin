// Feature flags — the single place to toggle experimental / developer-only UI.
//
// These surfaces were useful while building the extension (inspecting network
// traffic, copying raw page HTML to fix parsers) but aren't meant for end users.
// Flip a flag to `true` here to bring the corresponding UI back everywhere.

export const flags = {
  /**
   * Developer tools: the Traffic + API tabs and the "Copy …" raw-HTML buttons
   * scattered through the Cards panel. Keep false for a clean end-user build.
   */
  devTools: false,

  /**
   * Scanner diagnostics: per-stage timings, the perspective-corrected card, every
   * OCR crop with its confidence, and the candidate ranking. Essential while
   * tuning recognition, meaningless noise for an end user. Everything it shows
   * stays on the device.
   */
  scanDebug: false,
};
