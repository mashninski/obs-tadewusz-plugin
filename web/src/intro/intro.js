// Оверлей інтро: спасылкі (з QR), кліпы канала афіцыйным плэерам Twitch, адлік да пачатку стрыму.
// Налады бярэ з праграмы кожныя 2 с — змены з дока відаць адразу, без перастварэння сцэны.
// Крыніца ў OBS выключаецца, калі сцэна не бачная, і перазагружаецца пры актывацыі: адлік пачынаецца нанова,
// спіс кліпаў абнаўляецца. Пакуль сцэна ў эфіры — спіс абнаўляецца раз у 5 хвілін, калода працягваецца.
import { encode } from 'uqr';
import { ClipDeck } from './deck.js';
import { grainTile, startTopo } from './topo.js';

const POLL_MS = 2000;
const REFRESH_MS = 5 * 60_000;
/*
 * Плэер кліпаў Twitch нічога не паведамляе старонцы (ні «грае», ні «скончыўся») і не прымае каманд,
 * а запускаецца толькі тады, калі ён бачны: не паменшаны, не празрысты, нічым не накрыты і ў кадры
 * хоць бы ~паловай плошчы (замерана ў OBS 2026-10-24; абрэзка праз clip-path — дазволеная).
 * Калі ён становіцца бачным, яшчэ ~0,5–1 с стаіць на паўзе са значком ▶ у цэнтры. Таму змена кліпаў — «нарэзка»:
 * - `controls=false` — Twitch не малюе назву, кнопкі і плашкі (гук пры гэтым застаецца);
 * - плэер наступнага кліпа загадзя грузіцца празрыстым (Twitch чакае і не грае);
 * - праз рамку пралятае дыяганальная паласа: за ёй адкрываецца наступны кліп; на сярэдзіне паласа спыняецца —
 *   плэер у гэты момант бачны на ~80 % і запускаецца, а цэнтр са значком ▶ выразаны пад паласой (паласа ляжыць
 *   пад плэерам і відаць праз выраз — гэта не «накрыццё»); калі кліп пайшоў, паласа адлятае;
 * - першы кліп пасля актывацыі і паўза паміж кліпамі — першы кадр кліпа (прэв’ю Twitch), які мякка праяўляецца.
 */
/** Плэеру пасля загрузкі патрэбны час, каб падрыхтавацца: тады ён пачынае хутка (з 1 с значок ▶ трымаўся даўжэй). */
const WARM_MS = 3000;
/** Падрыхтаваны плэер пачынае праз столькі пасля таго, як стаў бачным. */
const PLAY_AFTER_SHOW_MS = 800;
/** Паласа: уваход да сярэдзіны, прыпынак (тут стартуе плэер), выхад. */
const BAND_IN_MS = 520;
const BAND_HOLD_MS = 1300;
const BAND_OUT_MS = 560;
/** Шырыня паласы і яе нахіл (верх зрушаны направа), px у рамцы 832×468. */
const BAND_WIDTH = 190;
const BAND_SLANT = 150;
/** Паласа накрывае кліп крыху раней за яго канец — экран рэкамендацый Twitch не відаць. */
const END_EARLY_MS = 300;
/** Колькі першы кадр «праяўляецца» (з размыцця і крыху буйней — да рэзкага, роўна як першы кадр відэа). */
const SETTLE_MIN_MS = 2600;
/** Першы кліп пасля актывацыі: плэер толькі пачынае грузіцца — кадр праяўляецца павольней, увесь гэты час. */
const SETTLE_COLD_MS = 5500;
/** Калі старонка плэера не загрузілася, кліп усё роўна паказваецца. */
const LOAD_TIMEOUT_MS = 10_000;
const DECK_KEY = 'tadewusz.intro.deck';

const $ = (id) => document.getElementById(id);
const state = { config: null, restartAt: null, clipsVersion: undefined, countdownFrom: 0, countdownSeconds: 0 };

// ---------- Кадр ----------

