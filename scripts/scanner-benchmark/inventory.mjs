#!/usr/bin/env node
/** yarn scanner:inventory — walk phone evidence and write the stills-v1 manifest. */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { hashDataset, loadAnnotations, saveAnnotationBundle, seedIdentities, seedTags } from './lib/annotations.mjs';
import { buildInventory, inventoryMarkdown } from './lib/inventory.mjs';
import { annotationsDir, manifestsDir, reportsDir } from './lib/paths.mjs';
import { selectStills } from './lib/select.mjs';

await mkdir(manifestsDir, { recursive: true });
await mkdir(annotationsDir, { recursive: true });
await mkdir(reportsDir, { recursive: true });

console.log('Walking scanner evidence…');
const inventory = await buildInventory();
const stills = selectStills(inventory);
const existing = await loadAnnotations();
const identities = seedIdentities(stills, existing.identities);
const tags = seedTags(stills, existing.tags);
const corners = existing.corners ?? [];
const videos = existing.videos ?? { schema: 'scanner-video-v0', videos: [] };
await saveAnnotationBundle({ identities, corners, tags, videos });

const dataset = hashDataset(stills, { identities, corners, tags });
const stillsOut = { ...stills, datasetHash: dataset };
await writeFile(join(manifestsDir, 'corpus-inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`);
await writeFile(join(manifestsDir, 'stills-v1.json'), `${JSON.stringify(stillsOut, null, 2)}\n`);
await writeFile(
  join(manifestsDir, 'oracle-geometry-v1.json'),
  `${JSON.stringify(
    {
      datasetVersion: 'stills-v1',
      datasetHash: dataset,
      purpose: 'Frames proposed for manual corner annotation. Detector quads are not included as truth.',
      frames: stills.items.map(item => ({
        imageId: item.imageId,
        path: item.path,
        sessionId: item.sessionId,
        split: item.split,
        identityStatus: item.identityStatus,
        needsCornerAnnotation: item.needsCornerAnnotation,
        needsIdentityAnnotation: item.needsIdentityAnnotation,
      })),
    },
    null,
    2,
  )}\n`,
);
await writeFile(join(reportsDir, 'corpus-inventory.md'), inventoryMarkdown(inventory));

const t = inventory.totals;
console.log(`Images ${t.images}  sessions ${t.sessions}  videos ${t.videos}`);
console.log(`Exact duplicate clusters ${t.exactDuplicateClusters}  near clusters ${t.nearDuplicateClusters}`);
console.log(
  `Stills ${stills.counts.frames}  confirmed identity ${stills.counts.confirmedIdentity}  unknown ${stills.counts.unknownIdentity}`,
);
console.log(`Dataset ${dataset.slice(0, 12)}`);
console.log('Wrote scanner-benchmark/manifests and reports/corpus-inventory.md');
