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
 * Плэер кліпаў Twitch нічога не паведамляе старонцы (ні «грае», ні «скончыўся») і не прымае каманд.
 * Ён запускаецца толькі тады, калі бачны: не паменшаны, не празрысты, нічым не накрыты і хоць бы на паловую
 * плошчы ў акне старонкі; першыя ~0,8–1 с пасля гэтага стаіць на паўзе са значком ▶. Калі яго абрэзаць
 * больш чым напалову — становіцца на паўзу і сам не працягвае (усё замерана ў OBS 2026-10-24).
 *
 * Таму наступны кліп стартуе «за кадрам»: старонка вышэйшая за 1080 (1920×1560), а OBS абразае ніжнія 480 px
 * (сцэну так наладжвае кнопка дока). Там плэер бачны для браўзера, але не для гледачоў — значок ▶ і старт
 * праходзяць там. Змена кліпаў — «нарэзка»:
 * 1) у рамку касым зрэзам уваходзіць картка «наступны кліп» (назва, аўтар) і накрывае канец старога кліпа;
 * 2) пад карткай ужо гучыць новы кліп (ён грае за кадрам) — гук на імгненне апярэджвае карцінку;
 * 3) новы кліп, ужо на хаду, такім жа хуткім касым зрэзам (0,3 с) займае рамку — без паўзы і без ▶.
 * `controls=false` — Twitch не малюе назву, кнопкі і плашкі (гук застаецца).
 */
/** Шырыня кадра і месца «за кадрам»: ніжэй за 1080 з запасам 6 px. */
const FRAME_H = 1080;
const OFFSTAGE_Y = 1086;
/** Пасля загрузкі старонкі плэера — кароткі запас, перш чым рабіць яго бачным (▶ усё роўна за кадрам). */
const WARM_MS = 300;
/** Ад «стаў бачным» да ўваходу ў рамку: значок ▶ і пачатак прайгравання праходзяць за кадрам. */
const START_MS = 1100;
/** Каля гэтага часу пасля «стаў бачным» кліп сапраўды пачынае іграць (па кадрах у OBS — 0,5–1 с). */
const PLAYS_AFTER_MS = 500;
/** Уваход карткі і ўваход кліпа — хуткія касыя зрэзы. */
const CARD_IN_MS = 480;
/**
 * Стары плэер спачатку пераводзіцца на пустую старонку і толькі потым выдаляецца, а новы стартуе пасля гэтага.
 * Калі выдаліць плэер са гукам на хаду (ці запусціць новы адначасова), гук у OBS «спатыкаецца»,
 * і наступны кліп ідзе рыўкамі (замерана ў OBS 2026-10-24).
 */
const QUIET_MS = 300;
const WIPE_MS = 700;
/** Картка накрывае кліп крыху раней за канец — экран рэкамендацый Twitch не відаць. */
const END_EARLY_MS = 450;
/** Колькі першы кадр «праяўляецца» (першы кліп пасля актывацыі). */
const SETTLE_COLD_MS = 5500;
/** Калі старонка плэера не загрузілася, кліп усё роўна запускаецца. */
const LOAD_TIMEOUT_MS = 10_000;
const DECK_KEY = 'tadewusz.intro.deck';

const $ = (id) => document.getElementById(id);
const state = { config: null, restartAt: null, clipsVersion: undefined, countdownFrom: 0, countdownSeconds: 0 };

// ---------- Кадр ----------

const fit = () => document.documentElement.style.setProperty('--fit', String(Math.min(innerWidth / 1920, innerHeight / FRAME_H)));
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
/** `current` — кліп у рамцы; `standby` — плэер наступнага, празрысты, за кадрам; `token` адмяняе старыя таймеры. */
let current = null;
let standby = null;
let token = 0;
let layerZ = 1;
const later = (ms, fn) => { const my = token; setTimeout(() => { if (my === token) fn(); }, ms); };

/** `?debug` у адрасе — радок падзей плэера ўнізе злева (для праверкі пераходаў). */
const debugLine = new URLSearchParams(location.search).has('debug') ? (() => {
  const line = document.createElement('div');
  line.style.cssText = 'position:absolute;left:8px;top:1050px;font:14px Consolas,monospace;color:#8fa39a;z-index:10';
  $('root').append(line);
  const t0 = performance.now();
  const events = [];
  return (text) => { events.push(`${((performance.now() - t0) / 1000).toFixed(1)} ${text}`); line.textContent = events.slice(-6).join(' · '); };
})() : () => {};

