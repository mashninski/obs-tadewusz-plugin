import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { Ticker } from '../core/ticker/ticker.js';
import { TickerReception } from '../core/ticker/reception.js';
import { Voice } from '../core/voice/voice.js';
import { Bindings } from '../core/voting/reception.js';
import { VOICE_PERSONAS, voiceDurationMs } from '../shared/voice-personas.js';
import { clock, fakeEventSub, fakeTwitch, store, tempDir } from './helpers.js';

/** Падробка працэсу Python: адказвае на запыты так, як core/voice/worker.py. */
function fakeWorker({ fail = false } = {}) {
  const spawned = [];
  const spawn = (command, args, options) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => child.emit('exit', null);
    child.ready = () => child.stdout.write(JSON.stringify({ event: 'ready', device: 'cuda:0' }) + '\n');
    let buffer = '';
    child.stdin.setEncoding('utf8');
    child.stdin.on('data', chunk => {
      buffer += chunk;
      for (let i; (i = buffer.indexOf('\n')) >= 0; buffer = buffer.slice(i + 1)) {
        const job = JSON.parse(buffer.slice(0, i));
        child.requests.push(job);
        if (fail) child.stdout.write(JSON.stringify({ id: job.id, ok: false, error: 'ValueError: x' }) + '\n');
        else { writeFileSync(job.out, 'RIFF'); child.stdout.write(JSON.stringify({ id: job.id, ok: true, ms: 3200 }) + '\n'); }
      }
    });
    child.stdin.on('end', () => child.emit('exit', 0));
    child.requests = [];
    spawned.push({ command, args, options, child });
    return child;
  };
  return { spawn, spawned };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 5));

function setup(t, worker = fakeWorker()) {
  const now = clock(Date.now());
  const s = store(t, now);
  const dataDir = tempDir(), omni = join(dataDir, 'OmniVoice');
  mkdirSync(join(omni, '.venv', 'Scripts'), { recursive: true });
  writeFileSync(join(omni, '.venv', 'Scripts', 'python.exe'), '');
  const voice = new Voice({ store: s, dataDir, now, spawn: worker.spawn });
  t.after(() => voice.close());
  voice.save({ version: 1, enabled: true, path: omni, volume: 0.8 });
  const ticker = new Ticker({ store: s, now, voice: { wanted: () => voice.wanted(), pick: () => voice.pick(), volume: () => voice.config().volume } });
  const client = randomUUID();
  const beat = () => ticker.heartbeat({ client, source: ticker.source, visible: true, obs: true });
  ticker.setReady({ source: true });
  const paid = id => ticker.ingest(
    { id, reward: { id: 'tick', cost: 1000 }, status: 'UNFULFILLED', redeemed_at: new Date(now() - 1000).toISOString(), user_input: 'Прывітанне ўсім!', user_name: 'Viewer' },
    `m-${id}`, { account: 'acc', reward: 'tick', admitted: true });
  return { s, now, voice, ticker, beat, paid, worker, omni };
}

test('голас: працэс OmniVoice запускаецца схавана; паведамленне ідзе ў эфір толькі з гатовым аўдыя', async t => {
  const { voice, ticker, beat, paid, worker } = setup(t);
  voice.pump(ticker);
  assert.equal(worker.spawned.length, 1);
  assert.equal(worker.spawned[0].options.windowsHide, true);
  assert.equal(worker.spawned[0].options.env.HF_HUB_OFFLINE, '1');
  assert.equal(voice.state, 'starting');

  paid('p1');
  const queued = ticker.snapshot().queue[0];
  assert.ok(VOICE_PERSONAS.some(p => p.id === queued.voice));
  assert.equal(queued.audio, 'pending');
  assert.equal(beat().job, null); // аўдыя яшчэ няма — паказ не пачынаецца

  worker.spawned[0].child.ready();
  await flush();
  assert.equal(voice.state, 'ready');
  voice.pump(ticker);
  await flush();
  const request = worker.spawned[0].child.requests[0];
  assert.equal(request.text, 'Прывітанне ўсім!');
  assert.equal(request.instruct, VOICE_PERSONAS.find(p => p.id === queued.voice).instruct);
  const job = beat().job;
  assert.equal(job.audio, 'ready');
  assert.equal(job.audio_ms, 3200);
  assert.ok(existsSync(voice.file(job.id)));
  assert.equal(beat().voice.volume, 0.8);
});

test('голас: збой сінтэзу — паказ толькі тэкстам; мадэль не загрузілася за 4 хвіліны — таксама', async t => {
  const { voice, ticker, beat, paid, worker, now } = setup(t, fakeWorker({ fail: true }));
  voice.pump(ticker);
  worker.spawned[0].child.ready();
  await flush();
  paid('p1');
  voice.pump(ticker);
  await flush();
  assert.equal(beat().job.audio, 'failed');

  const other = setup(t);
  other.voice.pump(other.ticker);
  other.paid('p2');
  other.now.advance(241_000);
  other.voice.pump(other.ticker);
  assert.equal(other.beat().job.audio, 'failed');
  assert.ok(now);
});

