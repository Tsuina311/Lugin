// SQLite as the native library.
//
// The sync engine still speaks ApplicationData. This stores that document and
// keeps indexed rows beside it. Sync reads the document, so an unknown field
// on a card is still there after a round trip.

import { MIGRATIONS } from './schema';
import type { SqlExecutor, SqlValue } from './types';
import { assertDomainValue } from './validate';

import {
  emptyData,
  emptyMeta,
  type ApplicationData,
  type DomainKey,
  type SyncMeta,
} from '@/core/sync/model';
import type { LocalRepository } from '@/core/sync/repository';
import { cardKey } from '@/lib/cardName';
import type { CollectionCard, StoredCollection } from '@/lib/collection';
import type { Deck } from '@/lib/deck';
import type { CardImageOverride } from '@/lib/printing';


const EPOCH = new Date(0).toISOString();

const assignDomain = (
  data: ApplicationData,
  key: DomainKey,
  updatedAt: string,
  value: unknown,
): void => {
  if (key === 'collection') {
    data.collection = { updatedAt, value: value as ApplicationData['collection']['value'] };
  } else if (key === 'decks') {
    data.decks = { updatedAt, value: value as ApplicationData['decks']['value'] };
  } else if (key === 'preferences') {
    data.preferences = { updatedAt, value: value as ApplicationData['preferences']['value'] };
  } else {
    data.printings = { updatedAt, value: value as ApplicationData['printings']['value'] };
  }
};

