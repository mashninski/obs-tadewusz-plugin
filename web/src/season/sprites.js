// Спрайты «Сезона»: усё малюецца адзін раз на асобных canvas (разам са свячэннем), а ў кадры — толькі drawImage.
// Спрайт = { frames: canvas[], blink?: canvas[], spin: boolean }. frames — кадры ўласнай анімацыі
// (хвост прывіда дрыжыць), blink — тыя ж кадры з заплюшчанымі вачыма.

const GHOST_FRAMES = 12;

function surface(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  return canvas;
}

/** Маляванне ў нармаваных каардынатах: (0,0)…(w,h) у адзінках `unit` з полем `pad` для свячэння. */
function paint(w, h, unit, pad, draw) {
  const canvas = surface(w * unit + pad * 2, h * unit + pad * 2);
  const ctx = canvas.getContext('2d');
  ctx.translate(pad, pad);
  ctx.scale(unit, unit);
  draw(ctx);
  return canvas;
}

// ---------- Прывіды ----------

/** Тыпы прывідаў: памер скрыні, галава, ніз, «зубцы» хваста, ручкі, рот. */
const GHOSTS = [
  { id: 'sheet', w: 1, h: 1.25, head: 0.44, hem: 1.02, teeth: 4, amp: 0.13, mouth: true },
  { id: 'round', w: 0.78, h: 0.82, head: 0.37, hem: 0.62, teeth: 3, amp: 0.09, mouth: true, eyesY: 0.36 },
  { id: 'tall', w: 0.62, h: 1.6, head: 0.29, hem: 1.38, teeth: 3, amp: 0.13, mouth: false, eyesY: 0.3 },
  { id: 'arms', w: 1, h: 1.22, head: 0.42, hem: 1.0, teeth: 5, amp: 0.1, mouth: false, arms: true },
];

function ghostPath(ctx, g, phase) {
  const cx = g.w / 2, r = g.head, top = 0.04;
  const left = cx - r, right = cx + r;
  ctx.beginPath();
  ctx.moveTo(left, top + r);
  ctx.arc(cx, top + r, r, Math.PI, 0);
  // Бакі крыху разыходзяцца ўніз і пакрысе калышуцца разам з хвастом.
  const sway = 0.025 * Math.sin(phase * Math.PI * 2);
  ctx.quadraticCurveTo(right + 0.03, (top + r + g.hem) / 2, right + sway, g.hem);
  // Хвост: «зубцы» па нізе, кожны дрыжыць па сваім сінусе.
  const steps = 48;
  for (let s = 1; s <= steps; s++) {
    const u = 1 - s / steps;
    const tooth = Math.min(g.teeth - 1, Math.floor(u * g.teeth));
    const wobble = 1 + 0.4 * Math.sin(phase * Math.PI * 2 + tooth * 1.9);
    const x = left + sway + u * (right - left);
    const y = g.hem + g.amp * wobble * Math.pow(Math.abs(Math.sin(Math.PI * g.teeth * u)), 0.8);
    ctx.lineTo(x, y);
  }
  ctx.quadraticCurveTo(left - 0.03, (top + r + g.hem) / 2, left, top + r);
  ctx.closePath();
}