const fit = () => document.documentElement.style.setProperty('--fit', String(Math.min(innerWidth / 1920, innerHeight / 1080)));
addEventListener('resize', fit);
fit();
startTopo($('topo'));
$('grain').style.backgroundImage = `url(${grainTile()})`;

// ---------- Налады ----------

async function get(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

function qrSvg(text) {
  const { data, size } = encode(text, { ecc: 'M', border: 0 });
  let path = '';
  data.forEach((row, y) => row.forEach((on, x) => { if (on) path += `M${x} ${y}h1v1h-1z`; }));
  return `<svg viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" aria-hidden="true"><path fill="#0a0f0d" d="${path}"/></svg>`;
}

/** Адрас для QR: без схемы — https://. */
const absolute = (url) => (/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`);
/** Адрас для экрана — без https:// і без касой рысы ў канцы. */
const shortUrl = (url) => url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');

function renderLinks(config) {
  $('linksTitle').textContent = config.linksTitle;
  $('linksTitle').hidden = !config.linksTitle;
  const list = $('links');
  list.replaceChildren(...config.links.map((link) => {
    const li = document.createElement('li');
    li.className = link.label ? 'link has-label' : 'link';
    if (link.qr) {
      const qr = document.createElement('div');
      qr.className = 'qr';
      qr.innerHTML = qrSvg(absolute(link.url));
      li.append(qr);
    }
    const text = document.createElement('div');
    text.className = 'link-text';
    if (link.label) {
      const label = document.createElement('div');
      label.className = 'link-label';
      label.textContent = link.label;
      text.append(label);
    }
    const url = document.createElement('div');
    url.className = 'link-url';
    url.textContent = shortUrl(link.url);
    text.append(url);
    li.append(text);
    return li;
  }));
  // Шмат спасылак з QR — усё памяншаецца, каб змясціцца над адлікам (не меней за палову).
  const block = list.parentElement;
  for (let k = 1; k >= 0.5; k -= 0.05) {
    block.style.setProperty('--k', k.toFixed(2));
    if (list.scrollHeight <= list.clientHeight + 1) break;
  }
}

function applyConfig(config, restartAt) {
  const previous = state.config;
  state.config = config;
  if (JSON.stringify(previous?.links) !== JSON.stringify(config.links) || previous?.linksTitle !== config.linksTitle) renderLinks(config);
  $('frame').classList.toggle('with-donations', config.donations);
  $('donations').hidden = !config.donations;
  $('finish').textContent = config.finishText;
  // Новы час адліку або «Перазапусціць» у доку — адлік ідзе нанова.
  if (!previous || previous.countdown !== config.countdown || (state.restartAt !== null && restartAt !== state.restartAt)) startCountdown(config.countdown);
  state.restartAt = restartAt;
}

// Памеры спасылак падбіраюцца пасля загрузкі шрыфтоў (інакш вымярэнне — па запасным шрыфце).
document.fonts?.ready.then(() => state.config && renderLinks(state.config));

// ---------- Адлік ----------

function startCountdown(seconds) {
  state.countdownFrom = performance.now();
  state.countdownSeconds = seconds;
  tickCountdown();
}

const two = (n) => String(n).padStart(2, '0');

function tickCountdown() {
  if (!state.config) return;
  const left = Math.max(0, Math.ceil(state.countdownSeconds - (performance.now() - state.countdownFrom) / 1000));
  const done = left === 0;
  const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60), s = left % 60;
  $('countdownTime').textContent = h ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
  $('countdownTime').hidden = done;
  $('countdownLabel').hidden = done;
  // Сцэна на нулі не пераключаецца (рашэнне ў DECISIONS.md) — толькі надпіс.
  if ($('finish').hidden === done) $('finish').hidden = !done;
}
setInterval(tickCountdown, 250);

// ---------- Кліпы ----------

const deck = new ClipDeck({ saved: (() => { try { return JSON.parse(localStorage.getItem(DECK_KEY) ?? 'null'); } catch { return null; } })() });
const saveDeck = () => { try { localStorage.setItem(DECK_KEY, JSON.stringify(deck.save())); } catch {} };
let player = { timer: 0, clip: null, layer: null, pending: null };
let layerZ = 1;

/** Пустая рамка: `text` — толькі калі кліпаў сапраўды няма (пакуль спіс грузіцца — без надпісу). */
function showIdle(text = '') {
  $('idleText').textContent = text;
  $('idle').classList.remove('hidden');
  $('caption').classList.add('hidden');
  $('band').hidden = true;
  for (const layer of $('screen').querySelectorAll('.layer')) fadeOut(layer);
}

/** Новы слой (прэв’ю або плэер) кладзецца зверху і праяўляецца; ніжнія прыбіраюцца, калі ён накрыў іх. */
function addLayer(element) {
  element.classList.add('layer');
  element.style.zIndex = String(++layerZ);
  $('screen').append(element);
  return element;
}

function reveal(layer) {
  requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add('shown')));
  setTimeout(() => {
    for (const other of $('screen').querySelectorAll('.layer')) {
      if (other !== layer && other !== standby?.frame && Number(other.style.zIndex) < Number(layer.style.zIndex)) other.remove();
    }
  }, 700);
}

function fadeOut(layer) {
  layer.classList.remove('shown');
  setTimeout(() => layer.remove(), 700);
}

/** Twitch аддае прэв’ю 480×272; той жа кадр ёсць і ў 1280×720 — для рамкі 832×468 ён нашмат больш выразны. */
const largeThumb = (url) => url.replace(/-480x272\.(jpg|png)$/, '-1280x720.$1');

/** Кадр-прэв’ю кліпа з Twitch (першы кадр); калі яго няма — мяккі градыент. */
function thumbLayer(clip, settleMs) {
  const box = document.createElement('div');
  box.className = 'thumb';
  if (clip.thumbnail) {
    const img = new Image();
    img.src = largeThumb(clip.thumbnail);
    img.onerror = () => { if (img.src !== clip.thumbnail) img.src = clip.thumbnail; };
    img.alt = '';
    img.style.setProperty('--settle', `${settleMs}ms`);
    box.append(img);
    // Кадр праяўляецца і «асядае» на месца, калі ўжо бачны.
    requestAnimationFrame(() => requestAnimationFrame(() => box.classList.add('settled')));
  } else {
    box.classList.add('empty');
  }
  return addLayer(box);
}

/** Подпіс у адзін радок: назва · аўтар кліпа; мяняецца праз мяккае знікненне. */
function setCaption(clip) {
  const caption = $('caption');
  const wasShown = !caption.classList.contains('hidden');
  caption.classList.add('hidden');
  setTimeout(() => {
    $('clipTitle').textContent = clip.title;
    $('clipAuthor').textContent = clip.creator;
    $('clipBy').hidden = !clip.creator;
    caption.classList.remove('hidden');
  }, wasShown ? 300 : 0);
}

function playerLayer(clip) {
  const frame = document.createElement('iframe');
  const params = new URLSearchParams({
    clip: clip.id, parent: location.hostname, autoplay: 'true', muted: 'false', controls: 'false', preload: 'auto',
  });
  frame.src = `https://clips.twitch.tv/embed?${params}`;
  frame.allow = 'autoplay; fullscreen';
  frame.title = clip.title;
  frame.setAttribute('scrolling', 'no');
  frame.className = 'player';
  frame.addEventListener('load', () => { frame.dataset.loaded = String(performance.now()); debugLine(`load ${clip.id.slice(0, 6)}`); });
  return addLayer(frame);
}

/** `?debug` у адрасе — радок падзей плэера ўнізе злева (для праверкі пераходаў). */
const debugLine = new URLSearchParams(location.search).has('debug') ? (() => {
  const line = document.createElement('div');
  line.style.cssText = 'position:absolute;left:8px;bottom:4px;font:14px Consolas,monospace;color:#8fa39a;z-index:10';
  $('frame').append(line);
  const t0 = performance.now();
  const events = [];
  return (text) => { events.push(`${((performance.now() - t0) / 1000).toFixed(1)} ${text}`); line.textContent = events.slice(-6).join(' · '); };
})() : () => {};

/** Плэер наступнага кліпа, што ўжо грузіцца (празрысты). */
let standby = null;

function prepare(clip) {
  if (!clip || standby?.clip.id === clip.id) return;
  standby?.frame.remove();
  const frame = playerLayer(clip);
  // Пад усімі слаямі: празрысты плэер зверху мог бы «накрыць» той, што грае, і Twitch паставіў бы яго на паўзу.
  frame.style.zIndex = '1';
  standby = { clip, frame };
  debugLine(`standby ${clip.id.slice(0, 6)}`);
}

/** Плэер загрузіўся і пастаяў WARM_MS (або чакаць далей няма сэнсу) — тады `fn`, але не раней за `minMs`. */
function whenWarm(frame, minMs, fn) {
  const since = performance.now();
  const check = () => {
    if (player.pending !== check) return;
    const loaded = frame.dataset.loaded ? performance.now() - Number(frame.dataset.loaded) : -1;
    const waited = performance.now() - since;
    if ((loaded >= WARM_MS || waited >= LOAD_TIMEOUT_MS) && waited >= minMs) fn();
    else player.timer = setTimeout(check, 100);
  };
  player.pending = check;
  check();
}

function playNext() {
  clearTimeout(player.timer);
  const clip = deck.next();
  saveDeck();
  if (!clip) {
    player = { timer: 0, clip: null, layer: null };
    showIdle('Хутка пачынаем');
    return;
  }
  const pause = (state.config?.clipPause ?? 0) * 1000;
  const warm = standby?.clip.id === clip.id && standby.frame.dataset.loaded
    && performance.now() - Number(standby.frame.dataset.loaded) >= WARM_MS;
  prepare(clip);
  $('idle').classList.add('hidden');
  const first = !player.clip;
  player = { ...player, clip, timer: 0 };
  if (first || pause > 0 || !warm) {
    // Першы кліп, паўза або плэер яшчэ не гатовы: праяўляецца першы кадр, потым — паласа.
    reveal(thumbLayer(clip, Math.max(warm ? SETTLE_MIN_MS : SETTLE_COLD_MS, pause)));
    setCaption(clip);
    whenWarm(standby.frame, Math.max(first ? 0 : 650, pause), () => bandTo(clip, true));
  } else {
    bandTo(clip, false);
  }
}

const easeOut = (t) => 1 - (1 - t) ** 3;
const easeIn = (t) => t ** 3;

function animate(ms, ease, step) {
  return new Promise((resolve) => {
    const start = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - start) / ms);
      step(ease(t));
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
}

/** Вуглы паласы з цэнтрам на `c` (px па гарызанталі): верх зрушаны направа на BAND_SLANT. */
function bandAt(c, h) {
  const half = BAND_WIDTH / 2, slant = BAND_SLANT / 2;
  return { tl: c - half + slant, tr: c + half + slant, br: c + half - slant, bl: c - half - slant, h };
}
const px = (n) => `${n.toFixed(1)}px`;
/** Плэер злева ад паласы (тое, што паласа ўжо адкрыла). */
const clipBehind = (b) => `polygon(-1px -1px, ${px(b.tl)} -1px, ${px(b.bl)} ${px(b.h + 1)}, -1px ${px(b.h + 1)})`;
/** Плэер увесь, акрамя паласы (злева і справа ад яе). */
const clipAround = (b, w) => `polygon(evenodd, -1px -1px, ${px(b.tl)} -1px, ${px(b.bl)} ${px(b.h + 1)}, ${px(b.br)} ${px(b.h + 1)}, `
  + `${px(b.tr)} -1px, ${px(w + 1)} -1px, ${px(w + 1)} ${px(b.h + 1)}, -1px ${px(b.h + 1)})`;
const bandShape = (b) => `polygon(${px(b.tl)} -1px, ${px(b.tr)} -1px, ${px(b.br)} ${px(b.h + 1)}, ${px(b.bl)} ${px(b.h + 1)})`;

/** Дыяганальная паласа пралятае праз рамку і адкрывае наступны кліп (падрыхтаваны плэер). */
function bandTo(clip, captionShown) {
  prepare(clip);
  const frame = standby.frame;
  standby = null;
  player.layer = frame;
  player.pending = null;
  const screen = $('screen'), band = $('band');
  const w = screen.clientWidth, h = screen.clientHeight;
  const from = -BAND_WIDTH - BAND_SLANT, middle = w / 2, to = w + BAND_WIDTH + BAND_SLANT;
  // Паласа — над усім, што было; плэер — над паласой, але з выразам на яе месцы.
  band.style.zIndex = String(++layerZ);
  frame.style.zIndex = String(++layerZ);
  frame.style.clipPath = clipBehind(bandAt(from, h));
  band.style.clipPath = bandShape(bandAt(from, h));
  band.hidden = false;
  frame.classList.add('shown');
  debugLine(`band ${clip.id.slice(0, 6)}`);
  const alive = () => player.layer === frame;

  void animate(BAND_IN_MS, easeOut, (t) => {
    if (!alive()) return;
    const b = bandAt(from + (middle - from) * t, h);
    frame.style.clipPath = clipBehind(b);
    band.style.clipPath = bandShape(b);
  }).then(() => {
    if (!alive()) return;
    // Паласа ў цэнтры: плэер бачны вакол яе — Twitch запускае кліп, значок ▶ схаваны пад паласой.
    frame.style.clipPath = clipAround(bandAt(middle, h), w);
    for (const old of screen.querySelectorAll('.layer')) if (old !== frame && old !== standby?.frame) old.remove();
    if (!captionShown) setCaption(clip);
    player.timer = setTimeout(playNext, Math.max(1000, PLAY_AFTER_SHOW_MS + clip.duration * 1000 - END_EARLY_MS - BAND_IN_MS));
    setTimeout(() => {
      if (!alive()) return;
      void animate(BAND_OUT_MS, easeIn, (t) => {
        if (!alive()) return;
        const b = bandAt(middle + (to - middle) * t, h);
        frame.style.clipPath = clipAround(b, w);
        band.style.clipPath = bandShape(b);
      }).then(() => {
        if (!alive()) return;
        frame.style.clipPath = '';
        band.hidden = true;
        // Пакуль гэты кліп грае, загадзя грузіцца наступны.
        const upcoming = deck.peek();
        prepare(upcoming);
        if (upcoming?.thumbnail) new Image().src = largeThumb(upcoming.thumbnail);
      });
    }, BAND_HOLD_MS);
  });
}

async function loadClips() {
  try {
    const { clips } = await get('/intro/clips');
    const wasEmpty = deck.size === 0;
    deck.update(clips);
    saveDeck();
    // Пустая калода атрымала кліпы — пачаць; інакш новыя проста чакаюць у калодзе, бягучы кліп не перарываецца.
    if (wasEmpty && deck.size && !player.clip) playNext();
    if (!deck.size && !player.clip) showIdle('Хутка пачынаем');
  } catch {
    // Праграма не адказала — граем далей па тым, што ўжо ёсць.
  }
}

// ---------- Апытанне праграмы ----------

async function poll() {
  try {
    const next = await get('/intro/state');
    applyConfig(next.config, next.restartAt);
    if (next.clips.fetchedAt !== state.clipsVersion) {
      state.clipsVersion = next.clips.fetchedAt;
      await loadClips();
    }
  } catch {
    // Праграма недаступная: старонка застаецца як ёсць.
  }
  setTimeout(poll, POLL_MS);
}

const activate = () => fetch('/intro/activate', { cache: 'no-store' }).catch(() => {});

// Актывацыя сцэны: адлік і спіс кліпаў — нанова (калі OBS не перазагрузіў старонку сам).
addEventListener('obsSourceActiveChanged', (event) => {
  if (!event.detail?.active || !state.config) return;
  startCountdown(state.config.countdown);
  void activate();
});

showIdle();
void activate();
setInterval(activate, REFRESH_MS);
void poll();
