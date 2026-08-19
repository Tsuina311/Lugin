// What a card cost, derived from Cardmarket order lines.
//
// Pure and dependency-free so it can be tested directly (`yarn test:import`).
// That matters more here than the line count suggests: a cost basis that is
// quietly wrong produces a portfolio gain that is quietly wrong, and nobody
// cross-checks a number that looks plausible.
//
// Currency is deliberately not modelled. Prices are parsed off order pages in the
// account's own display currency, and nothing mixes two accounts — the same
// assumption the spend totals in `CollectionPanel` already make.

/** Money paid for some number of copies, and how many of them it covered. */
export interface Paid {
  /** Copies whose price we actually know — not the copies owned. */
  qty: number;
  spent: number;
}

/** The fields of an order line this module needs. */
export interface PricedLine {
  price?: number;
  qty?: number;
}

/**
 * Add one order line to a running cost.
 *
 * Lines with no parsed price are skipped rather than counted as free. Dividing by
 * the priced quantity rather than the owned quantity is the entire reason `qty` is
 * tracked separately: an order page that yielded a price for one of two copies
 * would otherwise report half the true basis.
 */
export const addPaid = (into: Map<string, Paid>, key: string, line: PricedLine, qty: number): void => {
  if (line.price === undefined || !Number.isFinite(line.price) || qty <= 0) return;
  const held = into.get(key) ?? { qty: 0, spent: 0 };
  into.set(key, { qty: held.qty + qty, spent: held.spent + line.price * qty });
};

/** Every priced line rolled together, ignoring which printing it was. */
export const everyPaid = (lines: readonly PricedLine[] = []): Paid | undefined => {
  const all = new Map<string, Paid>();
  for (const line of lines) addPaid(all, 'all', line, line.qty ?? 1);
  return all.get('all');
};

/**
 * The `purchasePrice` fragment to spread onto a collection row, or nothing.
 *
 * A quantity-weighted average, matching `blendCost` in `duplicates.ts`: one row
 * stands for every copy of a printing, so its basis has to as well.
 */
export const withCost = (paid: Paid | undefined): { purchasePrice?: number } => {
  if (!paid || paid.qty <= 0 || paid.spent <= 0) return {};
  // To the cent, or an untouched card reports a gain of 0,003 €.
  return { purchasePrice: Math.round((paid.spent / paid.qty) * 100) / 100 };
};
