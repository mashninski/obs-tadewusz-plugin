import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TIMER_INPUT, ensureTimerSource, timerBrowserSettings } from '../core/obs/timer-source.js';
import { Timer, timerDefaults, validateTimer } from '../core/timer/timer.js';
import { formatLeft } from '../web/src/timer/format.js';
import { clock, store } from './helpers.js';

function timer(t) {
  const now = clock();
  return { timer: new Timer({ store: store(t, now), now }), now };
}

// ---------- Налады ----------

test('налады таймера: прадвызначаныя і праверка палёў', () => {
  assert.deepEqual(validateTimer({}), timerDefaults);
  assert.equal(validateTimer({ position: 'center', scale: 2, hold: 0, volume: 0 }).position, 'center');
  for (const [patch, code] of [
    [{ position: 'left' }, /timer_position/], [{ scale: 0.4 }, /timer_scale/], [{ scale: 2.5 }, /timer_scale/],
    [{ volume: 1.1 }, /timer_volume/], [{ hold: 601 }, /timer_hold/], [{ hold: 1.5 }, /timer_hold/],
    [{ sound: 'yes' }, /timer_settings/], [{ version: 2 }, /timer_settings/],
  ]) assert.throws(() => validateTimer(patch), code, JSON.stringify(patch));
  assert.deepEqual(Object.keys(validateTimer({ extra: 1 })).sort(), Object.keys(timerDefaults).sort());
});

// ---------- Адлік ----------

test('таймер: старт, паўза, працяг і нуль па дэдлайне', t => {
  const { timer: tm, now } = timer(t);
  assert.equal(tm.view().timer, null);
  const started = tm.start({ goal: '  Прайсці боса  ', seconds: 90 }).timer;
  assert.equal(started.goal, 'Прайсці боса');
  assert.equal(started.duration, 90_000);
  assert.equal(started.deadline, now() + 90_000);

  now.advance(30_000);
  const paused = tm.pause().timer;
  assert.equal(paused.paused, true);
  assert.equal(paused.left, 60_000);
  assert.equal(paused.deadline, null);

  now.advance(600_000); // на паўзе час не ідзе
  const resumed = tm.resume().timer;
  assert.equal(resumed.deadline, now() + 60_000);
  assert.throws(() => tm.resume(), /timer_not_paused/);

  now.advance(60_000);
  const done = tm.view().timer;
  assert.equal(done.finished, true);
  assert.equal(done.shown, true);
  assert.throws(() => tm.pause(), /timer_not_running/);
  assert.throws(() => tm.add({ seconds: 60 }), /timer_not_running/);
});

test('таймер: пасля нуля трымаецца на экране `hold` секунд', t => {
  const { timer: tm, now } = timer(t);
  tm.save({ ...timerDefaults, hold: 10 });
  tm.start({ seconds: 5 });
  now.advance(5_000 + 9_999);
  assert.equal(tm.view().timer.shown, true);
  now.advance(1);
  assert.equal(tm.view().timer.shown, false);
  assert.equal(tm.view().timer.finished, true);
  assert.equal(tm.stop().timer, null);
});

test('таймер: ±хвіліна, рэшта не менш за секунду, поўны час расце', t => {
  const { timer: tm, now } = timer(t);
  tm.start({ seconds: 120 });
  now.advance(20_000);
  let v = tm.add({ seconds: 60 }).timer;
  assert.equal(v.deadline - now(), 160_000);
  assert.equal(v.duration, 180_000);
  v = tm.add({ seconds: -600 }).timer;
  assert.equal(v.deadline - now(), 1000);
  assert.equal(v.duration, 21_000); // поўны час = прайшло + рэшта
  tm.pause();
  v = tm.add({ seconds: 30 }).timer;
  assert.equal(v.left, 31_000);
  assert.throws(() => tm.add({ seconds: 0 }), /timer_duration/);
});

