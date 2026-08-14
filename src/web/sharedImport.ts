// Collecting a file Android handed to the app.
//
// When someone shares a ManaBox export to Lugin, the file arrives at the service
// worker, not here: a share is a POST, and only the worker can answer one. It
// leaves the file in a cache and redirects to the app, so this is the other half
// of that handover — the app asking, on startup, "did I just get opened by a
// share?".
//
// A cache rather than a query parameter or postMessage because the file can be
// megabytes, the page that receives it is a *fresh* load (the redirect replaced
// whatever was there), and the worker may well have finished before that page
// exists. Somewhere durable that both sides can name is the only thing that
// survives all three.

/** A file shared to the app, already read. */
export interface SharedImport {
  /** When the worker stashed it — used to tell one share from the next. */
  at: number;
  name: string;
  text: string;
}

// Both halves of the handover have to name the same cache and the same key, and
// the worker's copy is a string in the build config that nothing typechecks — so
// these are exported and the render harness asserts the worker still agrees. A
// silent mismatch would lose every shared file with nothing to see.
export const SHARE_INBOX = 'lugin-share-inbox';
export const SHARE_KEY_PATH = 'shared-import';

const key = (): string => `${import.meta.env.BASE_URL}${SHARE_KEY_PATH}`;

/**
 * Take the shared file, if there is one, and clear it.
 *
 * One-shot on purpose: a file left in the inbox would be re-offered on every
 * launch, and "why does it keep asking me to import this?" is a worse bug than
 * losing a share you can simply repeat. The caller therefore has to hold what it
 * gets — which is also what lets a share survive being received on a phone that
 * has to sign in first.
 */
export const takeSharedImport = async (): Promise<SharedImport | null> => {
  // No caches at all in a stripped-down browser, and none under SSR.
  if (typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open(SHARE_INBOX);
    const hit = await cache.match(key());
    if (!hit) return null;
    const shared = (await hit.json()) as Partial<SharedImport>;
    await cache.delete(key());
    if (!shared.text?.trim()) return null;
    return { at: shared.at ?? Date.now(), name: shared.name ?? 'shared.csv', text: shared.text };
  } catch {
    // A share we can't read must not stop the app from starting; the user still
    // has the file, and the picker still works.
    return null;
  }
};
