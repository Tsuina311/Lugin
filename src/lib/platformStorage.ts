// chrome.storage.local in the extension, localStorage on the phone build.

export const readPlatformStorage = async <T>(key: string): Promise<T | undefined> => {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const stored = await chrome.storage.local.get(key);
      return stored[key] as T | undefined;
    }
  } catch {
    // ignore
  }
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
};

export const writePlatformStorage = async (key: string, value: unknown): Promise<void> => {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ [key]: value });
      return;
    }
  } catch {
    // ignore
  }
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
};
