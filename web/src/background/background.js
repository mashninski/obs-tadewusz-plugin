// Фон інтро для любой сцэны: ізалініі памерам з крыніцу OBS. Канва перабудоўваецца, калі змяняецца памер крыніцы.
import { grainTile, startTopo } from '../intro/topo.js';

const canvas = document.getElementById('topo');
let stop = () => {};
const start = () => {
  stop();
  canvas.width = Math.max(1, Math.round(innerWidth));
  canvas.height = Math.max(1, Math.round(innerHeight));
  stop = startTopo(canvas);
};
let timer = 0;
addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(start, 200); });
start();
document.getElementById('grain').style.backgroundImage = `url(${grainTile()})`;