/** Месца «за кадрам» ёсць, калі старонка вышэйшая за кадр (сцэна наладжана кнопкай дока). */
const offstage = () => innerHeight / Number(getComputedStyle(document.documentElement).getPropertyValue('--fit') || 1) >= OFFSTAGE_Y + 468;

/** Рамка кліпа ў каардынатах кораня (1920×1560). */
function box() {
  const root = $('root').getBoundingClientRect(), r = $('screen').getBoundingClientRect();
  const k = root.width / 1920;
  return { x: (r.left - root.left) / k, y: (r.top - root.top) / k, w: r.width / k, h: r.height / k };
}

function place(el, where) {
  const b = box();
  el.style.left = `${b.x}px`;
  el.style.top = `${where === 'box' ? b.y : OFFSTAGE_Y}px`;
  el.style.width = `${b.w}px`;
  el.style.height = `${b.h}px`;
}

function addLayer(el, where = 'box') {
  el.style.zIndex = String(++layerZ);
  place(el, where);
  $('players').append(el);
  return el;
}

/** Пустая рамка: `text` — толькі калі кліпаў сапраўды няма (пакуль спіс грузіцца — без надпісу). */
function showIdle(text = '') {
  token++;
  $('idleText').textContent = text;
  $('idle').classList.remove('hidden');
  $('caption').classList.add('hidden');
  for (const el of $('players').children) el.remove();
  current = null;
  standby = null;
}

/** Twitch аддае прэв’ю 480×272; той жа кадр ёсць і ў 1280×720 — для рамкі 832×468 ён нашмат больш выразны. */
const largeThumb = (url) => url.replace(/-480x272\.(jpg|png)$/, '-1280x720.$1');

/** Першы кадр кліпа, што мякка праяўляецца (першы кліп пасля актывацыі сцэны). */
function thumbLayer(clip) {
  const el = document.createElement('div');
  el.className = 'thumb';
  if (clip.thumbnail) {
    const img = new Image();
    img.src = largeThumb(clip.thumbnail);
    img.onerror = () => { if (img.src !== clip.thumbnail) img.src = clip.thumbnail; };
    img.alt = '';
    img.style.setProperty('--settle', `${SETTLE_COLD_MS}ms`);
    el.append(img);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('settled')));
  }
  return addLayer(el);
}

/** Картка «нарэзкі» паміж кліпамі: наступны кліп, назва, аўтар. Уваходзіць касым зрэзам. */
function cardLayer(clip) {
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = '<div class="card-lines" aria-hidden="true"></div><div class="card-body"><div class="card-label">Наступны кліп</div>'
    + '<div class="card-title"></div><div class="card-by"></div></div>';
  el.querySelector('.card-title').textContent = clip.title;
  el.querySelector('.card-by').textContent = clip.creator;
  return addLayer(el);
}

/** Подпіс пад рамкай у адзін радок: назва · аўтар кліпа. */
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

/** Плэер кліпа за кадрам, празрысты: грузіцца, але Twitch яго не запускае, пакуль ён не стане бачным. */
function prepare(clip) {
  if (!clip || standby?.clip.id === clip.id) return;
  standby?.frame.remove();
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
  addLayer(frame, offstage() ? 'offstage' : 'box');
  // Без месца «за кадрам» ждучы плэер ляжыць пад рамкай — там ён павінен быць цалкам празрыстым.
  if (!offstage()) frame.style.opacity = '0';
  frame.style.zIndex = '1';
  standby = { clip, frame };
  debugLine(`standby ${clip.id.slice(0, 6)}`);
}

/** Чакаць, пакуль плэер загрузіцца і пастаіць WARM_MS (але не даўжэй за LOAD_TIMEOUT_MS). */
function whenWarm(frame, fn) {
  const since = performance.now();
  const check = () => {
    const loaded = frame.dataset.loaded ? performance.now() - Number(frame.dataset.loaded) : -1;
    if (loaded >= WARM_MS || performance.now() - since >= LOAD_TIMEOUT_MS) fn();
    else later(100, check);
  };
  check();
}

