import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Ticker } from '../core/ticker/ticker.js';
import { clock, store } from './helpers.js';

function setup(t) {
  const now = clock();
  const s = store(t, now);
  const ticker = new Ticker({ store: s, now });
  const client = randomUUID();
  const beat = () => ticker.heartbeat({ client, source: ticker.source, visible: true, obs: true });
  ticker.setReady({ source: true });
  const paid = (id, at = now() - 1000) => ticker.ingest(
    { id, reward: { id: 'tick', cost: 1000 }, status: 'UNFULFILLED', redeemed_at: new Date(at).toISOString(), user_input: 'Прывітанне!', user_name: 'Viewer' },
    `m-${id}`, { account: 'acc', reward: 'tick', admitted: true });
  return { s, now, ticker, client, beat, paid };
}

test('платнае паведамленне: FULFILLED толькі пасля поўнага паказу', t => {
  const { s, now, ticker, client, beat, paid } = setup(t);
  assert.equal(paid('p1').decision, 'queued');
  const job = beat().job;
  assert.equal(job.kind, 'paid');
  const identity = { client, id: job.id, attempt: job.attempt, generation: job.generation };
  assert.deepEqual(ticker.acknowledge({ ...identity, phase: 'layout', duration: 20_000 }), { measured: true });
  assert.deepEqual(ticker.acknowledge({ ...identity, phase: 'complete' }), { ignored: true }); // занадта рана
  now.advance(20_000);
  beat(); // старонка ў OBS шле heartbeat кожныя 250 мс
  assert.deepEqual(ticker.acknowledge({ ...identity, phase: 'complete' }), { completed: true });
  assert.equal(s.db.prepare("SELECT target FROM ticker_outbox WHERE purchase='acc:p1'").get().target, 'FULFILLED');
});

test('стрымер спыніў паказ — балы вяртаюцца; пакупка па-за адкрытым акном адхіляецца', t => {
  const { s, ticker, beat, paid } = setup(t);
  paid('p1');
  const job = beat().job;
  ticker.cancel({ id: job.id, attempt: job.attempt, generation: job.generation });
  assert.equal(s.db.prepare("SELECT target FROM ticker_outbox WHERE purchase='acc:p1'").get().target, 'CANCELED');
  const late = ticker.ingest({ id: 'p2', reward: { id: 'tick', cost: 1000 }, status: 'UNFULFILLED', redeemed_at: new Date(ticker.now()).toISOString(), user_input: 'x', user_name: 'V' },
    'm-p2', { account: 'acc', reward: 'tick', admitted: false });
  assert.equal(late.decision, 'rejected');
});

test('без бачнай крыніцы ў эфіры паказ не пачынаецца', t => {
  const { ticker, beat, paid } = setup(t);
  ticker.setReady({ source: false });
  paid('p1');
  assert.equal(beat().job, null);
});

test('аб’ява пераможцы: зверху спіса і адразу ў чарзе, аўтаматычная аб’ява саступае', t => {
  const { ticker } = setup(t);
  const first = randomUUID();
  ticker.save({ ...ticker.config(), announcements: [{ id: first, text: 'Падпісвайцеся' }] });
  ticker.queue('automatic', 'Падпісвайцеся', { announcement: first });
  const { id } = ticker.announce('Пераможца галасавання — **Stray**');
  const config = ticker.config();
  assert.deepEqual(config.announcements.map(a => a.text), ['Пераможца галасавання — **Stray**', 'Падпісвайцеся']);
  const queue = ticker.snapshot().queue;
  assert.deepEqual(queue.map(j => [j.kind, j.text]), [['manual', 'Пераможца галасавання — **Stray**']]);
  assert.ok(id);
});

test('нябачныя знакі ў тэксце гледача не адхіляюць пакупку — выкідаюцца; пусты тэкст адхіляецца з прычынай у журнале', t => {
  const now = clock(), s = store(t, now), logs = [];
  const ticker = new Ticker({ store: s, now, log: (...args) => logs.push(args) });
  const buy = (id, user_input) => ticker.ingest(
    { id, reward: { id: 'tick', cost: 1000 }, status: 'UNFULFILLED', redeemed_at: new Date(now() - 1000).toISOString(), user_input, user_name: 'Viewer' },
    `m-${id}`, { account: 'acc', reward: 'tick', admitted: true });
  assert.equal(buy('p1', 'Прывітанне​ ўсім \u{E0000}').decision, 'queued');
  assert.equal(s.db.prepare("SELECT text FROM ticker_jobs WHERE purchase='acc:p1'").get().text, 'Прывітанне ўсім');
  assert.equal(buy('p2', 'сям’я 👨‍👩‍👧\tну').decision, 'queued');
  assert.equal(s.db.prepare("SELECT text FROM ticker_jobs WHERE purchase='acc:p2'").get().text, 'сям’я 👨‍👩‍👧 ну');
  assert.equal(buy('p3', ' ⁠​ ').decision, 'rejected');
  assert.deepEqual(logs.at(-1), ['warn', 'ticker.rejected', 'text']);
});

test('платнае паведамленне да 1000 знакаў; даўжэйшае адхіляецца, балы вяртаюцца; падказка ўзнагароды кажа пра ліміт', t => {
  const now = clock(), s = store(t, now);
  const ticker = new Ticker({ store: s, now });
  const buy = (id, user_input) => ticker.ingest(
    { id, reward: { id: 'tick', cost: 1000 }, status: 'UNFULFILLED', redeemed_at: new Date(now() - 1000).toISOString(), user_input, user_name: 'Viewer' },
    `m-${id}`, { account: 'acc', reward: 'tick', admitted: true });
  assert.equal(buy('p1', 'ы'.repeat(1000)).decision, 'queued');
  assert.equal(buy('p2', 'ы'.repeat(1001)).decision, 'rejected');
  assert.equal(s.db.prepare("SELECT target FROM ticker_outbox WHERE purchase='acc:p2'").get().target, 'CANCELED');
  assert.match(ticker.config().prompt, /1000 знакаў/);
  // Ранейшая падказка па змаўчанні замяняецца новай.
  s.set('ticker.config', { ...ticker.config(), prompt: 'Ваш тэкст прагучыць на стрыме выпадковым голасам і з’явіцца ў радку' });
  assert.match(ticker.config().prompt, /1000 знакаў/);
});
