// Capture-quality corpus — NOT the recognition accuracy gate.
// Good/bad physical captures. Do not mix into yarn scan:regression.
//
// Sleeve truth for 2026-09-08 Samsung sessions: every card was sleeved
// except the Island / Île fixture labeled "unsleeved". The set is not
// balanced. Do not infer sleeve-vs-unsleeved behavior from it.

export const QUALITY_SELECTED = [
  {
    aliases: ['teferis-veil-good'],
    expectedName: "Teferi's Veil",
    inboxSession: 'phone-20260908',
    inboxTrace: 'teferi-veil-old-edition-good-cap-20260908T111548',
    kind: 'good-capture',
    note: 'Sleeved. Valid recognition fixture. Title pixels are usable.',
    sleeved: true,
  },
  {
    aliases: ['teferis-veil-bad'],
    expectedName: "Teferi's Veil",
    inboxSession: 'phone-20260908',
    inboxTrace: 'teferi-veil-old-edition-20260908T111452',
    kind: 'bad-capture',
    note: 'Sleeved. Card was acquired; recognition frame/title crop is poor. Not an acquisition miss.',
    sleeved: true,
  },
];

/** Known physical sleeve state. Report-only; does not change the scanner. */
export const SLEEVE_TRUTH = {
  'island unsleeved': false,
  "Teferi's Veil old edition": true,
  'Wand of Wonder': true,
  'Lizard Blades French': true,
  'lizard blade (french)': true,
  'Livaan, Cultist of Tiamat foil': true,
};
