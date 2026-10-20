/**
 * Versioned library schema.
 *
 * `domains` is the sync document: one JSON payload per domain, extra fields
 * included. The other tables are a projection for indexed lookup. A write
 * updates both in one transaction. Reads for sync come from `domains`.
 */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE domains (
    key TEXT PRIMARY KEY NOT NULL,
    updated_at TEXT NOT NULL,
    payload TEXT NOT NULL
  );

  CREATE TABLE collection_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    foil INTEGER NOT NULL,
    set_code TEXT,
    collector_number TEXT,
    scryfall_id TEXT,
    payload TEXT NOT NULL
  );
  CREATE INDEX idx_collection_items_name_key ON collection_items (name_key);
  CREATE INDEX idx_collection_items_name ON collection_items (name);

  CREATE TABLE decks (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    format TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    payload TEXT NOT NULL
  );

  CREATE TABLE deck_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deck_id TEXT NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL,
    section TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    position INTEGER NOT NULL,
    payload TEXT NOT NULL
  );
  CREATE INDEX idx_deck_cards_deck ON deck_cards (deck_id);

  CREATE TABLE preferences (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    updated_at TEXT NOT NULL,
    payload TEXT NOT NULL
  );

  CREATE TABLE chosen_printings (
    card_key TEXT PRIMARY KEY NOT NULL,
    payload TEXT NOT NULL
  );

  CREATE TABLE sync_metadata (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    device_id TEXT NOT NULL,
    base_json TEXT NOT NULL,
    base_revision TEXT,
    dirty_at TEXT,
    last_pulled_at TEXT,
    last_pushed_at TEXT
  );

  CREATE TABLE domain_backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT NOT NULL,
    saved_at TEXT NOT NULL,
    payload TEXT NOT NULL
  );
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_collection_items_scryfall ON collection_items (scryfall_id);
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;
