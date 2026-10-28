import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApp } from '../core/app.js';
import { outroDefaults, validateOutro } from '../core/outro/outro.js';
import { channelOf, Raid, RAID_CONFIRM_MS } from '../core/raid/raid.js';
import { MemoryVault } from '../core/storage/vault.js';
import { REQUIRED_SCOPES, TWITCH_SCOPES, TwitchClient } from '../core/twitch/client.js';
import { EventSub, RAID_SUBSCRIPTION } from '../core/twitch/eventsub.js';
import { clock, tempDir } from './helpers.js';

const settings = () => ({ twitch: { clientId: 'client' } });
const json = (status, body, headers) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers });

/** Каналы ў эфіры: `n` штук, па `first` на старонку. */
const streams = n => Array.from({ length: n }, (_, i) => ({
  user_id: `u${i}`, user_login: `chan${i}`, user_name: `Chan${i}`, game_name: i % 2 ? 'Minecraft' : '', title: `Стрым ${i}`,
  viewer_count: 100 - i, is_mature: i === 1, thumbnail_url: `https://static-cdn.jtvnw.net/previews-ttv/live_user_chan${i}-{width}x{height}.jpg`,
}));

/** id.twitch.tv і Helix у памяці: правы токена, падпіскі, рэйды і памылкі на патрабаванне. */
function fakeHelix({ scopes = TWITCH_SCOPES, live = streams(5), pageSize = 2 } = {}) {
  const server = { calls: [], scopes, live, raid: null, fail: {} };
  server.fetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method ?? 'GET';
    server.calls.push(`${method} ${u.pathname}${u.search}`);
    if (u.pathname === '/oauth2/validate') return json(200, { client_id: 'client', user_id: '42', login: 'streamer', scopes: server.scopes });
    const failure = server.fail[`${method} ${u.pathname}`];
    if (failure) return json(failure, { message: 'nope' }, failure === 429 ? { 'Ratelimit-Reset': String(Math.floor(Date.now() / 1000) + 30) } : undefined);
    if (u.pathname === '/helix/streams/followed') {
      const offset = Number(u.searchParams.get('after') ?? 0);
      // Пакуль ідзе пагінацыя, парадак мяняецца — апошні канал старонкі паўтараецца на наступнай.
      const start = offset ? offset - 1 : 0;
      const page = server.live.slice(start, offset + pageSize);
      const next = offset + pageSize;
      return json(200, { data: page, pagination: next < server.live.length ? { cursor: String(next) } : {} });
    }
    if (u.pathname === '/helix/users') {
      return json(200, { data: u.searchParams.getAll('id').map(id => ({ id, profile_image_url: id === 'u2' ? 'http://insecure/a.png' : `https://static-cdn.jtvnw.net/${id}.png` })) });
    }
    if (u.pathname === '/helix/raids' && method === 'POST') {
      server.raid = u.searchParams.get('to_broadcaster_id');
      return json(200, { data: [{ created_at: new Date().toISOString(), is_mature: false }] });
    }
    if (u.pathname === '/helix/raids' && method === 'DELETE') {
      if (!server.raid) return json(404, { message: "The broadcaster doesn't have a pending raid to cancel" });
      server.raid = null;
      return json(204);
    }
    if (u.pathname === '/helix/eventsub/subscriptions') return json(202, { data: [{}] });
    return json(404, {});
  };
  return server;
}

const client = server => new TwitchClient({
  vault: new MemoryVault({ twitch: { access_token: 'a', refresh_token: 'r', clientId: 'client' } }), settings, fetchImpl: server.fetch,
});

// ---------- Twitch ----------

test('Twitch: стары ўваход без правоў рэйду працуе, але правоў для рэйду не хапае', async () => {
  const server = fakeHelix({ scopes: REQUIRED_SCOPES });
  const twitch = client(server);
  await twitch.credentials();
  assert.equal(twitch.connected, true);
  assert.deepEqual(twitch.missingScopes(), ['channel:manage:raids', 'user:read:follows']);
  const raid = new Raid({ twitch });
  assert.equal(raid.snapshot().access, 'raid_scopes');
  const list = await raid.channels();
  assert.equal(list.error, 'raid_scopes');
  await assert.rejects(raid.start('u1'), /raid_scopes/);
  assert.ok(!server.calls.some(c => c.includes('/helix/raids')), 'да Twitch рэйд не пайшоў');
  // Новы ўваход просіць і правы рэйду.
  assert.ok(TWITCH_SCOPES.includes('channel:manage:raids') && TWITCH_SCOPES.includes('user:read:follows'));
});

