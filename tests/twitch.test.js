import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TwitchClient } from '../core/twitch/client.js';
import { MemoryVault } from '../core/storage/vault.js';
import { MusicBridge } from '../core/music/bridge.js';

const settings = () => ({ twitch: { clientId: 'client' } });
const json = (status, body) => new Response(JSON.stringify(body), { status });

/** id.twitch.tv і Helix у памяці: refresh token аднаразовы, як у Public-прыкладання. */
function fakeTwitchServer() {
  const server = { access: 'a1', refresh: 'r1', counter: 1, calls: [] };
  server.fetch = async (url, init = {}) => {
    const u = new URL(url);
    server.calls.push(`${init.method ?? 'GET'} ${u.pathname}`);
    if (u.pathname === '/oauth2/validate') {
      return init.headers.Authorization === `OAuth ${server.access}`
        ? json(200, { client_id: 'client', user_id: '42', login: 'streamer', scopes: ['channel:manage:redemptions', 'user:write:chat'] })
        : json(401, { message: 'invalid access token' });
    }
    if (u.pathname === '/oauth2/token') {
      const form = new URLSearchParams(String(init.body));
      if (form.get('refresh_token') !== server.refresh) return json(400, { message: 'Invalid refresh token' });
      server.counter++;
      server.access = `a${server.counter}`;
      server.refresh = `r${server.counter}`;
      return json(200, { access_token: server.access, refresh_token: server.refresh, scope: [] });
    }
    if (init.headers?.Authorization !== `Bearer ${server.access}`) return json(401, { message: 'Invalid OAuth token' });
    return json(200, { data: [{ id: 'reward', cost: 1 }] });
  };
  return server;
}

test('access token скончыўся: адно абнаўленне, новыя токены адразу ў памяці і ў сховішчы', async () => {
  const server = fakeTwitchServer();
  const vault = new MemoryVault({ twitch: { access_token: 'old', refresh_token: 'r1', clientId: 'client' } });
  const twitch = new TwitchClient({ vault, settings, fetchImpl: server.fetch });
  const [a, b] = await Promise.all([twitch.credentials(), twitch.credentials()]);
  assert.equal(a.access_token, 'a2');
  assert.equal(b.access_token, 'a2');
  assert.equal(server.calls.filter(c => c === 'POST /oauth2/token').length, 1);
  assert.equal((await vault.get('twitch')).refresh_token, 'r2');
  assert.equal(twitch.account(), 'client:42');
});

test('Twitch адклікаў refresh token — уваход выдалены і праграма просіць увайсці зноў', async () => {
  const server = fakeTwitchServer();
  const vault = new MemoryVault({ twitch: { access_token: 'old', refresh_token: 'revoked', clientId: 'client' } });
  const twitch = new TwitchClient({ vault, settings, fetchImpl: server.fetch });
  await assert.rejects(twitch.credentials(), /twitch_connect_required/);
  assert.equal(await vault.get('twitch'), null);
  assert.deepEqual(twitch.status, { state: 'disconnected', error: 'login_expired' });
});

test('збой сеткі або сховішча — не выхад з Twitch: токены застаюцца', async () => {
  const vault = new MemoryVault({ twitch: { access_token: 'a1', refresh_token: 'r1', clientId: 'client' } });
  const twitch = new TwitchClient({ vault, settings, fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(twitch.credentials(), /network_unavailable/);
  assert.equal(twitch.status.state, 'error');
  assert.ok(await vault.get('twitch'));
  const broken = new TwitchClient({ vault: { get: async () => { throw new Error('vault_timeout'); } }, settings, fetchImpl: fakeTwitchServer().fetch });
  await assert.rejects(broken.credentials(), /vault_timeout/);
  assert.equal(broken.status.state, 'error');
});

test('музыка не можа кіраваць узнагародамі галасавання і бягучага радка', async () => {
  const sent = [];
  const twitch = { connected: true, raw: async (method, path) => { sent.push(`${method} ${path}`); return { status: 200, body: { data: [] } }; } };
  const eventsub = { state: 'connected', onEvent() {}, onState() {} };
  const bridge = new MusicBridge({ twitch, eventsub, ownedRewardIds: () => ['vote-1', 'ticker-1'], obsSettings: async () => ({}) });
  await assert.rejects(bridge.helix({ method: 'PATCH', path: '/channel_points/custom_rewards?broadcaster_id=42&id=vote-1', body: {} }), /music_reward_owned/);
  await assert.rejects(bridge.helix({ method: 'GET', path: '/channel_points/custom_rewards/redemptions?broadcaster_id=42&reward_id=ticker-1' }), /music_reward_owned/);
  await assert.rejects(bridge.helix({ method: 'GET', path: '/users' }), /music_route/);
  await bridge.helix({ method: 'PATCH', path: '/channel_points/custom_rewards?broadcaster_id=42&id=song', body: { is_paused: true } });
  await bridge.helix({ method: 'GET', path: '/channel_points/custom_rewards?broadcaster_id=42&only_manageable_rewards=true' });
  assert.deepEqual(sent, ['PATCH channel_points/custom_rewards?broadcaster_id=42&id=song', 'GET channel_points/custom_rewards?broadcaster_id=42&only_manageable_rewards=true']);
});
