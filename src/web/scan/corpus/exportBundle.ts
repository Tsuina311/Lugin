// Package pending local corpus samples for manual sharing (no auto-upload).

import { listPendingCorpus, type QueuedCorpusSample } from './queue';

const toBase64 = (buf: ArrayBuffer): string => {
  const u8 = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    binary += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  return btoa(binary);
};

export interface CorpusExportBundle {
  exportedAt: string;
  samples: Array<{
    imageBase64: string | null;
    meta: QueuedCorpusSample['meta'];
    mimeType: QueuedCorpusSample['mimeType'];
  }>;
  schemaVersion: 1;
}

/** Build an exportable JSON bundle from the local pending queue. */
export const buildPendingCorpusExport = async (): Promise<CorpusExportBundle> => {
  const rows = await listPendingCorpus();
  return {
    exportedAt: new Date().toISOString(),
    samples: rows.map(row => ({
      imageBase64: row.image ? toBase64(row.image) : null,
      meta: row.meta,
      mimeType: row.mimeType,
    })),
    schemaVersion: 1,
  };
};

/** Trigger a browser download of the pending-sample export bundle. */
export const downloadPendingCorpusExport = async (): Promise<number> => {
  const bundle = await buildPendingCorpusExport();
  if (bundle.samples.length === 0) return 0;
  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lugin-scanner-corpus-${bundle.exportedAt.slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  return bundle.samples.length;
};