test('Twitch: каналы ў эфіры — усе старонкі без дублікатаў, аватары, свой канал не ў спісе', async () => {
  const server = fakeHelix({ live: [...streams(5), { ...streams(1)[0], user_id: '42', user_login: 'streamer' }] });
  const twitch = client(server);
  await twitch.credentials();
  const raid = new Raid({ twitch });
  const { channels, error } = await raid.channels();
  assert.equal(error, null);
  assert.deepEqual(channels.map(c => c.id), ['u0', 'u1', 'u2', 'u3', 'u4']);
  const pages = server.calls.filter(c => c.startsWith('GET /helix/streams/followed'));
  assert.equal(pages.length, 3);
  assert.ok(pages[0].includes('user_id=42') && pages[0].includes('first=100'));
  assert.ok(pages[1].includes('after=2'));
  assert.equal(server.calls.filter(c => c.startsWith('GET /helix/users')).length, 1);
  const u1 = channels[1];
  assert.equal(u1.avatar, 'https://static-cdn.jtvnw.net/u1.png');
  assert.equal(u1.mature, true);
  assert.equal(u1.game, 'Minecraft');
  assert.equal(u1.thumbnail, 'https://static-cdn.jtvnw.net/previews-ttv/live_user_chan1-640x360.jpg');
  assert.equal(channels[2].avatar, '', 'адрас без https не трапляе на экран');
  // Адразу паўторна — без новых запытаў; кнопка «Абнавіць» — новы запыт.
  await raid.channels();
  assert.equal(server.calls.filter(c => c.startsWith('GET /helix/streams/followed')).length, 3);
  await raid.channels({ force: true });
  assert.equal(server.calls.filter(c => c.startsWith('GET /helix/streams/followed')).length, 6);
});

test('Twitch: профілі запытваюцца па 100 ID', async () => {
  const server = fakeHelix();
  const twitch = client(server);
  await twitch.credentials();
  const users = await twitch.users(Array.from({ length: 150 }, (_, i) => `id${i}`));
  assert.equal(users.length, 150);
  assert.equal(server.calls.filter(c => c.startsWith('GET /helix/users')).length, 2);
});

test('рэйд: пачатак, дэдлайн ад адказу Twitch, адмена', async () => {
  const now = clock();
  const server = fakeHelix();
  const twitch = client(server);
  await twitch.credentials();
  let countdown = 10;
  const raid = new Raid({ twitch, now, countdown: () => countdown });
  await raid.channels();
  await assert.rejects(raid.start('nobody'), /raid_target/);
  const started = await raid.start('u3');
  assert.ok(server.calls.includes('POST /helix/raids?from_broadcaster_id=42&to_broadcaster_id=u3'));
  assert.equal(started.current.phase, 'pending');
  assert.equal(started.current.deadline, now() + 10_000);
  assert.equal(started.serverNow, now());
  const view = raid.view();
  assert.equal(view.target.name, 'Chan3');
  assert.equal(view.deadline - view.startedAt, 10_000);
  await assert.rejects(raid.start('u1'), /raid_in_progress/);
  // Адмена — DELETE; экран вяртаецца да кліпаў.
  const cancelled = await raid.cancel();
  assert.ok(server.calls.includes('DELETE /helix/raids?broadcaster_id=42'));
  assert.equal(cancelled.current.phase, 'cancelled');
  assert.equal(raid.view(), null);
  // Даўжыня адліку — з налады аўтра.
  countdown = 25;
  now.advance(60_000);
  const second = await raid.start('u1');
  assert.equal(second.current.deadline - second.current.startedAt, 25_000);
  // Рэйд адменены ў чаце Twitch (падзеі на гэта няма): «Адмяніць» атрымлівае 404 — стан закрываецца,
  // і можна пачаць новы рэйд (раней док заставаўся ў «рэйд ідзе», водгук аўтара 2026-10-28).
  server.raid = null;
  const gone = await raid.cancel();
  assert.equal(gone.gone, true);
  assert.equal(gone.current.phase, 'cancelled');
  assert.equal(raid.view(), null);
  await raid.start('u2');
  assert.equal(raid.current.phase, 'pending');
  await raid.cancel();
  await assert.rejects(raid.cancel(), /raid_not_pending/, 'нічога не ідзе — адмяняць няма чаго');
});

