// Anonymous ids for corpus contribution — no account material.

const hex = (bytes: Uint8Array): string =>
  [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');

const randomId = (bytes = 16): string => {
  const buf = new Uint8Array(bytes);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < bytes; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  return hex(buf);
};

export const newSampleId = (): string => randomId(16);
export const newSessionId = (): string => randomId(12);
export const newContributorId = (): string => randomId(16);