const easeInOut = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Мяккі касы зрэз злева направа: маска з размытым краем (~150 px), `p` 0…1 — колькі ўжо відаць.
 * Маска на плэеры, што ўжо грае, Twitch не перашкаджае (праверана ў OBS); пасля зрэзу яна здымаецца.
 */
const softSlash = (p) => {
  const x = -30 + 160 * p;
  return `linear-gradient(105deg, #000 ${x - 9}%, transparent ${x + 9}%)`;
};

function wipeIn(el, ms) {
  return new Promise((resolve) => {
    const start = performance.now();
    const apply = (mask) => { el.style.maskImage = mask; el.style.webkitMaskImage = mask; };
    const step = (now) => {
      const t = Math.min(1, (now - start) / ms);
      apply(t < 1 ? softSlash(easeInOut(t)) : '');
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    apply(softSlash(0));
    requestAnimationFrame(step);
  });
}

function playNext() {
  token++;
  const clip = deck.next();
  saveDeck();
  if (!clip) { showIdle('Хутка пачынаем'); return; }
  prepare(clip);
  $('idle').classList.add('hidden');
  const frame = standby.frame;
  const pause = (state.config?.clipPause ?? 0) * 1000;
  debugLine(`next ${clip.id.slice(0, 6)}`);

  const since = performance.now();
  let cover, startAfter = 0;
  if (!current) {
    // Першы кліп пасля актывацыі: праяўляецца яго першы кадр, пакуль плэер грузіцца.
    cover = thumbLayer(clip);
    setCaption(clip);
  } else {
    // Картка касым зрэзам накрывае канец старога кліпа; калі накрыла — стары плэер прыбіраецца (і яго гук).
    cover = cardLayer(clip);
    void wipeIn(cover, CARD_IN_MS);
    setCaption(clip);
    const old = current.frame;
    later(CARD_IN_MS, () => { old.src = 'about:blank'; });
    later(CARD_IN_MS + QUIET_MS, () => old.remove());
    startAfter = CARD_IN_MS + QUIET_MS;
  }
  current = { clip, frame };

  whenWarm(frame, () => {
    // Плэер становіцца бачным за кадрам: Twitch запускае кліп (значок ▶ — там). Паўза — картка стаіць даўжэй.
    const wait = Math.max(startAfter, CARD_IN_MS + pause - START_MS);
    later(Math.max(0, since + wait - performance.now()), () => {
      standby = null;
      frame.style.opacity = '1';
      const startedAt = performance.now();
      // Сцэна яшчэ не наладжана на «за кадрам» — плэер стартуе адразу ў рамцы (значок ▶ будзе відаць).
      if (!offstage()) frame.style.zIndex = String(++layerZ);
      debugLine(`start ${clip.id.slice(0, 6)}`);
      later(START_MS, () => {
        // Кліп ужо грае: у рамку — хуткім касым зрэзам, паверх карткі.
        place(frame, 'box');
        frame.style.zIndex = String(++layerZ);
        debugLine(`in ${clip.id.slice(0, 6)}`);
        void wipeIn(frame, WIPE_MS).then(() => {
          for (const el of [...$('players').children]) if (el !== frame && el !== standby?.frame) el.remove();
        });
        // Канец кліпа — ад моманту, калі ён пачаў іграць за кадрам, а не ад уваходу ў рамку.
        const endsAt = startedAt + PLAYS_AFTER_MS + clip.duration * 1000;
        later(Math.max(1500, endsAt - END_EARLY_MS - CARD_IN_MS - performance.now()), playNext);
        // Пакуль гэты кліп грае, наступны ўжо грузіцца за кадрам (празрысты — Twitch яго не запускае).
        later(WIPE_MS + 50, () => prepare(deck.peek()));
      });
    });
  });
}

async function loadClips() {
  try {
    const { clips } = await get('/intro/clips');
    const wasEmpty = deck.size === 0;
    deck.update(clips);
    saveDeck();
    // Пустая калода атрымала кліпы — пачаць; інакш новыя проста чакаюць у калодзе, бягучы кліп не перарываецца.
    if (wasEmpty && deck.size && !current) playNext();
    if (!deck.size && !current) showIdle('Хутка пачынаем');
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