test('рэйд: channel.raid → «адбыўся»; без падзеі 100 с → «не пацверджаны»', async () => {
  const now = clock();
  const twitch = client(fakeHelix());
  await twitch.credentials();
  const raid = new Raid({ twitch, now });
  await raid.channels();
  await raid.start('u0');
  // Рэйд НА наш канал — не наш вынік.
  assert.equal(raid.onEvent('channel.raid', { from_broadcaster_user_id: '7', to_broadcaster_user_id: '42', viewers: 3 }), true);
  assert.equal(raid.current.phase, 'pending');
  assert.equal(raid.onEvent('channel.channel_points_custom_reward_redemption.add', {}), false);
  now.advance(15_000);
  raid.onEvent('channel.raid', { from_broadcaster_user_id: '42', to_broadcaster_user_id: 'u0', to_broadcaster_user_login: 'chan0', viewers: 57 });
  assert.equal(raid.current.phase, 'done');
  assert.equal(raid.current.viewers, 57);
  assert.ok(raid.view(), 'экран трымае картку і 0');
  raid.reset();
  assert.equal(raid.view(), null);

  await raid.start('u1');
  now.advance(RAID_CONFIRM_MS - 1);
  raid.tick();
  assert.equal(raid.current.phase, 'pending');
  now.advance(1);
  raid.tick();
  assert.equal(raid.current.phase, 'unconfirmed');
  // Позняя падзея ўсё роўна пацвярджае рэйд.
  raid.onEvent('channel.raid', { from_broadcaster_user_id: '42', to_broadcaster_user_id: 'u1', viewers: 9 });
  assert.equal(raid.current.phase, 'done');
});

test('рэйд: 429 і іншыя адмовы Twitch — зразумелыя коды, рэйд не пачаты', async () => {
  const server = fakeHelix();
  const twitch = client(server);
  await twitch.credentials();
  const raid = new Raid({ twitch });
  await raid.channels();
  for (const [status, code] of [[429, 'raid_rate_limit'], [400, 'raid_refused'], [409, 'raid_conflict'], [404, 'raid_channel_missing']]) {
    server.fail['POST /helix/raids'] = status;
    await assert.rejects(raid.start('u2'), new RegExp(code));
    assert.equal(raid.current.phase, 'failed');
    assert.equal(raid.current.error, code);
    assert.equal(raid.view(), null, 'на экране рэйду няма');
  }
  server.fail['POST /helix/raids'] = 0;
  await raid.start('u2');
  server.fail['DELETE /helix/raids'] = 429;
  await assert.rejects(raid.cancel(), /raid_rate_limit/);
  assert.equal(raid.current.phase, 'pending');
});

test('рэйд: канал для экрана — без кіруючых знакаў, ліміты даўжыні', () => {
  const c = channelOf({ user_id: 5, user_login: 'x', user_name: 'Імя‮', title: 'a'.repeat(500), viewer_count: 'шмат', thumbnail_url: 'javascript:alert(1)' }, null);
  assert.equal(c.name, 'Імя');
  assert.equal(c.title.length, 200);
  assert.equal(c.viewers, 0);
  assert.equal(c.thumbnail, '');
  assert.equal(c.avatar, '');
});

// ---------- EventSub ----------

class FakeSocket extends EventTarget {
  static last = null;
  constructor(url) { super(); this.url = url; FakeSocket.last = this; }
  send() {}
  close() { this.dispatchEvent(new Event('close')); }
  push(packet) { const e = new Event('message'); e.data = JSON.stringify(packet); this.dispatchEvent(e); }
}

test('EventSub: падпіска на channel.raid ад нашага канала і падзея даходзіць', async () => {
  const subscriptions = [];
  const twitch = {
    identity: { userId: '42' },
    async credentials() {},
    async api(path, { body }) { subscriptions.push(body); return {}; },
  };
  const eventsub = new EventSub({ twitch, Socket: FakeSocket, schedule: () => null, unschedule: () => {} });
  const events = [];
  eventsub.onEvent((type, event) => events.push([type, event]));
  eventsub.start();
  const socket = FakeSocket.last;
  socket.push({ metadata: { message_id: 'm1', message_type: 'session_welcome' }, payload: { session: { id: 's1', keepalive_timeout_seconds: 10 } } });
  await new Promise(resolve => setImmediate(resolve));
  const raidSub = subscriptions.find(s => s.type === RAID_SUBSCRIPTION);
  assert.deepEqual(raidSub.condition, { from_broadcaster_user_id: '42' });
  assert.equal(eventsub.state, 'connected');
  socket.push({ metadata: { message_id: 'm2', message_type: 'notification' },
    payload: { subscription: { type: 'channel.raid', condition: { from_broadcaster_user_id: '42', to_broadcaster_user_id: '' } }, event: { from_broadcaster_user_id: '42', to_broadcaster_user_id: '7', viewers: 5 } } });
  // Чужы рэйд (іншая падпіска) не даходзіць.
  socket.push({ metadata: { message_id: 'm3', message_type: 'notification' },
    payload: { subscription: { type: 'channel.raid', condition: { from_broadcaster_user_id: '99' } }, event: {} } });
  assert.deepEqual(events.map(e => e[0]), ['channel.raid']);
  eventsub.stop();
});

