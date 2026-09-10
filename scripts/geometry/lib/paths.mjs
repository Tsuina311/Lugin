import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const rootDir = join(dirname(fileURLToPath(import.meta.url)), '../../..');

export const CORPUS_ROOT = join(rootDir, '.geometry-corpus');
export const FIXTURES_DIR = join(CORPUS_ROOT, 'fixtures');
export const TRAIN_DIR = join(CORPUS_ROOT, 'train');
export const VALIDATION_DIR = join(CORPUS_ROOT, 'validation');
export const TEST_DIR = join(CORPUS_ROOT, 'test');
export const HARD_DIR = join(CORPUS_ROOT, 'hard');
export const MANIFEST_PATH = join(CORPUS_ROOT, 'manifest.json');
export const SPLITS_PATH = join(CORPUS_ROOT, 'splits.json');

export const BENCHMARKS_ROOT = join(rootDir, '.geometry-benchmarks');
export const RUNS_DIR = join(BENCHMARKS_ROOT, 'runs');
export const BASELINE_PATH = join(BENCHMARKS_ROOT, 'baseline-v1.json');

export const INBOX_SESSIONS = join(rootDir, '.scan-inbox/sessions');
export const REPLAY_ROOT = join(rootDir, '.scan-fixtures/replay');
export const SCAN_REAL = join(rootDir, '.scan-real');
export const REAL_PHOTOS = join(rootDir, '.scan-fixtures/real-photos');
export const SCAN_CORPUS_DOWNLOAD = join(rootDir, '.scan-corpus/download');

export const SCHEMA_VERSION = 1;
export const DETECTOR_ENGINE = 'shared-js-detectCardQuad';
export const DETECTOR_VERSION = 'shared-js@params.ts';
