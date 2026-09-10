import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

export const receiverSessionPath = (root) => join(root, '.receiver.json');

export const writeReceiverSession = async (root, { port, token }) => {
  const path = receiverSessionPath(root);
  await writeFile(
    path,
    `${JSON.stringify(
      {
        localUrl: `http://127.0.0.1:${port}`,
        port,
        startedAt: new Date().toISOString(),
        token,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  return path;
};

export const readReceiverSession = async (root) => {
  const path = receiverSessionPath(root);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    const port = Number(parsed.port);
    const token = typeof parsed.token === 'string' ? parsed.token : '';
    if (!Number.isFinite(port) || port <= 0 || !token) return null;
    return {
      localUrl: `http://127.0.0.1:${port}`,
      port,
      token,
    };
  } catch {
    return null;
  }
};
