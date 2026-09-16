#!/usr/bin/env node
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_PORT } from './scan-inbox/lib.mjs';
import { ensureInboxConfig } from './scan-inbox/inbox-config.mjs';
import { readReceiverSession, writeReceiverSession } from './scan-inbox/session-file.mjs';
import { printBanner, startInboxServer } from './scan-inbox/server.mjs';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const inboxRoot = process.env.SCAN_INBOX_ROOT || join(rootDir, '.scan-inbox');
const port = Number(process.env.SCAN_INBOX_PORT || DEFAULT_PORT);
const previous = await readReceiverSession(inboxRoot);
const config = await ensureInboxConfig(inboxRoot, {
  token: process.env.SCAN_INBOX_TOKEN || previous?.token || undefined,
});
const token = process.env.SCAN_INBOX_TOKEN || previous?.token || config.token;

const started = await startInboxServer({
  onReceived: ({ already, merged, parsed, sampleCount }) => {
    const now = new Date().toLocaleTimeString();
    const label = parsed.traceType === 'geometry' ? 'geometry trace' : parsed.traceType;
    const samples = sampleCount != null ? `  samples: ${sampleCount}` : '';
    const kind = merged ? 'merged' : already ? 'duplicate' : 'received';
    console.log(
      `[${now}] ${kind} ${label}\n  session: ${parsed.sessionId}\n  trace: ${parsed.traceId}${samples}\n  path: .scan-inbox/sessions/${parsed.sessionId}/${parsed.traceId}`,
    );
  },
  port,
  root: inboxRoot,
  token,
});

await writeReceiverSession(inboxRoot, { port: started.port, token: started.token });
await ensureInboxConfig(inboxRoot, { token: started.token, name: config.name });
printBanner(started);
console.log(`Persistent identity: .scan-inbox/config.json (${config.name})`);
console.log('Current APK (HTTPS, optional): yarn scan:inbox:tunnel');
console.log('');
