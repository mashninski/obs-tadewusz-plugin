import assert from 'node:assert/strict';
import { test } from 'node:test';
import { carryPlan, Voting } from '../core/voting/voting.js';
import { allocateCode } from '../core/voting/codes.js';
import { clock, store } from './helpers.js';

function setup(t) {
  const now = clock();
  const s = store(t, now);
  const events = [];
  const voting = new Voting({ store: s, now, notify: e => events.push(e) });
  now.advance(10_000); // раўнд адкрыты раней за пакупкі
  return { s, now, voting, events, db: s.db };
}

const ledgerMatches = db => db.prepare('SELECT count(*) n FROM entries e WHERE score != (SELECT coalesce(sum(delta),0) FROM ledger l WHERE l.entry_id=e.id)').get().n === 0;

function purchase(now, { id = 'r1', input, cost = 500, reward = 'support-reward', at = now() - 1000, status = 'UNFULFILLED' }) {
  return { id, reward: { id: reward, cost }, user_input: input, user_login: 'viewer', user_name: 'Viewer', redeemed_at: new Date(at).toISOString(), status };
}

test('трохлітарныя коды: з першых літар, кірыліца транслітэруецца, паўтор не выдаецца', () => {
  assert.equal(allocateCode('Doom Eternal', 'a', new Set()), 'DET');
  assert.equal(allocateCode('Сталкер', 'b', new Set()), 'STA');
  assert.notEqual(allocateCode('Doom Eternal', 'c', new Set(['DET', 'DOO', 'DOM'])), 'DET');
});

test('падтрымка па кодзе дадае балы і ставіць FULFILLED у outbox; паўтор не мяняе балы', t => {
  const { voting, now, db } = setup(t);
  const entry = voting.add('Stray');
  const result = voting.receive(purchase(now, { input: entry.code }), { account: 'acc', role: 'support' });
  assert.equal(result.decision, 'accepted_support');
  assert.equal(voting.entries()[0].score, 500);
  assert.ok(db.prepare("SELECT 1 FROM outbox WHERE id='fulfill:acc:r1'").get());
  const repeat = voting.receive(purchase(now, { input: entry.code }), { account: 'acc', role: 'support', messageId: 'other' });
  assert.equal(repeat.duplicate, true);
  assert.equal(voting.entries()[0].score, 500);
  assert.ok(ledgerMatches(db));
});

test('невядомы код — пакупка адхілена і ідзе вяртанне балаў', t => {
  const { voting, now, db } = setup(t);
  voting.add('Stray');
  const result = voting.receive(purchase(now, { input: 'ZZZ' }), { account: 'acc', role: 'support' });
  assert.equal(result.decision, 'entry_missing');
  assert.ok(db.prepare("SELECT 1 FROM outbox WHERE id='cancel:acc:r1' AND status='pending'").get());
});

test('дадаванне чакае першай падтрымкі: тады яго нельга вярнуць (FULFILLED)', t => {
  const { voting, now, db } = setup(t);
  const added = voting.receive(purchase(now, { id: 'a1', input: 'Portal', cost: 2000, reward: 'add-reward' }), { account: 'acc', role: 'add' });
  assert.equal(added.decision, 'accepted_add');
  assert.equal(db.prepare("SELECT count(*) n FROM outbox WHERE id='fulfill:acc:a1'").get().n, 0);
  const code = voting.entries()[0].code;
  voting.receive(purchase(now, { id: 's1', input: code }), { account: 'acc', role: 'support' });
  assert.ok(db.prepare("SELECT 1 FROM outbox WHERE id='fulfill:acc:a1'").get());
});

test('пакупка падчас паўзы і пасля таймера не налічваецца', t => {
  const { voting, now } = setup(t);
  const entry = voting.add('Stray');
  voting.pause(true);
  now.advance(5000);
  assert.equal(voting.receive(purchase(now, { id: 'p', input: entry.code }), { account: 'acc', role: 'support' }).decision, 'paused_at_purchase');
  voting.pause(false);
  voting.startCountdown(10);
  now.advance(11_000);
  assert.equal(voting.receive(purchase(now, { id: 'late', input: entry.code, at: now() - 100 }), { account: 'acc', role: 'support' }).decision, 'between_rounds');
});

test('перанос балаў і выдаленне: балы не губляюцца без пацверджання, ledger сыходзіцца', t => {
  const { voting, db } = setup(t);
  const a = voting.add('Fear & Hunger'), b = voting.add('Fear & Hunger 2');
  voting.edit(a.id, 2000);
  assert.deepEqual(voting.move(a.id, b.id), { moved: 2000 });
  assert.equal(voting.entries().find(e => e.id === b.id).score, 2000);
  voting.remove(a.id);
  assert.throws(() => voting.remove(b.id), /entry_has_points/);
  voting.remove(b.id, { burn: true });
  assert.equal(voting.entries().length, 0);
  assert.ok(ledgerMatches(db));
});

test('правіла пераносу: 1/5 пераможцу, 2/3 месцам 2–6, выбывае floor((N−1)/5) знізу', () => {
  const ranked = n => Array.from({ length: n }, (_, i) => ({ id: `e${i}`, score: (n - i) * 300 }));
  const removed = n => carryPlan(ranked(n)).filter(s => s.removed).length;
  assert.deepEqual([1, 5, 6, 10, 11, 15, 16, 20, 21, 25, 26, 30].map(removed), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  const plan = carryPlan(ranked(8));
  assert.equal(plan[0].after, Math.floor(2400 / 5));
  assert.equal(plan[1].after, Math.floor(2100 * 2 / 3));
  assert.equal(plan[5].after, Math.floor(900 * 2 / 3));
  assert.equal(plan[6].after, 600);
  assert.equal(plan[7].removed, true);
});

test('завяршэнне і новы раўнд: перанос прымяняецца адзін раз і ў ledger', t => {
  const { voting, db, now } = setup(t);
  const titles = ['A', 'B', 'C', 'D', 'E', 'F'];
  titles.forEach((title, i) => voting.edit(voting.add(title).id, (6 - i) * 1000));
  voting.beginFinalization();
  const result = voting.close();
  assert.equal(result.carryPolicy, 'pending');
  assert.throws(() => voting.edit(voting.entries()[0].id, 1), /round_closed/);
  now.advance(1000);
  voting.openNext();
  const scores = Object.fromEntries(voting.entries().map(e => [e.title, e.score]));
  assert.deepEqual(scores, { A: 1200, B: 3333, C: 2666, D: 2000, E: 1333 });
  assert.equal(voting.current().status, 'open');
  assert.ok(ledgerMatches(db));
  assert.equal(db.prepare("SELECT count(*) n FROM ledger WHERE reason='cleanup'").get().n, 1);
});

test('знешняе скасаванне прынятай падтрымкі патрабуе разбору перад завяршэннем', t => {
  const { voting, now } = setup(t);
  const entry = voting.add('Stray');
  voting.receive(purchase(now, { input: entry.code }), { account: 'acc', role: 'support' });
  voting.receive(purchase(now, { input: entry.code, status: 'CANCELED' }), { account: 'acc', role: 'support' });
  assert.equal(voting.reviews().length, 1);
  assert.throws(() => voting.beginFinalization(), /external_cancel_review/);
  voting.resolveReview(voting.reviews()[0].id);
  assert.equal(voting.reviews().length, 0);
});
