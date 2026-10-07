import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const rootDir = join(here, '../../..');
export const benchmarkDir = join(rootDir, 'scanner-benchmark');
export const manifestsDir = join(benchmarkDir, 'manifests');
export const annotationsDir = join(benchmarkDir, 'annotations');
export const reportsDir = join(benchmarkDir, 'reports');
export const experimentsDir = join(benchmarkDir, 'experiments');

export const inboxSessions = join(rootDir, '.scan-inbox/sessions');
export const replayRoot = join(rootDir, '.scan-fixtures/replay');
export const realPhotos = join(rootDir, '.scan-fixtures/real-photos');
export const scanReal = join(rootDir, '.scan-real');

export const DATASET_VERSION = 'stills-v1';

/** Repo-relative posix path. Rejects escapes. */
export const toRepoPath = abs => {
  const rel = relative(rootDir, abs);
  if (!rel || rel.startsWith('..') || rel.includes(`..${sep}`)) {
    throw new Error(`path escapes repo: ${abs}`);
  }
  return rel.split(sep).join('/');
};

const ALLOWED_PREFIXES = ['.scan-inbox/', '.scan-fixtures/', '.scan-real/', 'scanner-benchmark/'];

/** Resolve a repo-relative media path. Phone evidence and benchmark artifacts only. */
export const resolveSafeMedia = rel => {
  if (!rel || typeof rel !== 'string' || rel.includes('\0')) {
    throw new Error('missing path');
  }
  const abs = resolve(rootDir, rel);
  const repo = resolve(rootDir);
  if (abs !== repo && !abs.startsWith(repo + sep)) {
    throw new Error('path escapes repo');
  }
  const posix = relative(repo, abs).split(sep).join('/');
  if (!ALLOWED_PREFIXES.some(p => posix.startsWith(p) || posix === p.slice(0, -1))) {
    throw new Error(`path not in scanner corpus: ${posix}`);
  }
  return abs;
};
