// Старонка «Сезон» у OBS: празрысты canvas на ўвесь кадр, па якім павольна лётаюць аб’екты тэмы.
// Налады — з праграмы (апытанне раз у 2 с). Кадр — не часцей за 30 у секунду; калі крыніца схаваная
// або старонка не бачная, requestAnimationFrame цалкам спыняецца.
import { advance, createObject } from './motion.js';
import { buildSprites } from './sprites.js';

const FPS = 30;
const POLL_MS = 2000;

const canvas = document.getElementById('season');
const ctx = canvas.getContext('2d');
// ?preview=halloween — паказ тэмы без праграмы (для праверкі ў браўзеры).
const preview = new URLSearchParams(location.search).get('preview');

let config = null, sprites = [], objects = [], spriteKey = '';
let visible = true, raf = 0, last = 0, time = 0;
// У праверцы — колькі кадраў намалявана і колькі часу яны занялі (window.__seasonStats).
const stats = preview ? (window.__seasonStats = { frames: 0, busyMs: 0, maxMs: 0 }) : null;

function resize() {
  canvas.width = Math.max(1, Math.round(innerWidth));
  canvas.height = Math.max(1, Math.round(innerHeight));
}

const env = () => ({
  motion: config.motion, width: canvas.width, height: canvas.height, size: config.size, speed: config.speed, fade: config.fade, time, random: Math.random,
});

function spawn(initial) {
  const o = createObject({ ...env(), initial });
  o.sprite = Math.floor(Math.random() * sprites.length);
  return o;
}

/** Колькасць аб’ектаў — як у наладах; лішнія знікаюць, новыя з’яўляюцца паступова. */
function syncCount() {
  if (objects.length > config.count) objects.length = config.count;
  while (objects.length < config.count) objects.push(spawn(true));
}

function frame(now) {
  raf = 0;
  if (!running()) return;
  raf = requestAnimationFrame(frame);
  if (now - last < 1000 / FPS - 2) return;
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
  last = now;
  time += dt;
  const started = stats ? performance.now() : 0;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const e = env();
  for (let i = 0; i < objects.length; i++) {
    let o = objects[i];
    if (!advance(o, dt, e)) o = objects[i] = spawn(true);
    const sprite = sprites[o.sprite % sprites.length];
    const blink = sprite.blink && time < o.blinkUntil;
    const list = blink ? sprite.blink : sprite.frames;
    const img = list[Math.floor((time * 8 + o.phase) % list.length)];
    const k = o.scale;
    ctx.globalAlpha = config.opacity * o.alpha;
    ctx.setTransform(k * o.flip, 0, 0, k, o.x, o.y + (o.bob ?? 0));
    if (o.angle) ctx.rotate(o.angle);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  if (stats) {
    const spent = performance.now() - started;
    stats.frames++;
    stats.busyMs += spent;
    stats.maxMs = Math.max(stats.maxMs, spent);
  }
}

const running = () => visible && !document.hidden && !!config?.enabled && sprites.length > 0;

function update() {
  if (running()) {
    if (!raf) { last = 0; raf = requestAnimationFrame(frame); }
  } else {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

async function apply(state) {
  const previous = config;
  config = state.config;
  const key = JSON.stringify([config.theme, config.size, state.images]);
  if (key !== spriteKey) {
    spriteKey = key;
    sprites = await buildSprites(config.theme, config.size, state.images);
    if (key !== spriteKey) return;
    for (const o of objects) o.sprite = Math.floor(Math.random() * Math.max(1, sprites.length));
  }
  // Новы від руху — аб’екты пачынаюць нанова.
  if (previous && previous.motion !== config.motion) objects = [];
  syncCount();
  update();
}

async function poll() {
  try {
    const response = await fetch('/season/state', { cache: 'no-store' });
    if (response.ok) await apply(await response.json());
  } catch {
    // Праграма недаступная: працягваем з апошнімі наладамі.
  }
  setTimeout(poll, POLL_MS);
}

addEventListener('resize', () => { resize(); objects = []; if (config) syncCount(); });
document.addEventListener('visibilitychange', update);
// Крыніца схаваная ў OBS — старонка нічога не малюе.
addEventListener('obsSourceVisibleChanged', event => { visible = !!event.detail?.visible; update(); });

resize();
if (preview) {
  const motion = { halloween: 'float', winter: 'fall', autumn: 'tumble', spring: 'tumble' }[preview] ?? 'float';
  const params = new URLSearchParams(location.search);
  // ?bg=… — фон пад праверку (у OBS старонка празрыстая).
  if (/^#?[0-9a-f]{3,6}$/i.test(params.get('bg') ?? '')) document.body.style.background = `#${params.get('bg').replace('#', '')}`;
  void apply({ config: { enabled: true, theme: preview, motion, count: Number(params.get('count')) || 8, size: Number(params.get('size')) || 72, speed: 1, opacity: 0.6, fade: true }, images: [] });
} else {
  void poll();
}