function ghostFrame(g, unit, phase, closed) {
  const pad = unit * 0.32;
  return paint(g.w, g.h, unit, pad, ctx => {
    const lift = g.arms ? 0.12 * Math.sin(phase * Math.PI * 2) : 0;
    if (g.arms) {
      // Ручкі — за целам, каб не было шва.
      ctx.fillStyle = '#f4f7ff';
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(g.w / 2 + side * g.head * 0.98, 0.62);
        ctx.rotate(side * (0.9 + (side > 0 ? lift : -lift)));
        ctx.beginPath();
        ctx.ellipse(0, -0.1, 0.07, 0.17, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    // Свячэнне малюецца тут адзін раз — у кадры ніякіх фільтраў.
    const body = ctx.createLinearGradient(0, 0, 0, g.h);
    body.addColorStop(0, '#ffffff');
    body.addColorStop(1, '#dfe8f5');
    ctx.save();
    ctx.shadowColor = 'rgba(190, 225, 255, 0.85)';
    ctx.shadowBlur = unit * 0.22;
    ghostPath(ctx, g, phase);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.restore();

    const ey = g.eyesY ?? 0.4, dx = g.head * 0.38, ex = g.w / 2;
    ctx.fillStyle = '#1d1f2b';
    ctx.strokeStyle = '#1d1f2b';
    ctx.lineCap = 'round';
    for (const x of [ex - dx, ex + dx]) {
      if (closed) {
        ctx.lineWidth = 0.025;
        ctx.beginPath();
        ctx.moveTo(x - 0.045, ey + 0.02);
        ctx.quadraticCurveTo(x, ey + 0.05, x + 0.045, ey + 0.02);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.ellipse(x, ey, g.head * 0.11, g.head * 0.17, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (g.mouth) {
      ctx.beginPath();
      ctx.ellipse(ex, ey + g.head * 0.42, g.head * 0.07, g.head * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function ghosts(size) {
  return GHOSTS.map(g => {
    const unit = size / Math.max(g.w, g.h) * 1.1;
    const phases = Array.from({ length: GHOST_FRAMES }, (_, i) => i / GHOST_FRAMES);
    return { frames: phases.map(p => ghostFrame(g, unit, p, false)), blink: phases.map(p => ghostFrame(g, unit, p, true)), spin: false };
  });
}

// ---------- Сняжынкі ----------

function flake(size, kind) {
  const unit = size, pad = size * 0.12;
  return paint(1, 1, unit, pad, ctx => {
    ctx.translate(0.5, 0.5);
    ctx.shadowColor = 'rgba(200, 230, 255, 0.9)';
    ctx.shadowBlur = size * 0.08;
    if (kind === 'dot') {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.22);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 0.22, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.strokeStyle = '#ffffff';
    ctx.lineCap = 'round';
    ctx.lineWidth = kind === 'thin' ? 0.035 : 0.05;
    const R = 0.46;
    for (let i = 0; i < 6; i++) {
      ctx.save();
      ctx.rotate((i * Math.PI) / 3);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -R);
      const branch = (at, len) => {
        ctx.moveTo(0, -at); ctx.lineTo(-len * 0.7, -at - len * 0.7);
        ctx.moveTo(0, -at); ctx.lineTo(len * 0.7, -at - len * 0.7);
      };
      if (kind === 'branch') branch(R * 0.5, 0.16);
      if (kind === 'fern') { branch(R * 0.35, 0.12); branch(R * 0.65, 0.1); }
      if (kind === 'thin') branch(R * 0.82, 0.08);
      ctx.stroke();
      ctx.restore();
    }
    if (kind === 'fern') {
      ctx.beginPath();
      for (let i = 0; i <= 6; i++) {
        const a = (i * Math.PI) / 3 + Math.PI / 6;
        ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * 0.11, Math.sin(a) * 0.11);
      }
      ctx.stroke();
    }
  });
}

const snow = size => ['simple', 'branch', 'fern', 'thin', 'dot', 'dot']
  .map(kind => ({ frames: [flake(kind === 'dot' ? size * 0.5 : size, kind)], spin: kind !== 'dot' }));

// ---------- Лісце ----------

const LEAF_COLORS = [['#e0662f', '#9c3418'], ['#f0a032', '#a86014'], ['#c9392a', '#7d1c14'], ['#e6bc45', '#9a7a1c'], ['#b8612d', '#6e3412']];

function leafPath(ctx, kind) {
  ctx.beginPath();
  if (kind === 'maple') {
    // Пяць лопасцей: вяршыня, плячо, выемка — і так па крузе; унізе месца для чаранка.
    const radii = [0.5, 0.31, 0.2];
    for (let k = 0; k < 15; k++) {
      const a = -Math.PI / 2 + (k * Math.PI * 2) / 15;
      const bottom = Math.max(0, Math.sin(a)) ** 3;
      const r = radii[k % 3] * (1 - 0.55 * bottom);
      ctx[k ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
    }
  } else if (kind === 'oak') {
    for (let k = 0; k <= 80; k++) {
      const a = (k / 80) * Math.PI * 2;
      const r = 1 + 0.16 * Math.sin(a * 7);
      ctx[k ? 'lineTo' : 'moveTo'](Math.cos(a) * 0.24 * r, Math.sin(a) * 0.46 * r);
    }
  } else if (kind === 'birch') {
    for (let k = 0; k <= 96; k++) {
      const a = (k / 96) * Math.PI * 2;
      const r = 1 + 0.045 * Math.sin(a * 26);
      const tip = 1 + 0.25 * Math.max(0, -Math.sin(a)) ** 4;
      ctx[k ? 'lineTo' : 'moveTo'](Math.cos(a) * 0.32 * r, Math.sin(a) * 0.38 * r * tip);
    }
  } else {
    ctx.moveTo(0, 0.46);
    ctx.quadraticCurveTo(-0.42, 0.05, 0, -0.48);
    ctx.quadraticCurveTo(0.42, 0.05, 0, 0.46);
  }
  ctx.closePath();
}

function leaf(size, kind, [fill, vein]) {
  return paint(1, 1, size, size * 0.06, ctx => {
    ctx.translate(0.5, 0.5);
    const g = ctx.createLinearGradient(-0.4, -0.4, 0.4, 0.4);
    g.addColorStop(0, fill);
    g.addColorStop(1, vein);
    leafPath(ctx, kind);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = vein;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 0.022;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0.5);
    ctx.lineTo(0, -0.36);
    if (kind === 'maple') for (const a of [-2.3, -0.85, -Math.PI / 2 + 1.25, Math.PI + 0.35]) { ctx.moveTo(0, 0.05); ctx.lineTo(Math.cos(a) * 0.36, Math.sin(a) * 0.36); }
    else for (const y of [-0.18, 0.02, 0.2]) { ctx.moveTo(0, y + 0.08); ctx.lineTo(-0.15, y - 0.04); ctx.moveTo(0, y + 0.08); ctx.lineTo(0.15, y - 0.04); }
    ctx.stroke();
  });
}

const leaves = (size, random) => ['maple', 'oak', 'oval', 'birch'].flatMap(kind =>
  [0, 1, 2].map(() => ({ frames: [leaf(size, kind, LEAF_COLORS[Math.floor(random() * LEAF_COLORS.length)])], spin: true })));

// ---------- Пялёсткі ----------

const PETAL_COLORS = [['#fff7fa', '#f6a9c2'], ['#ffffff', '#fbd3e0'], ['#fde4ec', '#ec86a8']];

function petal(size, notched, [base, tip]) {
  return paint(0.7, 1, size, size * 0.05, ctx => {
    const g = ctx.createLinearGradient(0, 1, 0, 0);
    g.addColorStop(0, base);
    g.addColorStop(1, tip);
    ctx.beginPath();
    ctx.moveTo(0.35, 0.98);
    ctx.bezierCurveTo(-0.05, 0.7, 0.0, 0.12, notched ? 0.27 : 0.35, 0.02);
    if (notched) ctx.quadraticCurveTo(0.35, 0.12, 0.43, 0.02);
    ctx.bezierCurveTo(0.7, 0.12, 0.75, 0.7, 0.35, 0.98);
    ctx.fillStyle = g;
    ctx.fill();
  });
}

const petals = size => [true, false].flatMap(notched => PETAL_COLORS.map(c => ({ frames: [petal(size, notched, c)], spin: true })));

// ---------- Свае карцінкі ----------

function loadImage(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function images(urls, size) {
  const loaded = await Promise.all(urls.map(loadImage));
  return loaded.filter(Boolean).map(img => {
    const w = img.naturalWidth || size, h = img.naturalHeight || size;
    const k = size / Math.max(w, h);
    const canvas = surface(w * k, h * k);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return { frames: [canvas], spin: true };
  });
}

/** Усе спрайты тэмы: убудаваныя (апроч `custom`) і свае карцінкі тэмы. */
export async function buildSprites(theme, size, urls = [], random = Math.random) {
  const builtIn = theme === 'halloween' ? ghosts(size) : theme === 'winter' ? snow(size) : theme === 'autumn' ? leaves(size, random)
    : theme === 'spring' ? petals(size) : [];
  return [...builtIn, ...(await images(urls, size))];
}
