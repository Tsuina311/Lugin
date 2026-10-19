/** Values a repository statement may bind. */
export type SqlValue = string | number | null;

export type SqlRow = Record<string, SqlValue>;

/**
 * The small SQL surface the library repository needs.
 *
 * Expo SQLite on the phone and `node:sqlite` in tests both adapt to this.
 * The repository never imports either one.
 */
export interface SqlExecutor {
  all(sql: string, params?: readonly SqlValue[]): Promise<SqlRow[]>;
  exec(sql: string): Promise<void>;
  get(sql: string, params?: readonly SqlValue[]): Promise<SqlRow | null>;
  run(sql: string, params?: readonly SqlValue[]): Promise<void>;
  /** Nested calls join the outer transaction instead of starting another. */
  transaction<T>(work: () => Promise<T>): Promise<T>;
}