test('EventSub: падпіска на рэйд не ўдалася — узнагароды ўсё роўна працуюць', async () => {
  const twitch = {
    identity: { userId: '42' },
    async credentials() {},
    async api(path, { body }) { if (body.type === RAID_SUBSCRIPTION) throw new Error('remote_403'); return {}; },
  };
  const warnings = [];
  const eventsub = new EventSub({ twitch, Socket: FakeSocket, schedule: () => null, unschedule: () => {}, log: (level, event) => warnings.push(event) });
  eventsub.start();
  FakeSocket.last.push({ metadata: { message_id: 'w1', message_type: 'session_welcome' }, payload: { session: { id: 's1', keepalive_timeout_seconds: 10 } } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(eventsub.state, 'connected');
  assert.ok(warnings.includes('eventsub.raid_subscribe_failed'));
  eventsub.stop();
});

// ---------- Аўтра ----------

test('налады аўтра: прадвызначаныя і праверка палёў', () => {
  assert.equal(validateOutro({}).text, 'Хутка сустрэнемся!');
  assert.equal(validateOutro({}).raidCountdown, 10);
  assert.throws(() => validateOutro({ text: '' }), /outro_text/);
  assert.throws(() => validateOutro({ text: 'x'.repeat(81) }), /outro_text/);
  assert.throws(() => validateOutro({ raidCountdown: 2 }), /outro_raid_countdown/);
  assert.throws(() => validateOutro({ raidCountdown: 61 }), /outro_raid_countdown/);
  assert.throws(() => validateOutro({ links: [{ id: 'a', url: 'a b' }] }), /outro_link/);
  assert.equal(validateOutro({ ...outroDefaults, raidCountdown: 3 }).raidCountdown, 3);
});

test('API аўтра: спасылкі з інтро па змаўчанні, свае — асобна; стан рэйду ў доку', async t => {
  const dir = tempDir(), web = join(dir, 'web');
  mkdirSync(web);
  writeFileSync(join(web, 'intro.html'), '<!doctype html><title>intro</title>');
  const app = await createApp({ dataDir: join(dir, 'data'), webRoot: web, port: 0, vault: new MemoryVault(), autoStart: false, backupDirectory: join(dir, 'daily') });
  t.after(() => app.close());
  const page = await fetch(`${app.origin}/intro?mode=outro`);
  const cookie = page.headers.get('set-cookie').split(';')[0];
  const origin = app.origin;
  const headers = { cookie, origin, 'x-tadewusz': '1', 'content-type': 'application/json' };
  const post = (path, body = {}) => fetch(`${origin}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const get = async path => (await fetch(`${origin}${path}`, { headers: { cookie } })).json();

  const introLinks = [{ id: 'a1', url: 'twitch.tv/mashninski', label: 'Twitch', qr: true }];
  const intro = (await get('/intro/state')).config;
  assert.equal((await post('/api/intro/config', { ...intro, links: introLinks })).status, 200);
  let outro = await get('/outro/state');
  assert.equal(outro.config.text, 'Хутка сустрэнемся!');
  assert.deepEqual(outro.config.links, introLinks, 'па змаўчанні — спасылкі інтро');
  assert.equal(outro.raid, null);
  assert.equal(outro.clips, undefined, 'у аўтра кліпаў няма');
  assert.ok(Math.abs(outro.serverNow - Date.now()) < 5000);

  const own = [{ id: 'b1', url: 'mashninski.com', label: '', qr: false }];
  assert.equal((await post('/api/outro/config', { ...outroDefaults, text: 'Да сустрэчы', ownLinks: true, links: own })).status, 200);
  outro = await get('/outro/state');
  assert.equal(outro.config.text, 'Да сустрэчы');
  assert.deepEqual(outro.config.links, own);
  assert.deepEqual((await get('/intro/state')).config.links, introLinks, 'інтро не змянілася');
  assert.deepEqual(await (await post('/api/outro/config', { ...outroDefaults, raidCountdown: 1 })).json(), { error: 'outro_raid_countdown' });

  const state = await get('/api/state');
  assert.equal(state.outro.config.text, 'Да сустрэчы');
  assert.equal(state.raid.access, 'twitch_connect_required');
  assert.deepEqual(await (await post('/api/raid/start', { id: 'u1' })).json(), { error: 'twitch_connect_required' });
  assert.deepEqual(await (await post('/api/outro/scene')).json(), { error: 'obs_required' });
});
