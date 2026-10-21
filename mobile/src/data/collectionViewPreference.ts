export type CollectionViewShape = 'box' | 'list';

let remembered: CollectionViewShape | null = null;

const path = async (): Promise<string | null> => {
  const FileSystem = await import('expo-file-system/legacy');
  const root = FileSystem.documentDirectory;
  if (!root) return null;
  const dir = `${root}lugin-ui/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  return `${dir}collection-view.txt`;
};

export const loadCollectionView = async (): Promise<CollectionViewShape> => {
  if (remembered) return remembered;
  try {
    const FileSystem = await import('expo-file-system/legacy');
    const file = await path();
    if (!file) return 'list';
    const info = await FileSystem.getInfoAsync(file);
    if (!info.exists) return 'list';
    remembered = (await FileSystem.readAsStringAsync(file)).trim() === 'box' ? 'box' : 'list';
    return remembered;
  } catch {
    return 'list';
  }
};

export const saveCollectionView = async (view: CollectionViewShape): Promise<void> => {
  remembered = view;
  try {
    const FileSystem = await import('expo-file-system/legacy');
    const file = await path();
    if (file) await FileSystem.writeAsStringAsync(file, view);
  } catch {
    // A storage failure only makes the preference forgetful.
  }
};
