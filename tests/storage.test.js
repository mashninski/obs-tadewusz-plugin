import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { Store } from '../core/storage/database.js';
import { Backups } from '../core/storage/backups.js';
import { WindowsVault } from '../core/storage/vault.js';
import { clock, tempDir } from './helpers.js';

/** База ў стане старой праграмы (OBS Bot 0.2.51, схема 5) з тымі ж службовымі ключамі. */
function legacyDatabase(path) {
  const legacy = new Store(path);
  legacy.db.exec('PRAGMA user_version=5');
  legacy.db.exec(`DELETE FROM settings`);
  const set = (k, v) => legacy.db.prepare('INSERT INTO settings VALUES (?,?)').run(k, JSON.stringify(v));
  set('prototype.rewardBindings', { 'c:1': { add: 'a', support_0: 's0', ticker: 't' } });
  set('working.reception', { version: 1, account: 'c:1', roundId: 'r', rewardIds: ['a', 's0'] });
  set('ticker.reception', null);
  set('voting.policy', { version: 2 });
  set('lifecycle.clean', true);
  set('round.transport:r', { version: 1, mode: 'twitch' });
  set('test.remote', {});
  legacy.db.exec("INSERT INTO rounds VALUES ('r', 1, NULL, 'open', NULL)");
  legacy.db.exec("INSERT INTO entries VALUES ('e', 'Stray', 'stray', 700, 1, 1, '{}')");
  legacy.db.exec("INSERT INTO ledger(at,round_id,entry_id,delta,reason) VALUES (1,'r','e',700,'support')");
  legacy.close();
}

test('міграцыя v5 → v8: копія перад зменай, фінансавыя даныя без змен, службовыя ключы спрошчаны', t => {
  const dir = tempDir(), path = join(dir, 'obs-bot.sqlite');
  legacyDatabase(path);
  const s = new Store(path);
  t.after(() => s.close());
  assert.equal(s.version(), 8);
  assert.ok(readdirSync(dir).some(n => n.startsWith('obs-bot.sqlite.before-v8-')));
  assert.deepEqual(s.get('twitch.rewardBindings'), { 'c:1': { add: 'a', support_0: 's0', ticker: 't' } });
  assert.deepEqual(s.get('reception'), { voting: true, ticker: false });
  for (const key of ['prototype.rewardBindings', 'working.reception', 'voting.policy', 'lifecycle.clean', 'round.transport:r', 'test.remote'])
    assert.equal(s.get(key, 'gone'), 'gone', key);
  assert.equal(s.db.prepare("SELECT score FROM entries WHERE id='e'").get().score, 700);
});

test('база навейшай версіі не адкрываецца старой праграмай', t => {
  const path = join(tempDir(), 'obs-bot.sqlite');
  const db = new DatabaseSync(path);
  db.exec('PRAGMA user_version=99');
  db.close();
  assert.throws(() => new Store(path), /database_newer_than_app/);
});

test('рэзервовыя копіі: адна дзённая на дзень, бягучыя — толькі пасля змен, старыя выдаляюцца', t => {
  const dir = tempDir(), now = clock(Date.UTC(2026, 9, 21, 10));
  const s = new Store(join(dir, 'obs-bot.sqlite'), { now });
  t.after(() => s.close());
  const external = join(dir, 'daily');
  const backups = new Backups(s, { dataDir: dir, external: () => external, now, recentKeep: 2, dailyKeep: 2 });
  backups.checkpoint();
  for (let i = 0; i < 5; i++) { now.advance(1000); backups.tick(); }
  assert.equal(readdirSync(external).length, 1);
  assert.equal(readdirSync(join(dir, 'backups')).length, 1);
  backups.touch();
  now.advance(600_000);
  backups.tick();
  assert.equal(readdirSync(join(dir, 'backups')).length, 2);
  for (let day = 0; day < 3; day++) { now.advance(86_400_000); backups.tick(); }
  assert.equal(readdirSync(external).length, 2);
  const copy = new DatabaseSync(join(external, readdirSync(external)[0]), { readOnly: true });
  assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  copy.close();
});

test('сховішча сакрэтаў: часовыя збоі памочніка паўтараюцца, сакрэты чытаюцца адзін раз', async t => {
  const dir = tempDir();
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(dir, 'secrets.dpapi.json'), 'cipher');
  let reads = 0, writes = 0, fail = 2;
  const helper = async (_path, request) => {
    if (request.action === 'read') { reads++; if (fail-- > 0) throw new Error('vault_exit_1'); return { twitch: { access_token: 'a' } }; }
    writes++;
    return null;
  };
  const vault = new WindowsVault(dir, { helper, wait: async () => {} });
  assert.deepEqual(await vault.get('twitch'), { access_token: 'a' });
  assert.deepEqual(await vault.get('twitch'), { access_token: 'a' });
  assert.equal(reads, 3);
  await vault.set('obsPassword', 'x');
  assert.equal(writes, 1);
  assert.equal(await vault.get('obsPassword'), 'x');
});

test('міграцыя v6 → v8: назвы гульняў у адказах чата без двукоссяў', t => {
  const dir = tempDir(), path = join(dir, 'obs-bot.sqlite');
  const old = new Store(path);
  old.set('settings', { replies: { enabled: true, templates: { winner: 'Перамагла «{title}» — {score} талераў', accepted_add: 'гульня "{title}" дададзена', entry_missing: 'не знойдзена' } }, obs: { url: 'ws://127.0.0.1:4455' } });
  old.db.exec("INSERT INTO entries VALUES ('e', 'Stray', 'stray', 700, 1, 1, '{}')");
  old.db.exec('PRAGMA user_version=6');
  old.close();
  const s = new Store(path);
  t.after(() => s.close());
  assert.equal(s.version(), 8);
  const settings = s.get('settings');
  assert.deepEqual(settings.replies.templates, { winner: 'Перамагла {title} — {score} талераў', accepted_add: 'гульня {title} дададзена', entry_missing: 'не знойдзена' });
  assert.equal(settings.obs.url, 'ws://127.0.0.1:4455');
  assert.equal(s.db.prepare("SELECT score FROM entries WHERE id='e'").get().score, 700);
});
