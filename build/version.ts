// What version is this, answered once for both builds.
//
// Shared rather than duplicated because the extension and the phone app are the
// same product: two surfaces reporting different versions of the same commit
// would make every "which one are you on?" conversation useless.
//
// The scheme is MAJOR.MINOR.<commits>:
//
//   - MAJOR and MINOR are declared in package.json and only move when a person
//     decides they should. See docs/VERSIONING.md for the rule.
//   - PATCH is `git rev-list --count HEAD`, so it moves on its own with every
//     commit and never repeats. That makes the third number a build number in
//     semver's clothing, which is the honest reading: a patch release and a
//     commit are the same event in a project that deploys from main.
//
// The count does not reset when MINOR moves. Resetting would mint two different
// builds with the same version — 1.1.0 following 1.0.87 — and Chrome refuses an
// extension update whose version went backwards, which is exactly how that
// mistake would be discovered.
//
// package.json's own patch digit is therefore unused. It stays at 0 as a hint
// that nothing reads it.

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export interface BuildVersion {
  /** Short commit, plus `+local` when built from an uncommitted tree. */
  id: string;
  /** "v1.0.42 · 5832413", for showing a human. */
  label: string;
  /** "1.0.42" — numeric only, safe for an extension manifest. */
  version: string;
}

export const buildVersion = (root: string): BuildVersion => {
  const git = (args: string): string => {
    try {
      return execSync(`git ${args}`, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim();
    } catch {
      // No git — a tarball, or a CI runner without the history.
      return '';
    }
  };

  const declared = (JSON.parse(readFileSync(`${root}package.json`, 'utf8')) as { version: string })
    .version;
  const [major = '1', minor = '0'] = declared.split('.');

  // A shallow clone counts only what it fetched, so a CI build would announce
  // itself as 1.0.1 while the same commit is 1.0.87 on the machine that pushed
  // it. Falling back to the declared patch is no better, so this asks for the
  // history it needs (see fetch-depth in .github/workflows/pages.yml) and says so
  // loudly if it hasn't got it.
  const shallow = git('rev-parse --is-shallow-repository') === 'true';
  const counted = Number.parseInt(git('rev-list --count HEAD'), 10);
  const patch = !shallow && Number.isFinite(counted) && counted > 0 ? counted : null;
  if (patch === null && process.env.GITHUB_ACTIONS === 'true') {
    throw new Error(
      'Cannot count commits: the checkout is shallow. Set fetch-depth: 0 on actions/checkout.',
    );
  }

  // GITHUB_SHA as the fallback rather than the first choice: it names the commit
  // that triggered the run, which is the same thing here but wrong the moment a
  // workflow builds anything else.
  const commit = git('rev-parse --short=7 HEAD') || process.env.GITHUB_SHA?.slice(0, 7) || 'unknown';

  // `-uno` because untracked files aren't uncommitted *source*: a build output,
  // an .env.local or an editor's scratch file would otherwise mark every build
  // local. And a CI build is never local by definition — it builds a commit from
  // a fresh checkout, and whatever install steps leave lying around are not the
  // user's edits. (The deployed stamp said "+local" until this second clause
  // existed, which is precisely the sort of lie the marker is meant to prevent.)
  const dirty = process.env.GITHUB_ACTIONS !== 'true' && git('status --porcelain -uno') !== '';

  const version = `${major}.${minor}.${patch ?? 0}`;
  const id = `${commit}${dirty ? '+local' : ''}`;
  return { id, label: `v${version} · ${id}`, version };
};