const newDeviceId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `native-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export interface LibraryRepository extends LocalRepository {
  counts(): Promise<{ copies: number; rows: number }>;
  /** Replace one domain as this device's own edit and mark it dirty. */
  edit<K extends DomainKey>(domain: K, value: ApplicationData[K]['value']): Promise<ApplicationData>;
  persistent(): boolean;
  searchCards(query: string, limit: number): Promise<CollectionCard[]>;
}

export interface SqliteLibraryOptions {
  deviceId?: string;
  now?: () => string;
}

const text = (row: { payload: SqlValue } | null): unknown => {
  if (!row || typeof row.payload !== 'string') return undefined;
  return JSON.parse(row.payload);
};

export const migrate = async (db: SqlExecutor): Promise<void> => {
  await db.exec('PRAGMA foreign_keys = ON');
  await db.exec('PRAGMA journal_mode = WAL');
  await db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY NOT NULL)',
  );
  const row = await db.get('SELECT MAX(version) AS version FROM schema_migrations');
  const current = typeof row?.version === 'number' ? row.version : 0;
  for (let i = current; i < MIGRATIONS.length; i++) {
    const version = i + 1;
    const sql = MIGRATIONS[i];
    await db.transaction(async () => {
      await db.exec(sql);
      await db.run('INSERT INTO schema_migrations (version) VALUES (?)', [version]);
    });
  }
};

export const createSqliteLocalRepository = async (
  db: SqlExecutor,
  options: SqliteLibraryOptions = {},
): Promise<LibraryRepository> => {
  const now = options.now ?? (() => new Date().toISOString());
  await migrate(db);

  const readMeta = async (): Promise<SyncMeta> => {
    const row = await db.get(
      'SELECT device_id, base_json, base_revision, dirty_at, last_pulled_at, last_pushed_at FROM sync_metadata WHERE id = 1',
    );
    if (!row || typeof row.device_id !== 'string') {
      const meta = emptyMeta(options.deviceId ?? newDeviceId());
      await db.run(
        `INSERT INTO sync_metadata (id, device_id, base_json, base_revision, dirty_at, last_pulled_at, last_pushed_at)
         VALUES (1, ?, ?, NULL, NULL, NULL, NULL)`,
        [meta.deviceId, JSON.stringify(meta.base)],
      );
      return meta;
    }
    const base = JSON.parse(typeof row.base_json === 'string' ? row.base_json : '{}') as SyncMeta['base'];
    return {
      base,
      baseRevision: typeof row.base_revision === 'string' ? row.base_revision : null,
      deviceId: row.device_id,
      dirtyAt: typeof row.dirty_at === 'string' ? row.dirty_at : null,
      lastPulledAt: typeof row.last_pulled_at === 'string' ? row.last_pulled_at : null,
      lastPushedAt: typeof row.last_pushed_at === 'string' ? row.last_pushed_at : null,
    };
  };

  const read = async (): Promise<ApplicationData> => {
    const rows = await db.all('SELECT key, updated_at, payload FROM domains');
    if (rows.length === 0) return emptyData(EPOCH);
    const data = emptyData(EPOCH);
    for (const row of rows) {
      if (typeof row.key !== 'string' || typeof row.updated_at !== 'string' || typeof row.payload !== 'string') {
        throw new Error('A stored domain is unreadable');
      }
      const key = row.key as DomainKey;
      if (!['collection', 'decks', 'preferences', 'printings'].includes(key)) continue;
      assignDomain(data, key, row.updated_at, JSON.parse(row.payload));
    }
    return data;
  };

  const projectCollection = async (value: StoredCollection | null): Promise<void> => {
    await db.run('DELETE FROM collection_items');
    const cards = value?.cards ?? [];
    for (const card of cards) {
      await db.run(
        `INSERT INTO collection_items
           (name, name_key, quantity, foil, set_code, collector_number, scryfall_id, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          card.name,
          cardKey(card.name),
          card.quantity > 0 ? card.quantity : 1,
          card.foil ? 1 : 0,
          card.setCode ?? null,
          card.collectorNumber ?? null,
          card.scryfallId ?? null,
          JSON.stringify(card),
        ],
      );
    }
  };

  const projectDecks = async (decks: readonly Deck[]): Promise<void> => {
    await db.run('DELETE FROM deck_cards');
    await db.run('DELETE FROM decks');
    for (const deck of decks) {
      await db.run(
        'INSERT INTO decks (id, name, format, updated_at, payload) VALUES (?, ?, ?, ?, ?)',
        [deck.id, deck.name, deck.format, deck.updatedAt ?? 0, JSON.stringify(deck)],
      );
      for (let position = 0; position < deck.cards.length; position++) {
        const card = deck.cards[position];
        if (!card) continue;
        await db.run(
          `INSERT INTO deck_cards (deck_id, name, name_key, section, quantity, position, payload)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            deck.id,
            card.name,
            cardKey(card.name),
            card.section,
            card.quantity,
            position,
            JSON.stringify(card),
          ],
        );
      }
    }
  };

  const projectPrintings = async (value: Record<string, CardImageOverride>): Promise<void> => {
    await db.run('DELETE FROM chosen_printings');
    for (const [key, printing] of Object.entries(value)) {
      await db.run('INSERT INTO chosen_printings (card_key, payload) VALUES (?, ?)', [
        key,
        JSON.stringify(printing),
      ]);
    }
  };

  const projectPreferences = async (updatedAt: string, value: unknown): Promise<void> => {
    await db.run('DELETE FROM preferences');
    await db.run('INSERT INTO preferences (id, updated_at, payload) VALUES (1, ?, ?)', [
      updatedAt,
      JSON.stringify(value),
    ]);
  };

  const project = async (domain: DomainKey, updatedAt: string, value: unknown): Promise<void> => {
    if (domain === 'collection') await projectCollection(value as StoredCollection | null);
    else if (domain === 'decks') await projectDecks(value as Deck[]);
    else if (domain === 'printings') await projectPrintings(value as Record<string, CardImageOverride>);
    else await projectPreferences(updatedAt, value);
  };

  const saveDomain = async (domain: DomainKey, updatedAt: string, value: unknown): Promise<void> => {
    assertDomainValue(domain, value);
    const previous = await db.get('SELECT payload FROM domains WHERE key = ?', [domain]);
    if (previous && typeof previous.payload === 'string') {
      await db.run('INSERT INTO domain_backups (domain, saved_at, payload) VALUES (?, ?, ?)', [
        domain,
        now(),
        previous.payload,
      ]);
    }
    await db.run(
      `INSERT INTO domains (key, updated_at, payload) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET updated_at = excluded.updated_at, payload = excluded.payload`,
      [domain, updatedAt, JSON.stringify(value)],
    );
    await project(domain, updatedAt, value);
  };

  return {
    counts: async () => {
      const row = await db.get(
        'SELECT COUNT(*) AS rows, COALESCE(SUM(quantity), 0) AS copies FROM collection_items',
      );
      return {
        copies: typeof row?.copies === 'number' ? row.copies : 0,
        rows: typeof row?.rows === 'number' ? row.rows : 0,
      };
    },

    edit: async (domain, value) => {
      await readMeta();
      const at = now();
      await db.transaction(async () => {
        await saveDomain(domain, at, value);
        await db.run('UPDATE sync_metadata SET dirty_at = ? WHERE id = 1', [at]);
      });
      return read();
    },

    persistent: () => true,

    read,

    readMeta,

    searchCards: async (query, limit) => {
      const needle = `%${query.trim()}%`;
      const rows = await db.all(
        `SELECT payload FROM collection_items
         WHERE name LIKE ? COLLATE NOCASE
         ORDER BY name
         LIMIT ?`,
        [needle, limit],
      );
      return rows.map(row => text(row as { payload: SqlValue }) as CollectionCard);
    },

    write: async (data, changed) => {
      for (const domain of changed) assertDomainValue(domain, data[domain].value);
      await db.transaction(async () => {
        for (const domain of changed) {
          await saveDomain(domain, data[domain].updatedAt, data[domain].value);
        }
      });
    },

    writeMeta: async patch => {
      const meta = { ...(await readMeta()), ...patch };
      await db.run(
        `UPDATE sync_metadata
         SET device_id = ?, base_json = ?, base_revision = ?, dirty_at = ?, last_pulled_at = ?, last_pushed_at = ?
         WHERE id = 1`,
        [
          meta.deviceId,
          JSON.stringify(meta.base),
          meta.baseRevision,
          meta.dirtyAt,
          meta.lastPulledAt,
          meta.lastPushedAt,
        ],
      );
    },
  };
};