test('голас выключаны — паведамленне без голасу; працэс спынены', async t => {
  const { voice, ticker, beat, paid, worker } = setup(t);
  voice.pump(ticker);
  voice.save({ ...voice.config(), enabled: false });
  await flush();
  assert.equal(voice.state, 'off');
  paid('p1');
  const job = beat().job;
  assert.equal(job.voice, null);
  assert.equal(job.audio, null);
  voice.pump(ticker);
  assert.equal(worker.spawned.length, 1);
});

test('голас: няма python.exe у тэчцы — стан «не знойдзены», без запуску', t => {
  const { voice, ticker, worker } = setup(t);
  voice.save({ ...voice.config(), path: 'C:\\nowhere' });
  voice.pump(ticker);
  assert.equal(voice.state, 'missing');
  assert.equal(worker.spawned.length, 0);
});

test('голас: персанажы не паўтараюцца запар; 25 розных', t => {
  const { voice } = setup(t);
  assert.equal(VOICE_PERSONAS.length, 25);
  assert.equal(new Set(VOICE_PERSONAS.map(p => p.id)).size, 25);
  assert.equal(new Set(VOICE_PERSONAS.map(p => p.name)).size, 25);
  const picks = Array.from({ length: 13 }, () => voice.pick());
  assert.equal(new Set(picks).size, 13);
  // «Хвост» рэха і хуткасць прайгравання падаўжаюць паказ.
  const giant = VOICE_PERSONAS.find(p => p.id === 'giant');
  assert.ok(voiceDurationMs(4000, giant) > 5000);
});

test('голас: узнагарода адкрываецца толькі з загружанай мадэллю', async t => {
  const { s, voice, ticker, beat, worker } = setup(t);
  const twitch = fakeTwitch(), eventsub = fakeEventSub(), bindings = new Bindings(s);
  const reception = new TickerReception({ store: s, ticker, twitch, eventsub, bindings, voice });
  await reception.syncReward();
  reception.setWanted(true);
  beat();
  await reception.tick();
  assert.equal(reception.accepting(), false);
  voice.pump(ticker);
  worker.spawned[0].child.ready();
  await flush();
  beat();
  await reception.tick();
  assert.equal(reception.accepting(), true);
  const reward = [...twitch.rewardMap.values()][0];
  assert.equal(reward.title, 'Паведамленне голасам');
});

test('старая назва ўзнагароды па змаўчанні замяняецца новай, свая назва стрымера — не', t => {
  const { s, ticker } = setup(t);
  s.set('ticker.config', { ...ticker.config(), title: 'Паведамленне на экране', prompt: 'Увядзіце паведамленне: да 500 знакаў' });
  assert.equal(ticker.config().title, 'Паведамленне голасам');
  s.set('ticker.config', { ...ticker.config(), title: 'Скажы нешта' });
  assert.equal(ticker.config().title, 'Скажы нешта');
});

test('голас: прылада і крокі ідуць у працэс; змена прылады перазапускае мадэль', async t => {
  const { voice, ticker, worker } = setup(t);
  voice.pump(ticker);
  assert.equal(worker.spawned[0].options.env.TADEWUSZ_VOICE_DEVICE, 'cuda');
  assert.equal(worker.spawned[0].options.env.TADEWUSZ_VOICE_STEPS, '16');
  worker.spawned[0].child.ready();
  await flush();
  voice.save({ ...voice.config(), device: 'cpu', steps: 32 });
  voice.pump(ticker);
  assert.equal(worker.spawned.length, 2);
  assert.equal(worker.spawned[1].options.env.TADEWUSZ_VOICE_DEVICE, 'cpu');
  assert.equal(worker.spawned[1].options.env.TADEWUSZ_VOICE_STEPS, '32');
  assert.throws(() => voice.save({ ...voice.config(), steps: 20 }), /voice_settings/);
});

test('голас: пасля прастою мадэль спіць, узнагарода адкрытая; паведамленне будзіць мадэль', async t => {
  const { s, voice, ticker, beat, paid, worker, now } = setup(t);
  voice.save({ ...voice.config(), idle: 10 });
  const twitch = fakeTwitch(), eventsub = fakeEventSub();
  const reception = new TickerReception({ store: s, ticker, twitch, eventsub, bindings: new Bindings(s), voice });
  await reception.syncReward();
  reception.setWanted(true);
  voice.pump(ticker);
  worker.spawned[0].child.ready();
  await flush();
  now.advance(10 * 60_000 + 1000);
  voice.pump(ticker);
  assert.equal(voice.state, 'sleeping');
  beat();
  await reception.tick();
  assert.equal(reception.accepting(), true); // сон не закрывае ўзнагароду
  voice.pump(ticker);
  assert.equal(worker.spawned.length, 1); // без паведамленняў не прачынаецца

  paid('p1');
  voice.pump(ticker);
  assert.equal(worker.spawned.length, 2);
  assert.equal(voice.state, 'starting');
  assert.equal(voice.available(), true);
  worker.spawned[1].child.ready();
  await flush();
  voice.pump(ticker);
  await flush();
  assert.equal(beat().job.audio, 'ready');
});
