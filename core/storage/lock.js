// Адзін запушчаны экзэмпляр на тэчку даных: named pipe жыве роўна столькі, колькі працэс.
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { realpathSync } from 'node:fs';

export async function lockDataDirectory(directory) {
  let canonical = realpathSync(directory);
  if (process.platform === 'win32') canonical = canonical.toLowerCase();
  const digest = createHash('sha256').update(canonical).digest('hex').slice(0, 32);
  const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\obs-tadewusz-${digest}` : `\0obs-tadewusz-${digest}`;
  const server = createServer(socket => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once('error', error => reject(new Error(error.code === 'EADDRINUSE' ? 'data_directory_in_use' : 'data_lock_unavailable')));
    server.listen(endpoint, resolve);
  });
  server.unref();
  return () => new Promise(resolve => server.close(() => resolve()));
}
