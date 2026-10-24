// Оверлей інтро: спасылкі (з QR), кліпы канала афіцыйным плэерам Twitch, адлік да пачатку стрыму.
// Налады бярэ з праграмы кожныя 2 с — змены з дока відаць адразу, без перастварэння сцэны.
// Крыніца ў OBS выключаецца, калі сцэна не бачная, і перазагружаецца пры актывацыі: адлік пачынаецца нанова,
// спіс кліпаў абнаўляецца. Пакуль сцэна ў эфіры — спіс абнаўляецца раз у 5 хвілін, калода працягваецца.
import { encode } from 'uqr';
import { ClipDeck } from './deck.js';
import { grainTile, startTopo } from './topo.js';

const POLL_MS = 2000;
const REFRESH_MS = 5 * 60_000;
/**
 * Запас на старт плэера пасля загрузкі старонкі Twitch: кліп не абрываецца на апошніх кадрах,
 * але і экран рэкамендацый Twitch пасля кліпа амаль не паспявае з’явіцца.
 */
const PLAYER_LEAD_MS = 800;
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
let player = { timer: 0, clip: null };

function showIdle(text) {
  $('idleText').textContent = text;
  $('idle').classList.remove('hidden');
  $('clipTitle').parentElement.classList.add('hidden');
}

function playNext() {
  clearTimeout(player.timer);
  const clip = deck.next();
  saveDeck();
  if (!clip) {
    player = { timer: 0, clip: null };
    showIdle('Хутка пачынаем');
    return;
  }
  const frame = document.createElement('iframe');
  const params = new URLSearchParams({ clip: clip.id, parent: location.hostname, autoplay: 'true', muted: 'false', preload: 'auto' });
  frame.src = `https://clips.twitch.tv/embed?${params}`;
  frame.allow = 'autoplay; fullscreen';
  frame.title = clip.title;
  frame.setAttribute('scrolling', 'no');
  player = { timer: 0, clip, frame };
  let started = false;
  const start = () => {
    if (started || player.frame !== frame) return;
    started = true;
    frame.classList.add('shown');
    $('idle').classList.add('hidden');
    $('clipTitle').textContent = clip.title;
    $('clipBy').textContent = clip.creator ? `кліп: ${clip.creator}` : '';
    $('clipTitle').parentElement.classList.remove('hidden');
    clearTimeout(player.timer);
    player.timer = setTimeout(pause, clip.duration * 1000 + PLAYER_LEAD_MS);
  };
  frame.addEventListener('load', start);
  player.timer = setTimeout(start, LOAD_TIMEOUT_MS);
  $('screen').append(frame);
}

/** Паўза паміж кліпамі: плэер знікае, застаецца рамка з фонам. */
function pause() {
  const frame = player.frame;
  frame?.classList.remove('shown');
  showIdle('');
  setTimeout(() => frame?.remove(), 600);
  player = { timer: setTimeout(playNext, (state.config?.clipPause ?? 5) * 1000), clip: null };
}

async function loadClips() {
  try {
    const { clips } = await get('/intro/clips');
    const wasEmpty = deck.size === 0;
    deck.update(clips);
    saveDeck();
    // Пустая калода атрымала кліпы — пачаць; інакш новыя проста чакаюць у калодзе, бягучы кліп не перарываецца.
    if (wasEmpty && deck.size && !player.clip && !player.timer) playNext();
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

showIdle('Хутка пачынаем');
void activate();
setInterval(activate, REFRESH_MS);
void poll();
