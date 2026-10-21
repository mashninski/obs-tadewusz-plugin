import { render } from 'preact';
import { createDockController } from '../music/ui/dock/controller';
import './dock.css';
import { watchForUpdates } from '../music/ui/shared/update';
import { safeLocalStorage } from '../music/core/settings';
import { importLegacy } from '../music/legacy-import';
import { App } from './App';

await importLegacy(safeLocalStorage());
const music = createDockController();
music.start();
window.addEventListener('pagehide', () => music.stop());
// Новая версія праграмы — перазагрузка дока, калі стрымер нічога не піша.
watchForUpdates(() => !(document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement));

render(<App music={music} />, document.getElementById('app')!);
