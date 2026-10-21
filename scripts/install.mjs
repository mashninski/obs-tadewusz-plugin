// Усталяванне ў %USERPROFILE%\obs-tadewusz\app (спачатку: npm run build).
// Не ў AppData: праграмы з пакетаў MSIX бачаць там уласную віртуальную копію, і OBS не знайшоў бы файлы.
// Папярэдняя версія застаецца побач у app.prev — вярнуць яе можна простым перайменаваннем.
// Даныя (data\) не чапаюцца.
import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const home = join(homedir(), 'obs-tadewusz');
const target = join(home, 'app'), staging = join(home, 'app.new'), previous = join(home, 'app.prev');

if (!existsSync(join(root, 'web', 'dist', 'dock.html'))) {
  console.error('Няма зборкі: спачатку npm run build');
  process.exit(1);
}

rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
for (const path of ['core', 'shared', 'obs', 'package.json', 'LICENSE']) cpSync(join(root, path), join(staging, path), { recursive: true });
cpSync(join(root, 'web', 'dist'), join(staging, 'web', 'dist'), { recursive: true });
// Свая копія Node.js: абнаўленне Node у сістэме не зломіць праграму.
cpSync(process.execPath, join(staging, 'node.exe'));

if (existsSync(target)) {
  rmSync(previous, { recursive: true, force: true });
  renameSync(target, previous);
}
renameSync(staging, target);

const fileUrl = path => `file:///${path.replaceAll('\\', '/')}`;
console.log(`Усталявана: ${target}`);
console.log(`Скрыпт OBS (Інструменты → Скрыпты): ${join(target, 'obs', 'tadewusz.lua')}`);
console.log(`Док OBS (Docks → Custom Browser Docks): ${fileUrl(join(target, 'obs', 'start.html'))}?page=dock`);
console.log(`Крыніца музыкі (Браўзер): ${fileUrl(join(target, 'obs', 'start.html'))}?page=music`);
console.log('Каб новая версія запрацавала, перазапусціце OBS.');
