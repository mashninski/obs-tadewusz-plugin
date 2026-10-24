// Фон інтро: тонкія тапаграфічныя ізалініі, якія павольна дрэйфуюць, і нерухомае зерне.
// Лініі будуюцца «квадратамі, што ідуць маршам» (marching squares) па гладкім шуме на сетцы 24 px.
// Кадр — не часцей за 15 у секунду, малюнак толькі 2D canvas: нагрузка на GPU мінімальная.

const CELL = 24;
const FPS = 15;
const LEVELS = 14;

/** Градыентны шум 2D (Перлін) на перамешанай табліцы. */
function createNoise(seed = 1) {
  const perm = new Uint8Array(512);
  const p = Array.from({ length: 256 }, (_, i) => i);
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const grad = (h, x, y) => ((h & 1) ? x : -x) + ((h & 2) ? y : -y);
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const u = fade(xf), v = fade(yf);
    const aa = perm[perm[X] + Y], ab = perm[perm[X] + Y + 1], ba = perm[perm[X + 1] + Y], bb = perm[perm[X + 1] + Y + 1];
    const x1 = grad(aa, xf, yf) + u * (grad(ba, xf - 1, yf) - grad(aa, xf, yf));
    const x2 = grad(ab, xf, yf - 1) + u * (grad(bb, xf - 1, yf - 1) - grad(ab, xf, yf - 1));
    return x1 + v * (x2 - x1);
  };
}

export function startTopo(canvas, { accent = '79, 184, 184' } = {}) {
  const ctx = canvas.getContext('2d', { alpha: true });
  const width = canvas.width, height = canvas.height;
  const cols = Math.ceil(width / CELL) + 1, rows = Math.ceil(height / CELL) + 1;
  const field = new Float32Array(cols * rows);
  const noise = createNoise(7);
  const noise2 = createNoise(13);
  let last = 0;

  const sample = (t) => {
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const x = i * CELL / 640, y = j * CELL / 640;
        // Два слоі шуму плывуць у розныя бакі — рэльеф павольна змяняецца, а не толькі зрушваецца.
        field[j * cols + i] = noise(x + t * 0.011, y - t * 0.004) * 0.72 + noise2(x * 2.1 - t * 0.007, y * 2.1 + t * 0.009) * 0.28;
      }
    }
  };

  const draw = (t) => {
    sample(t);
    ctx.clearRect(0, 0, width, height);
    for (let level = 0; level < LEVELS; level++) {
      const iso = -0.55 + (1.1 * level) / (LEVELS - 1);
      const index = level % 4 === 0;
      ctx.beginPath();
      for (let j = 0; j < rows - 1; j++) {
        for (let i = 0; i < cols - 1; i++) {
          const a = field[j * cols + i], b = field[j * cols + i + 1];
          const c = field[(j + 1) * cols + i + 1], d = field[(j + 1) * cols + i];
          const mask = (a > iso ? 8 : 0) | (b > iso ? 4 : 0) | (c > iso ? 2 : 0) | (d > iso ? 1 : 0);
          if (mask === 0 || mask === 15) continue;
          const x = i * CELL, y = j * CELL;
          const top = [x + CELL * (iso - a) / (b - a), y];
          const right = [x + CELL, y + CELL * (iso - b) / (c - b)];
          const bottom = [x + CELL * (iso - d) / (c - d), y + CELL];
          const left = [x, y + CELL * (iso - a) / (d - a)];
          const seg = (p, q) => { ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); };
          switch (mask) {
            case 1: case 14: seg(left, bottom); break;
            case 2: case 13: seg(bottom, right); break;
            case 3: case 12: seg(left, right); break;
            case 4: case 11: seg(top, right); break;
            case 5: seg(left, top); seg(bottom, right); break;
            case 6: case 9: seg(top, bottom); break;
            case 7: case 8: seg(left, top); break;
            case 10: seg(left, bottom); seg(top, right); break;
          }
        }
      }
      ctx.strokeStyle = `rgba(${accent}, ${index ? 0.2 : 0.09})`;
      ctx.lineWidth = index ? 1.4 : 1;
      ctx.stroke();
    }
  };

  let stopped = false;
  const frame = (now) => {
    if (stopped) return;
    if (now - last >= 1000 / FPS && !document.hidden) {
      last = now;
      draw(now / 1000);
    }
    requestAnimationFrame(frame);
  };
  draw(0);
  requestAnimationFrame(frame);
  return () => { stopped = true; };
}

/** Зерне: адзін раз згенераваная плітка шуму, паўтораная па ўсім кадры (не анімуецца). */
export function grainTile(size = 160) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const v = Math.random() * 255;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}
