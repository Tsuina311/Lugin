import { useEffect, useState } from 'react';

import { libraryStore, type LibrarySnapshot } from './libraryStore';

export const useLibrary = (): LibrarySnapshot => {
  const [snapshot, setSnapshot] = useState(() => libraryStore.getSnapshot());
  useEffect(() => libraryStore.subscribe(() => setSnapshot(libraryStore.getSnapshot())), []);
  return snapshot;
};
