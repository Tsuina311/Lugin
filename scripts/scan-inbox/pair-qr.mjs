import { spawn } from 'node:child_process';
import { join } from 'node:path';

import QRCode from 'qrcode';

/** Full pair line. One scan sets the endpoint and the bearer token. */
export const PAIR_QR_NAME = 'pair-qr.png';

export const renderPairQr = async (inboxRoot, payload) => {
  const path = join(inboxRoot, PAIR_QR_NAME);
  const options = {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 720,
    color: { dark: '#000000', light: '#ffffff' },
  };
  await QRCode.toFile(path, payload, options);
  const terminal = await QRCode.toString(payload, {
    errorCorrectionLevel: 'M',
    small: true,
    type: 'terminal',
  });
  if (process.platform === 'darwin' && process.env.SCAN_INBOX_NO_QR_OPEN !== '1') {
    const child = spawn('open', [path], { detached: true, stdio: 'ignore' });
    child.unref();
  }
  return { path, terminal };
};
