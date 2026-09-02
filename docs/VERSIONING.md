# Versioning

`MAJOR.MINOR.<commits>` — for example **v1.0.42 · 5832413**.

Two of those three numbers look after themselves.

| Part      | Where it comes from                    | Who moves it                     |
| --------- | -------------------------------------- | -------------------------------- |
| MAJOR     | `version` in `package.json`            | you, with `yarn bump:major`      |
| MINOR     | `version` in `package.json`            | you, with `yarn bump:minor`      |
| the third | `git rev-list --count HEAD`, at build  | every commit, on its own         |
| `· sha`   | `git rev-parse --short HEAD`, at build | every commit, on its own         |

The patch digit in `package.json` is unused and stays at `0`. Nothing reads it;
the third number of a build is always the commit count.

## Deciding between a patch and a minor

The commit count moves whatever you do, so the only decision is whether a change
also earns a **minor**. The test is what the app can do afterwards:

- **Minor** — it can do something it couldn't before. A new screen, a format it
  now reads or writes, a new route in or out. Run `yarn bump:minor` in the same
  commit as the change.
- **Patch** — it does the same things, better. Fixes, refactors, wording, speed,
  docs, tests. Nothing to do.
- **Major** — an older copy of Lugin can no longer read what this one writes.
  That means the shape of the sync document or the stored collection changed
  incompatibly, and someone's desktop is about to meet a phone that disagrees
  with it. Nothing else deserves a major, and this is worth avoiding rather than
  numbering.

The bump belongs in the commit that earns it, not in a release commit of its own,
so that `git log` explains every version without a second story to keep straight.

## Why the count doesn't reset

Resetting on a minor would mint two builds with the same version — 1.1.0 arriving
after 1.0.87 — and Chrome refuses an extension update whose version went
backwards. So the count is monotonic and the third number is really a build
number wearing semver's clothes. That is the honest description of a project that
deploys from `main`: a patch release and a commit are the same event.

## Where a version shows up

- **Phone web**: the header, on every screen, and the splash screens.
- **Phone native**: Settings shows product version + platform + Expo runtime
  (`docs/MOBILE-NATIVE.md`). Same `MAJOR.MINOR` as root; commit stamp alignment
  lands with later native milestones — do not invent a separate scheme.
- **Extension**: the overlay header shows `v0.1.N` from `src/desktopVersion.ts`
  (base `0.1`, third digit +1 every desktop code change) so a reload is visibly
  a new build. `chrome://extensions` shows `version_name`, which carries the
  commit **and** `· d0.1.N`.
- **Service worker**: the shell cache is `lugin-shell-<sha>`, so a deploy drops
  the previous offline copy instead of keeping it.

The commit is the part that answers "is my fix live?" — the version number only
moves when you decide it should, but the sha changes every time. A `+local`
suffix means the build came from a tree with uncommitted changes, so that commit
doesn't fully describe it; you will see it locally and never on a deploy.

## The one thing CI has to get right

Counting commits needs the commits. `actions/checkout` fetches one by default, so
`.github/workflows/pages.yml` sets `fetch-depth: 0` — without it the deployed app
would call itself `1.0.1` forever. `build/version.ts` fails the build rather than
publishing a wrong number if it ever finds itself in a shallow clone on CI.
