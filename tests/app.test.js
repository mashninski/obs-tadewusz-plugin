import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApp } from '../core/app.js';
import { MemoryVault } from '../core/storage/vault.js';
import { tempDir } from './helpers.js';

async function start(t) {
  const dir = tempDir(), web = join(dir, 'web');
  mkdirSync(web);
  writeFileSync(join(web, 'dock.html'), '<!doctype html><title>dock</title>');
  const app = await createApp({ dataDir: join(dir, 'data'), webRoot: web, port: 0, vault: new MemoryVault(), autoStart: false, backupDirectory: join(dir, 'daily') });
  t.after(() => app.close());
  const page = await fetch(`${app.origin}/`);
  const cookie = page.headers.get('set-cookie').split(';')[0];
  return { app, cookie, origin: app.origin };
}

test('ахова API: cookie для чытання, Origin і загаловак для каманд, дакладны Host', async t => {
  const { origin, cookie } = await start(t);
  assert.equal((await fetch(`${origin}/api/state`)).status, 401);
  assert.equal((await fetch(`${origin}/api/state`, { headers: { cookie } })).status, 200);
  const command = headers => fetch(`${origin}/api/vote/add`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', ...headers }, body: '{"title":"Stray"}' });
  assert.equal((await command({})).status, 403);
  assert.equal((await command({ origin: 'http://evil.example', 'x-tadewusz': '1' })).status, 403);
  assert.equal((await command({ origin, 'x-tadewusz': '1' })).status, 200);
  const { request } = await import('node:http');
  const status = await new Promise(resolve => {
    request(`${origin}/api/state`, { headers: { host: 'attacker.test', cookie } }, res => { res.resume(); resolve(res.statusCode); }).end();
  });
  assert.equal(status, 403);
});

test('стан для дока і оверлея: пазіцыі з кодамі, без сакрэтаў', async t => {
  const { origin, cookie } = await start(t);
  const headers = { cookie, origin, 'x-tadewusz': '1', 'content-type': 'application/json' };
  await fetch(`${origin}/api/vote/add`, { method: 'POST', headers, body: JSON.stringify({ title: 'Doom Eternal' }) });
  const state = await (await fetch(`${origin}/api/state`, { headers: { cookie } })).json();
  assert.equal(state.vote.entries[0].code, 'DET');
  assert.equal(JSON.stringify(state).includes('access_token'), false);
  const overlay = await (await fetch(`${origin}/overlay/state`, { headers: { cookie } })).json();
  assert.deepEqual(Object.keys(overlay.vote.entries[0]).sort(), ['availability', 'code', 'score', 'title']);
});
