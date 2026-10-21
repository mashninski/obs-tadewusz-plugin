import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaults, validateSettings } from '../core/storage/settings.js';
import { Voting } from '../core/voting/voting.js';
import { Bindings, VotingReception } from '../core/voting/reception.js';
import { clock, fakeEventSub, fakeTwitch, store } from './helpers.js';

function setup(t, { replies = true } = {}) {
  const now = clock(Date.now());
  const s = store(t, now);
  s.set('settings', validateSettings({ ...defaults, twitch: { ...defaults.twitch, clientId: 'client', supportCosts: [100, 500] }, replies: { enabled: replies } }));
  const settings = () => validateSettings(s.get('settings', defaults));
  const voting = new Voting({ store: s, now });
  now.advance(10_000);
  const twitch = fakeTwitch(), eventsub = fakeEventSub();
  const reception = new VotingReception({ store: s, voting, twitch, eventsub, settings, bindings: new Bindings(s), now, wait: async () => {} });
  return { s, now, voting, twitch, eventsub, reception };
}

test('узнагароды ствараюцца па наладах; адкрываюцца толькі пасля зверкі і пры ўключаным прыёме', async t => {
  const { reception, twitch, voting } = setup(t);
  await reception.syncRewards();
  assert.deepEqual([...twitch.rewardMap.values()].map(r => [r.title, r.cost]), [['Дадаць гульню ў спіс', 2000], ['100 на гульню са спіса', 100], ['500 на гульню са спіса', 500]]);
  reception.setWanted(true);
  assert.equal(reception.accepting(), false); // зверкі яшчэ не было
  await reception.tick();
  assert.equal(reception.accepting(), true);
  assert.ok([...twitch.rewardMap.values()].every(r => r.is_enabled && !r.is_paused));
  voting.pause(true);
  await reception.tick();
  assert.ok([...twitch.rewardMap.values()].every(r => !r.is_enabled && r.is_paused));
});

test('пакупкі, зробленыя без сувязі, даганяюцца зверкай; статус у Twitch ставіцца з outbox', async t => {
  const { reception, twitch, voting, eventsub, now } = setup(t);
  await reception.syncRewards();
  reception.setWanted(true);
  const entry = voting.add('Stray');
  const support = [...twitch.rewardMap.values()].find(r => r.cost === 500);
  eventsub.set('disconnected');
  const r = twitch.redeem(support.id, entry.code, { at: now() - 1000 });
  eventsub.set('connected');
  await reception.tick();
  assert.equal(voting.entries()[0].score, 500);
  assert.equal(twitch.redemptionMap.get(r.id).status, 'FULFILLED');
  assert.deepEqual(twitch.chatLog, ['@viewer, +500 талераў на Stray']);
});

test('часовы збой Twitch: аперацыя паўтараецца пазней; памылка доступу блакуе да новага ўваходу', async t => {
  const { reception, twitch, voting, now, s } = setup(t);
  await reception.syncRewards();
  const support = [...twitch.rewardMap.values()].find(r => r.cost === 100);
  const r = twitch.redeem(support.id, 'ZZZ', { at: now() - 1000 });
  twitch.failNext = new Error('network_unavailable');
  await reception.tick();
  assert.equal(twitch.redemptionMap.get(r.id).status, 'UNFULFILLED');
  assert.equal(s.db.prepare("SELECT status FROM outbox WHERE kind='cancel'").get().status, 'pending');
  now.advance(10_000);
  await reception.tick();
  assert.equal(twitch.redemptionMap.get(r.id).status, 'CANCELED'); // балы вернуты
  const r2 = twitch.redeem(support.id, 'QQQ', { at: now() - 1000 });
  twitch.failNext = new Error('remote_403');
  now.advance(400_000);
  await reception.tick();
  assert.equal(s.db.prepare("SELECT status FROM outbox WHERE id=?").get(`cancel:client:42:${r2.id}`).status, 'blocked');
  reception.unblockAccess();
  await reception.drain();
  assert.equal(twitch.redemptionMap.get(r2.id).status, 'CANCELED');
  assert.equal(voting.entries().length, 0);
});

test('завяршэнне раўнда: схаваць узнагароды, дагнаць пакупкі да таймера, потым вынік і адказ у чат', async t => {
  const { reception, twitch, voting, now } = setup(t);
  await reception.syncRewards();
  reception.setWanted(true);
  await reception.tick();
  const entry = voting.add('Stray');
  const support = [...twitch.rewardMap.values()].find(r => r.cost === 500);
  voting.startCountdown(10);
  twitch.redeem(support.id, entry.code, { at: now() + 2000 }); // да канца таймера
  now.advance(11_000);
  await reception.tick(); // таймер скончыўся — finalizing
  await reception.tick();
  assert.equal(voting.current().status, 'closed');
  assert.equal(voting.snapshot().result.ranked[0].score, 500);
  assert.ok([...twitch.rewardMap.values()].every(r => r.is_paused));
  await reception.drain();
  assert.ok(!twitch.chatLog.some(m => m.startsWith('Перамагла'))); // чат не апярэджвае экран
  now.advance(10_000);
  await reception.drain();
  assert.ok(twitch.chatLog.includes('Перамагла Stray — 500 талераў'));
});

test('без уваходу ў Twitch раўнд завяршаецца адразу', async t => {
  const { reception, twitch, voting } = setup(t);
  twitch.connected = false;
  voting.add('Stray');
  voting.beginFinalization();
  await reception.tick();
  assert.equal(voting.current().status, 'closed');
});
