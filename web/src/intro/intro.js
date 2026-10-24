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
 * а запускаецца толькі тады, калі ён цалкам бачны: не паменшаны, не празрысты і нічым не накрыты
 * (замерана ў OBS 2026-10-24). Таму змена кліпаў будуецца так:
 * - `controls=false` — Twitch не малюе назву, кнопкі і плашкі (гук пры гэтым застаецца);
 * - наступны кліп спачатку з’яўляецца сваім першым кадрам (прэв’ю з Twitch) — пустой рамкі няма;
 * - плэер наступнага кліпа загружаецца загадзя, пакуль грае бягучы, — празрыстым: Twitch яго не запускае
 *   і чакае; калі прыходзіць яго чарга, ён становіцца бачным і праз ~0,8 с пачынае (без чорнай загрузкі);
 * - незадоўга да канца кліпа кадр наступнага накрывае яго — экран рэкамендацый Twitch не відаць.
 */
/**
 * Плэеру пасля загрузкі патрэбны час, каб падрыхтавацца: тады пасля паказу ён пачынае адразу,
 * без чорнага экрана і значка ▶ (з 1 с значок яшчэ мільгаў — замерана ў OBS).
 */
const WARM_MS = 3000;
/** Падрыхтаваны плэер пачынае праз столькі пасля таго, як стаў бачным. */
const PLAY_AFTER_SHOW_MS = 500;
/** Наступны кадр накрывае кліп крыху раней за канец (пераход — 0,6 с). */
const END_EARLY_MS = 800;
/** Мінімальны час на кадры-прэв’ю: ён паспявае цалкам накрыць папярэдні кліп. */
const COVER_MS = 650;
/** Калі старонка плэера не загрузілася, кліп усё роўна саступае месца наступнаму. */
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
let player = { timer: 0, clip: null, layer: null };
let layerZ = 1;

function showIdle() {
  $('idle').classList.remove('hidden');
  $('clipTitle').parentElement.classList.add('hidden');
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
function thumbLayer(clip) {
  const box = document.createElement('div');
  box.className = 'thumb';
  if (clip.thumbnail) {
    const img = new Image();
    img.src = largeThumb(clip.thumbnail);
    img.onerror = () => { if (img.src !== clip.thumbnail) img.src = clip.thumbnail; };
    img.alt = '';
    box.append(img);
  } else {
    box.classList.add('empty');
  }
  return addLayer(box);
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

function playNext() {
  clearTimeout(player.timer);
  const clip = deck.next();
  saveDeck();
  if (!clip) {
    player = { timer: 0, clip: null, layer: null };
    showIdle();
    return;
  }
  // Кадр наступнага кліпа накрывае папярэдні (ці фон), подпіс мяняецца разам з ім.
  $('idle').classList.add('hidden');
  reveal(thumbLayer(clip));
  $('clipTitle').textContent = clip.title;
  $('clipBy').textContent = clip.creator ? `кліп: ${clip.creator}` : '';
  $('clipTitle').parentElement.classList.remove('hidden');
  const hold = Math.max(COVER_MS, (state.config?.clipPause ?? 0) * 1000);
  player = { clip, timer: setTimeout(() => startPlayer(clip), hold), layer: null };
}

function startPlayer(clip) {
  // Плэер заўсёды праходзіць праз «запас»: грузіцца празрыстым, пакуль відаць кадр-прэв’ю.
  prepare(clip);
  const frame = standby.frame;
  player.layer = frame;
  const show = () => {
    if (player.layer !== frame || frame.classList.contains('shown')) return;
    clearTimeout(player.timer);
    standby = null;
    // Наверх і адразу непразрысты: інакш Twitch не запусціць кліп.
    frame.style.zIndex = String(++layerZ);
    frame.classList.add('shown');
    debugLine(`show ${clip.id.slice(0, 6)}`);
    for (const old of $('screen').querySelectorAll('iframe')) if (old !== frame) old.remove();
    setTimeout(() => {
      if (player.layer !== frame) return;
      for (const thumb of $('screen').querySelectorAll('.thumb')) thumb.remove();
      // Пакуль гэты кліп грае, загадзя грузіцца наступны.
      const upcoming = deck.peek();
      prepare(upcoming);
      if (upcoming?.thumbnail) new Image().src = largeThumb(upcoming.thumbnail);
    }, PLAY_AFTER_SHOW_MS + 1500);
    player.timer = setTimeout(playNext, Math.max(1000, PLAY_AFTER_SHOW_MS + clip.duration * 1000 - END_EARLY_MS));
  };
  const loadedFor = frame.dataset.loaded ? performance.now() - Number(frame.dataset.loaded) : -1;
  if (loadedFor >= WARM_MS) show();
  else if (loadedFor >= 0) player.timer = setTimeout(show, WARM_MS - loadedFor);
  else {
    frame.addEventListener('load', () => { player.timer = setTimeout(show, WARM_MS); });
    player.timer = setTimeout(show, LOAD_TIMEOUT_MS);
  }
}

async function loadClips() {
  try {
    const { clips } = await get('/intro/clips');
    const wasEmpty = deck.size === 0;
    deck.update(clips);
    saveDeck();
    // Пустая калода атрымала кліпы — пачаць; інакш новыя проста чакаюць у калодзе, бягучы кліп не перарываецца.
    if (wasEmpty && deck.size && !player.clip) playNext();
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
