// Старонка «Таймер» у OBS: картка з мэтай і адлікам у куце кадра; на нулі — сігнал (праз мікшар OBS) і свячэнне.
// Стан — з праграмы (апытанне раз у 0,5 с); лічыць старонка сама па дэдлайне і часе ядра, як адлік галасавання.
// ?preview=75 — паказ таймера на 75 с без праграмы (для праверкі ў браўзеры).
import { formatLeft } from './format.js';

const POLL_MS = 500;
// Сігнал гучыць, толькі калі старонка бачыла таймер да нуля або нуль быў зусім нядаўна (не пры перазагрузцы праз хвіліну).
const LATE_SIGNAL_MS = 5000;

const card = document.getElementById('card');
const goal = document.getElementById('goal');
const clock = document.getElementById('clock');
const fill = document.getElementById('fill');
const previewSeconds = Number(new URLSearchParams(location.search).get('preview')) || 0;

let state = null, offset = 0, fetching = false, audio = null;
let signalled = '', seenBefore = '', lastSecond = -1;

const serverNow = () => Date.now() + offset;

function fakeState() {
  const start = (window.__timerStart ??= Date.now());
  const duration = previewSeconds * 1000;
  const deadline = start + duration;
  return {
    config: { position: new URLSearchParams(location.search).get('position') || 'top-right', scale: 1, sound: true, volume: 0.7 },
    timer: { id: 'preview', goal: 'Прайсці боса без лячэння', duration, deadline, left: null, paused: false, finished: Date.now() >= deadline, shown: Date.now() < deadline + 30000 },
    serverNow: Date.now(),
  };
}

async function update() {
  if (fetching) return;
  fetching = true;
  try {
    let next;
    if (previewSeconds) next = fakeState();
    else {
      const response = await fetch('/timer/state', { cache: 'no-store' });
      if (!response.ok) return;
      next = await response.json();
    }
    offset = next.serverNow - Date.now();
    state = next;
    document.body.dataset.position = state.config.position;
    // Картка і адступ ад краю — у прапорцыі да кадра (1080 px — 100 %).
    const frame = innerHeight / 1080 || 1;
    document.documentElement.style.setProperty('--k', String(state.config.scale * frame));
    document.documentElement.style.setProperty('--margin', `${Math.round(48 * frame)}px`);
    render();
  } catch { /* Пры часовым збоі сувязі застаецца апошні паказаны стан. */ }
  finally { fetching = false; }
}

function render() {
  const t = state?.timer;
  card.hidden = !t?.shown;
  if (!t) return;
  goal.textContent = t.goal;
  const left = t.paused ? t.left : Math.max(0, t.deadline - serverNow());
  const finished = !t.paused && left <= 0;
  const seconds = Math.ceil(left / 1000);
  card.classList.toggle('paused', t.paused);
  card.classList.toggle('finished', finished);
  card.classList.toggle('urgent', !finished && !t.paused && seconds <= 10);
  clock.textContent = finished ? 'Час!' : formatLeft(seconds);
  fill.style.transform = `scaleX(${t.duration ? Math.max(0, Math.min(1, left / t.duration)) : 0})`;

  if (!finished) seenBefore = t.id;
  // Апошнія 10 секунд — лёгкі штуршок лічбаў кожную секунду.
  if (!finished && !t.paused && seconds <= 10 && seconds !== lastSecond) {
    clock.classList.remove('beat');
    void clock.offsetWidth;
    clock.classList.add('beat');
  }
  lastSecond = seconds;
  if (finished && signalled !== t.id) {
    signalled = t.id;
    if (seenBefore === t.id || serverNow() - t.deadline < LATE_SIGNAL_MS) void chime();
  }
}

/** Сігнал: два ўзыходныя тройкі тонаў, мяккія, як звон. Гучыць праз крыніцу OBS — у эфір і (з маніторынгам) стрымеру. */
async function chime() {
  const { sound, volume } = state.config;
  if (!sound || volume <= 0) return;
  try {
    audio ??= new AudioContext();
    await audio.resume();
    const at = audio.currentTime + 0.05;
    const master = audio.createGain();
    master.gain.value = volume * 0.5;
    master.connect(audio.destination);
    [0, 0.9].forEach(round => [523.25, 659.25, 783.99].forEach((freq, i) => {
      const start = at + round + i * 0.16;
      for (const [mult, level] of [[1, 1], [2, 0.25], [3, 0.08]]) {
        const osc = audio.createOscillator(), gain = audio.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq * mult;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(level, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.1);
        osc.connect(gain).connect(master);
        osc.start(start);
        osc.stop(start + 1.15);
      }
    }));
  } catch { /* Гук неабавязковы: таймер паказваецца і без яго. */ }
}

addEventListener('resize', () => void update());
update();
setInterval(update, POLL_MS);
setInterval(render, 100);