test('таймер: праверка мэты і часу, апошнія мэты без паўтораў', t => {
  const { timer: tm } = timer(t);
  for (const [body, code] of [
    [{ seconds: 0 }, /timer_duration/], [{ seconds: 12 * 3600 + 1 }, /timer_duration/], [{ seconds: 1.5 }, /timer_duration/],
    [{ goal: 'x'.repeat(81), seconds: 10 }, /timer_goal/], [{ goal: 'a\u0007b', seconds: 10 }, /timer_goal/], [{ goal: 5, seconds: 10 }, /timer_goal/],
  ]) assert.throws(() => tm.start(body), code, JSON.stringify(body));
  for (const goal of ['A', 'B', 'A', '', 'C', 'D', 'E', 'F', 'G']) tm.start({ goal, seconds: 10 });
  assert.deepEqual(tm.recent(), ['G', 'F', 'E', 'D', 'C', 'A']);
});

test('таймер: старонка атрымлівае толькі выгляд, без маніторынгу і hold', t => {
  const { timer: tm, now } = timer(t);
  tm.start({ goal: 'Мэта', seconds: 10 });
  const state = tm.overlayState();
  assert.deepEqual(Object.keys(state.config).sort(), ['position', 'scale', 'sound', 'volume']);
  assert.equal(state.serverNow, now());
  assert.equal(state.timer.goal, 'Мэта');
});

test('рэшта словамі', () => {
  assert.equal(formatLeft(0), '00:00');
  assert.equal(formatLeft(65), '01:05');
  assert.equal(formatLeft(3599), '59:59');
  assert.equal(formatLeft(3723), '1:02:03');
});

// ---------- Крыніца ў OBS ----------

test('крыніца таймера: гук праз OBS, маніторынг па наладзе', async () => {
  const inputs = new Map(), scenes = new Map([['Гульня', [{ sceneItemId: 1, sourceName: 'Камера' }]]]), calls = [];
  let next = 10, monitorType = 'OBS_MONITORING_TYPE_NONE';
  const obs = {
    state: { connected: true },
    async request(type, data = {}) {
      calls.push(type);
      switch (type) {
        case 'GetVideoSettings': return { baseWidth: 1920, baseHeight: 1080 };
        case 'GetCurrentProgramScene': return { currentProgramSceneName: 'Гульня' };
        case 'GetInputList': return { inputs: [...inputs].map(([inputName, v]) => ({ inputName, inputKind: v.kind })) };
        case 'CreateInput': inputs.set(data.inputName, { kind: data.inputKind, settings: data.inputSettings }); scenes.get(data.sceneName).push({ sceneItemId: next++, sourceName: data.inputName }); return {};
        case 'GetInputSettings': return { inputSettings: inputs.get(data.inputName).settings };
        case 'SetInputSettings': Object.assign(inputs.get(data.inputName).settings, data.inputSettings); return {};
        case 'GetSceneItemList': return { sceneItems: scenes.get(data.sceneName).map(i => ({ ...i })) };
        case 'GetInputAudioMonitorType': return { monitorType };
        case 'SetInputAudioMonitorType': monitorType = data.monitorType; return {};
        default: return {};
      }
    },
  };
  const result = await ensureTimerSource(obs, { url: 'file:///start.html?page=timer&port=1', monitor: true });
  assert.deepEqual(result, { sceneName: 'Гульня', inputCreated: true, itemCreated: true });
  assert.equal(inputs.get(TIMER_INPUT).settings.reroute_audio, true);
  assert.equal(monitorType, 'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT');
  assert.equal(timerBrowserSettings('u', 1, 1).shutdown, true);
  await ensureTimerSource(obs, { url: 'file:///start.html?page=timer&port=1', monitor: false });
  assert.equal(monitorType, 'OBS_MONITORING_TYPE_NONE');
  assert.equal(scenes.get('Гульня').filter(i => i.sourceName === TIMER_INPUT).length, 1);
});
