export type TimeoutScheduler = {
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

const defaultScheduler: TimeoutScheduler = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Bound waiting without attempting to cancel the underlying recoverable work. */
export const withBoundedTimeout = <T>(
  work: Promise<T>,
  ms: number,
  scheduler: TimeoutScheduler = defaultScheduler,
): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = scheduler.set(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    work.then(
      value => {
        scheduler.clear(timer);
        resolve(value);
      },
      error => {
        scheduler.clear(timer);
        reject(error);
      },
    );
  });
