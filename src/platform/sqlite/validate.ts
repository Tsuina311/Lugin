// Boundary check for a domain value before it replaces what is stored.
//
// Loose on purpose: the Drive reader already accepts older documents, and
// unknown card fields have to survive. This rejects a payload that is not a
// collection, a deck list, preferences, or a printing map — and nothing else.

import { z } from 'zod';

import type { DomainKey } from '@/core/sync/model';

const cardSchema = z
  .object({
    foil: z.boolean().optional(),
    name: z.string().min(1),
    quantity: z.number().finite().positive().optional(),
  })
  .passthrough();

const collectionSchema = z
  .object({
    cards: z.array(cardSchema),
    format: z.enum(['list', 'manabox']).optional(),
    importedAt: z.number().finite().optional(),
    source: z.string().optional(),
  })
  .passthrough();

const deckCardSchema = z
  .object({
    name: z.string().min(1),
    quantity: z.number().finite().positive().optional(),
    section: z.string().optional(),
  })
  .passthrough();

const deckSchema = z
  .object({
    cards: z.array(deckCardSchema),
    id: z.string().min(1),
  })
  .passthrough();

const preferencesSchema = z
  .object({
    addPurchasesToCollection: z.boolean().optional(),
    homeCountry: z.number().finite().nullable().optional(),
    theme: z.enum(['dark', 'site']).optional(),
  })
  .passthrough();

const printingSchema = z
  .object({
    collectorNumber: z.string().optional(),
    imageUrl: z.string().optional(),
    scryfallId: z.string().optional(),
    setCode: z.string().optional(),
    setName: z.string().optional(),
  })
  .passthrough();

const printingsSchema = z.record(z.string(), printingSchema);

export class InvalidLibraryError extends Error {
  constructor(readonly domain: DomainKey, detail: string) {
    super(`Refusing to store ${domain}: ${detail}`);
    this.name = 'InvalidLibraryError';
  }
}

/** Accept a domain value, or throw without having written it. */
export const assertDomainValue = (domain: DomainKey, value: unknown): void => {
  const parsed = (() => {
    if (domain === 'collection') return value === null ? { success: true as const } : collectionSchema.safeParse(value);
    if (domain === 'decks') return z.array(deckSchema).safeParse(value);
    if (domain === 'preferences') return preferencesSchema.safeParse(value);
    return printingsSchema.safeParse(value);
  })();
  if (!parsed.success) {
    const detail = 'error' in parsed ? parsed.error.issues.map(issue => issue.message).join('; ') : 'unreadable';
    throw new InvalidLibraryError(domain, detail);
  }
};
