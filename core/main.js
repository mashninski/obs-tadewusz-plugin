// Запуск ядра: node core/main.js [--data <тэчка>] [--web <тэчка>] [--port 18745] [--obs-pid <pid>]
// З --obs-pid ядро завяршаецца само, калі OBS закрыўся (узнагароды хаваюцца, робіцца рэзервовая копія).
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createApp } from './app.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const { values } = parseArgs({
  options: {
    data: { type: 'string' }, web: { type: 'string' }, port: { type: 'string' }, 'obs-pid': { type: 'string' }, verbose: { type: 'boolean' },
  },
});
const dataDir = resolve(values.data ?? process.env.TADEWUSZ_DATA ?? join(homedir(), 'obs-tadewusz', 'data'));
const webRoot = resolve(values.web ?? join(root, 'web', 'dist'));
const port = Number(values.port ?? 18745);

// Калі OBS перазапусцілі, папярэдняе ядро яшчэ некалькі секунд завяршаецца: пачакаць яго.
let app;
for (let attempt = 0; ; attempt++) {
  try {
    app = await createApp({ dataDir, webRoot, port, version, echoLog: values.verbose });
    break;
  } catch (error) {
    if (['data_directory_in_use', 'EADDRINUSE'].some(code => error.message === code || error.code === code) && attempt < 15) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      continue;
    }
    console.error(`Tadewusz: запуск немагчымы (${error.message}).`);
    process.exit(1);
  }
}
console.log(`Tadewusz ${version}: ${app.origin}  ·  даныя: ${dataDir}`);

const stop = () => app.close().finally(() => process.exit(0));
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

const obsPid = Number(values['obs-pid']);
if (Number.isInteger(obsPid) && obsPid > 0) {
  const watch = setInterval(() => {
    try { process.kill(obsPid, 0); }
    catch (error) {
      if (error.code !== 'ESRCH') return;
      clearInterval(watch);
      stop();
    }
  }, 2000);
}
