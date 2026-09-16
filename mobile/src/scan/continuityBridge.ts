/** Tiny bridge: SessionController cardSession reset → frame-analysis continuity soft-reset. */

type SoftResetFn = (reason: string) => void;

let softResetFn: SoftResetFn | null = null;

export const registerContinuitySoftReset = (fn: SoftResetFn | null): void => {
  softResetFn = fn;
};

export const softResetContinuityForCardSession = (reason = 'new-card-session'): void => {
  softResetFn?.(reason);
};
