// «Таймер» — адлік да мэты на экране: стрымер піша мэту, запускае таймер на час, на нулі гучыць сігнал.
// Ядро трымае адзін бягучы таймер (`timer.current`) і налады выгляду (`timer.settings`); малюе і гучыць старонка timer.html у OBS.
// Таймер перажывае перазапуск OBS: захоўваецца дэдлайн (або рэшта на паўзе), а не лічыльнік.
import { randomBytes } from 'node:crypto';
import { plainText } from '../intro/intro.js';

export const TIMER_POSITIONS = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right', 'center'];
export const MAX_SECONDS = 12 * 3600;
const RECENT = 6;

export const timerDefaults = {
  version: 1,
  position: 'top-right',
  scale: 1,
  sound: true,
  volume: 0.7,
  monitor: true,
  hold: 30,
};

export function validateTimer(input) {
  const c = { ...timerDefaults, ...input };
  if (c.version !== 1 || typeof c.sound !== 'boolean' || typeof c.monitor !== 'boolean') throw new Error('timer_settings');
  if (!TIMER_POSITIONS.includes(c.position)) throw new Error('timer_position');
  if (!Number.isFinite(c.scale) || c.scale < 0.5 || c.scale > 2) throw new Error('timer_scale');
  if (!Number.isFinite(c.volume) || c.volume < 0 || c.volume > 1) throw new Error('timer_volume');
  if (!Number.isInteger(c.hold) || c.hold < 0 || c.hold > 600) throw new Error('timer_hold');
  return { version: 1, position: c.position, scale: c.scale, sound: c.sound, volume: c.volume, monitor: c.monitor, hold: c.hold };
}

const seconds = value => {
  if (!Number.isInteger(value) || value < 1 || value > MAX_SECONDS) throw new Error('timer_duration');
  return value;
};

export class Timer {
  constructor({ store, now = Date.now, log = () => {} }) {
    Object.assign(this, { store, now, log });
  }

  config() {
    try { return validateTimer(this.store.get('timer.settings', timerDefaults)); } catch { return { ...timerDefaults }; }
  }

  save(body) {
    const value = validateTimer(body);
    this.store.transaction(() => this.store.set('timer.settings', value));
    return value;
  }

  current() { return this.store.get('timer.current', null); }
  recent() { return this.store.get('timer.recent', []); }

  #set(value) { this.store.transaction(() => this.store.set('timer.current', value)); return this.view(); }

  /** Новы таймер (бягучы, калі ёсць, замяняецца). Мэта — да 80 знакаў, можна пустую. */
  start({ goal = '', seconds: total } = {}) {
    if (!plainText(goal, 0, 80)) throw new Error('timer_goal');
    const text = goal.normalize('NFKC').trim(), duration = seconds(total) * 1000, now = this.now();
    if (text) {
      const recent = [text, ...this.recent().filter(g => g !== text)].slice(0, RECENT);
      this.store.transaction(() => this.store.set('timer.recent', recent));
    }
    this.log('info', 'timer.started', String(total));
    return this.#set({ id: randomBytes(6).toString('hex'), goal: text, duration, deadline: now + duration, left: null, startedAt: now });
  }

  pause() {
    const t = this.#running();
    return this.#set({ ...t, deadline: null, left: Math.max(0, t.deadline - this.now()) });
  }

  resume() {
    const t = this.current();
    if (!t || t.left === null) throw new Error('timer_not_paused');
    return this.#set({ ...t, deadline: this.now() + t.left, left: null });
  }

  /** Дадаць або адняць час (`seconds` можа быць адмоўным). Рэшта — не менш за секунду; поўны час расце разам з ёй. */
  add({ seconds: delta } = {}) {
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > MAX_SECONDS) throw new Error('timer_duration');
    const t = this.current();
    if (!t || this.#finished(t)) throw new Error('timer_not_running');
    const left = t.left ?? t.deadline - this.now();
    const next = Math.min(MAX_SECONDS * 1000, Math.max(1000, left + delta * 1000));
    const duration = Math.max(next, t.duration + (next - left));
    return this.#set(t.left === null ? { ...t, duration, deadline: this.now() + next } : { ...t, duration, left: next });
  }

  stop() {
    this.store.transaction(() => this.store.set('timer.current', null));
    return this.view();
  }

  #finished(t) { return t.left === null && t.deadline <= this.now(); }

  #running() {
    const t = this.current();
    if (!t || t.left !== null || this.#finished(t)) throw new Error('timer_not_running');
    return t;
  }

  /** Для дока і старонкі: дэдлайн або рэшта, і час ядра — старонка лічыць сама (як адлік галасавання). */
  view() {
    const t = this.current(), now = this.now();
    if (!t) return { timer: null, serverNow: now };
    const finished = this.#finished(t);
    // Пасля нуля таймер трымаецца на экране `hold` секунд, потым хаваецца (у доку застаецца да «Скінуць»).
    const shown = !finished || now - t.deadline < this.config().hold * 1000;
    return { timer: { id: t.id, goal: t.goal, duration: t.duration, deadline: t.deadline, left: t.left, paused: t.left !== null, finished, shown }, serverNow: now };
  }

  overlayState() {
    const { position, scale, sound, volume } = this.config();
    return { config: { position, scale, sound, volume }, ...this.view() };
  }

  snapshot() {
    return { config: this.config(), recent: this.recent(), ...this.view() };
  }
}
