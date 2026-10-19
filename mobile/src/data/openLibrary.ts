import { createFileLibraryRepository } from './fileRepository';

import { createSqliteLocalRepository, type LibraryRepository } from '@/platform/sqlite/localRepository';
import type { SqlExecutor, SqlRow, SqlValue } from '@/platform/sqlite/types';


export interface OpenLibrary {
  repo: LibraryRepository;
  storage: 'file' | 'sqlite';
}

const expoExecutor = (db: {
  execAsync(source: string): Promise<void>;
  getAllAsync<T>(source: string, ...params: SqlValue[]): Promise<T[]>;
  getFirstAsync<T>(source: string, ...params: SqlValue[]): Promise<T | null>;
  runAsync(source: string, ...params: SqlValue[]): Promise<unknown>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}): SqlExecutor => {
  let depth = 0;
  return {
    all: async (sql, params = []) => (await db.getAllAsync<SqlRow>(sql, ...params)) ?? [],
    exec: sql => db.execAsync(sql),
    get: async (sql, params = []) => (await db.getFirstAsync<SqlRow>(sql, ...params)) ?? null,
    run: async (sql, params = []) => {
      await db.runAsync(sql, ...params);
    },
    transaction: async work => {
      if (depth > 0) return work();
      const box: { value?: Awaited<ReturnType<typeof work>> } = {};
      depth += 1;
      try {
        await db.withTransactionAsync(async () => {
          box.value = await work();
        });
        return box.value as Awaited<ReturnType<typeof work>>;
      } finally {
        depth -= 1;
      }
    },
  };
};

/** SQLite when this binary has it. Otherwise the file document, which still survives a restart. */
export const openLibrary = async (): Promise<OpenLibrary> => {
  try {
    const SQLite = await import('expo-sqlite');
    const db = await SQLite.openDatabaseAsync('lugin-library.db');
    const repo = await createSqliteLocalRepository(expoExecutor(db));
    return { repo, storage: 'sqlite' };
  } catch {
    return { repo: await createFileLibraryRepository(), storage: 'file' };
  }
};
