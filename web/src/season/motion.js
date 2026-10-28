// Рух «Сезона» — без DOM, каб правяраць тэстамі. Тры віды:
//   float  — павольнае блуканне (кірунак плыве па сумe сінусаў), лёгкае пагойдванне ўверх-уніз, нахіл ±10°;
//   fall   — падзенне з бакавым калыханнем і кручэннем; знізу аб’ект вяртаецца наверх;
//   tumble — павольнае падзенне з «кульганнем» (scaleX = cos t) і дрэйфам па ветры.
// Аб’екты не затрымліваюцца ў цэнтры кадра: там на іх дзейнічае лёгкае адштурхванне.
// fade — аб’ект часам растае і з’яўляецца ў іншым месцы.

/** Сіла адштурхвання ад цэнтра, px/с² пры поўным заходзе ў цэнтральны эліпс. */
export const CENTER_PUSH = 60;
/** Паўвосі цэнтральнага эліпса — доля шырыні і вышыні кадра. */
export const CENTER_ZONE = 0.22;
const FADE_S = 1.6;
const DEG10 = Math.PI / 18;

const range = (random, a, b) => a + random() * (b - a);

/** Пазіцыя па-за цэнтрам кадра (некалькі спроб). */
export function spawnPoint(width, height, random, margin = 0) {
  let x = 0, y = 0;
  for (let i = 0; i < 12; i++) {
    x = range(random, margin, width - margin);
    y = range(random, margin, height - margin);
    if (centerDistance(x, y, width, height) > 1.1) break;
  }
  return { x, y };
}

/** 0 — сам цэнтр, 1 — мяжа цэнтральнага эліпса. */
export function centerDistance(x, y, width, height) {
  return Math.hypot((x - width / 2) / (width * CENTER_ZONE), (y - height / 2) / (height * CENTER_ZONE));
}

export function createObject({ motion, width, height, size, random = Math.random, sprite = 0, initial = true }) {
  const scale = range(random, 0.75, 1.25);
  const o = {
    sprite, scale, phase: random() * 1000, x: 0, y: 0, vx: 0, vy: 0, angle: 0, flip: 1,
    alpha: 0, fading: 'in', life: range(random, 18, 50), blinkAt: range(random, 2, 7), blinkUntil: 0, spinRate: range(random, -0.8, 0.8),
  };
  const r = size * scale;
  if (motion === 'float' || initial) Object.assign(o, spawnPoint(width, height, random, r));
  else Object.assign(o, { x: range(random, 0, width), y: -r });
  return o;
}

/**
 * Адзін крок. `env`: { motion, width, height, size, speed, fade, time, random }. Вяртае false, калі аб’ект трэба
 * перастварыць у іншым месцы (растаў).
 */
export function advance(o, dt, env) {
  const { motion, width, height, size, speed, time } = env;
  const t = time + o.phase, r = size * o.scale;

  // Цэнтр адштурхвае (мацней бліжэй да сярэдзіны).
  const d = centerDistance(o.x, o.y, width, height);
  let px = 0, py = 0;
  if (d < 1) {
    const dx = o.x - width / 2 || 1, dy = o.y - height / 2;
    const len = Math.hypot(dx, dy);
    px = (dx / len) * CENTER_PUSH * (1 - d) * Math.max(speed, 0.5);
    py = (dy / len) * CENTER_PUSH * (1 - d) * Math.max(speed, 0.5);
  }

  if (motion === 'float') {
    const heading = Math.sin(t * 0.071) * 2.4 + Math.sin(t * 0.133 + 1.7) * 1.4 + o.phase;
    const v = 26 * speed * (1.3 - o.scale * 0.4);
    // Мяккія сценкі: каля краю кірунак паступова паварочваецца ўнутр.
    const margin = r * 1.2;
    const wall = 40 * speed;
    const wx = o.x < margin ? wall : o.x > width - margin ? -wall : 0;
    const wy = o.y < margin ? wall : o.y > height - margin ? -wall : 0;
    const k = Math.min(1, dt * 0.9);
    o.vx += (Math.cos(heading) * v - o.vx) * k + (wx + px) * dt;
    o.vy += (Math.sin(heading) * v * 0.7 - o.vy) * k + (wy + py) * dt;
    o.x += o.vx * dt;
    o.y += o.vy * dt;
    o.bob = Math.sin(t * 1.3) * r * 0.08;
    o.angle = Math.sin(t * 0.55) * DEG10;
    o.flip = 1;
  } else {
    const tumble = motion === 'tumble';
    const fallSpeed = (tumble ? 30 : 42) * speed * (0.6 + o.scale * 0.5);
    const wind = tumble ? (14 + 22 * Math.sin(time * 0.05)) * speed : 4 * speed * Math.sin(time * 0.03);
    const sway = (tumble ? 34 : 22) * speed * Math.cos(t * (tumble ? 0.9 : 0.7));
    o.x += (wind + sway + px * 0.6) * dt;
    o.y += fallSpeed * dt;
    o.bob = 0;
    if (tumble) {
      o.flip = Math.cos(t * 1.6);
      o.angle = Math.sin(t * 0.5) * 0.7 + o.spinRate;
    } else {
      o.angle += o.spinRate * 0.5 * speed * dt;
      o.flip = 1;
    }
    // Па крузе: знізу — наверх, з боку — на другі бок.
    if (o.y - r > height) { o.y = -r; o.x = range(env.random, 0, width); }
    if (o.x - r > width) o.x = -r;
    else if (o.x + r < 0) o.x = width + r;
  }

  // Знікненне і з’яўленне.
  if (o.fading === 'in') {
    o.alpha = Math.min(1, o.alpha + dt / FADE_S);
    if (o.alpha >= 1) o.fading = null;
  } else if (o.fading === 'out') {
    o.alpha -= dt / FADE_S;
    if (o.alpha <= 0) return false;
  } else if (env.fade) {
    o.life -= dt;
    if (o.life <= 0) o.fading = 'out';
  }

  // Мірганне (толькі ў спрайтаў з заплюшчанымі вачыма).
  if (time >= o.blinkAt) { o.blinkUntil = time + 0.16; o.blinkAt = time + range(env.random, 2.5, 8); }
  return true;
}
