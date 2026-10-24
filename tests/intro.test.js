import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApp } from '../core/app.js';
import { fetchAllClips, Intro, introDefaults, validateIntro } from '../core/intro/intro.js';
import { ensureIntroScene, INTRO_INPUT, INTRO_SCENE } from '../core/obs/intro-scene.js';
import { MemoryVault } from '../core/storage/vault.js';
import { ClipDeck } from '../web/src/intro/deck.js';
import { clock, store, tempDir } from './helpers.js';

/** Прадказальны выпадковы лік (каб перамешванне ў тэстах было аднолькавым). */
function seeded(seed = 42) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

const clipList = n => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, title: `Кліп ${i}`, duration: 20 }));

// ---------- Калода ----------

test('калода: усе кліпы без паўтораў, потым — новае перамешванне', () => {
  const deck = new ClipDeck({ random: seeded() });
  deck.update(clipList(12));
  for (let cycle = 0; cycle < 5; cycle++) {
    const seen = new Set();
    for (let i = 0; i < 12; i++) seen.add(deck.next().id);
    assert.equal(seen.size, 12, `цыкл ${cycle}: паўтор у межах цыкла`);
  }
});

test('калода: апошні кліп цыкла не ідзе першым у наступным; парадак цыклаў розны', () => {
  const deck = new ClipDeck({ random: seeded(7) });
  deck.update(clipList(6));
  const cycles = [];
  for (let cycle = 0; cycle < 20; cycle++) {
    const order = Array.from({ length: 6 }, () => deck.next().id);
    if (cycles.length) assert.notEqual(order[0], cycles.at(-1).at(-1));
    cycles.push(order);
  }
  assert.ok(new Set(cycles.map(c => c.join())).size > 10);
});

test('калода: новыя кліпы трапляюць у бягучы цыкл, зніклыя выпадаюць, паказаныя не паўтараюцца', () => {
  const deck = new ClipDeck({ random: seeded(3) });
  deck.update(clipList(5));
  const first = [deck.next().id, deck.next().id];
  deck.update([...clipList(5).filter(c => c.id !== 'c4' || first.includes('c4')), { id: 'new1', title: 'Новы', duration: 10 }, { id: 'new2', title: 'Новы 2', duration: 10 }]);
  const rest = [];
  for (let i = 0; i < 10 && deck.order.length; i++) rest.push(deck.next().id);
  const cycle = [...first, ...rest];
  assert.equal(new Set(cycle).size, cycle.length, 'без паўтораў');
  assert.ok(rest.includes('new1') && rest.includes('new2'), 'новыя ў гэтым жа цыкле');
  if (!first.includes('c4')) assert.ok(!rest.includes('c4'), 'зніклы кліп не паказваецца');
});

test('калода: стан захоўваецца і аднаўляецца без паўтораў (перазагрузка старонкі ў OBS)', () => {
  const deck = new ClipDeck({ random: seeded(5) });
  deck.update(clipList(8));
  const before = [deck.next().id, deck.next().id, deck.next().id];
  const restored = new ClipDeck({ random: seeded(9), saved: JSON.parse(JSON.stringify(deck.save())) });
  restored.update(clipList(8));
  const after = Array.from({ length: 5 }, () => restored.next().id);
  assert.equal(new Set([...before, ...after]).size, 8);
});

test('калода: без кліпаў — null', () => {
  const deck = new ClipDeck();
  deck.update([]);
  assert.equal(deck.next(), null);
});

// ---------- Налады ----------

test('налады інтро: прадвызначаныя, праверка палёў', () => {
  assert.equal(validateIntro({}).countdown, 600);
  assert.equal(validateIntro({}).clipPause, 0);
  const ok = validateIntro({ ...introDefaults, links: [{ id: 'a1', url: ' twitch.tv/mashninski ', label: 'Twitch', qr: true }] });
  assert.deepEqual(ok.links[0], { id: 'a1', url: 'twitch.tv/mashninski', label: 'Twitch', qr: true });
  assert.throws(() => validateIntro({ countdown: 5 }), /intro_countdown/);
  assert.throws(() => validateIntro({ finishText: '' }), /intro_finish_text/);
  assert.throws(() => validateIntro({ clipPause: 500 }), /intro_clip_pause/);
  assert.throws(() => validateIntro({ links: [{ id: 'a', url: 'a b' }] }), /intro_link/);
  assert.throws(() => validateIntro({ links: Array.from({ length: 9 }, (_, i) => ({ id: `l${i}`, url: 'x.by' })) }), /intro_links/);
});

test('налады інтро: старая паўза 5 с па змаўчанні становіцца 0, свядомае значэнне застаецца', t => {
  const twitch = { identity: null };
  const s1 = store(t);
  s1.set('intro.settings', { ...introDefaults, version: 1, clipPause: 5, finishText: 'Ужо' });
  const a = new Intro({ store: s1, twitch }).config();
  assert.equal(a.clipPause, 0);
  assert.equal(a.finishText, 'Ужо');
  assert.equal(s1.get('intro.settings').version, 2);
  const s2 = store(t);
  s2.set('intro.settings', { ...introDefaults, version: 1, clipPause: 2 });
  assert.equal(new Intro({ store: s2, twitch }).config().clipPause, 2);
});

test('калода: peek паказвае наступны кліп, не мяняючы калоду, і на мяжы цыклаў таксама', () => {
  const deck = new ClipDeck({ random: seeded(11) });
  deck.update(clipList(4));
  for (let i = 0; i < 12; i++) {
    const next = deck.peek();
    assert.equal(deck.next().id, next.id);
  }
});

// ---------- Кліпы з Twitch ----------

/** Twitch у памяці: N кліпаў, раўнамерна ад стварэння канала да цяпер; ліміт ~1000 на адзін запыт. */
function clipsTwitch({ total, from, to, cap = 1000 }) {
  const clips = Array.from({ length: total }, (_, i) => ({
    id: `clip-${i}`, title: `Кліп ${i}`, thumbnail_url: `https://clips-media-assets2.twitch.tv/${i}-preview-480x272.jpg`, duration: 15 + (i % 40), creator_name: i % 3 ? 'Глядач' : 'Стрымер', creator_id: i % 3 ? '7' : '42',
    created_at: new Date(from + ((to - from) * (i + 0.5)) / total).toISOString(), view_count: i,
  }));
  const calls = [];
  return {
    calls,
    identity: { userId: '42', login: 'streamer' },
    async credentials() {},
    async api(path, { query }) {
      calls.push([path, query]);
      if (path === 'users') return { data: [{ id: '42', created_at: new Date(from).toISOString() }] };
      const start = Date.parse(query.started_at), end = Date.parse(query.ended_at);
      const inWindow = clips.filter(c => { const t = Date.parse(c.created_at); return t >= start && t < end; }).slice(0, cap);
      const offset = Number(query.after ?? 0);
      const page = inWindow.slice(offset, offset + Number(query.first));
      const next = offset + page.length;
      return { data: page, pagination: next < inWindow.length ? { cursor: String(next) } : {} };
    },
  };
}

test('кліпы: усе з усёй гісторыі канала, з пагінацыяй і падзелам вокнаў, без дублікатаў', async () => {
  const from = Date.UTC(2016, 5, 16), now = Date.UTC(2026, 9, 24);
  const twitch = clipsTwitch({ total: 3500, from, to: now, cap: 1000 });
  const dense = clipsTwitch({ total: 3000, from: Date.UTC(2025, 0, 1), to: Date.UTC(2025, 1, 1), cap: 1000 });
  const all = await fetchAllClips(twitch, '42', { now: () => now });
  assert.equal(all.length, 3500);
  assert.equal(new Set(all.map(c => c.id)).size, 3500);
  assert.deepEqual(Object.keys(all[0]).sort(), ['createdAt', 'creator', 'creatorId', 'duration', 'id', 'thumbnail', 'title', 'views']);
  // Сапраўды шчыльнае акно: 3000 кліпаў за месяц пры ліміце 1000 — праграма дзеліць акно і збірае ўсе.
  const denseAll = await fetchAllClips(dense, '42', { now: () => Date.UTC(2025, 1, 1) });
  assert.equal(denseAll.length, 3000);
  assert.ok(dense.calls.length > 30, 'акно падзелена на часткі');
});

test('спіс кліпаў: абнаўленне не часцей за хвіліну, пры памылцы застаецца апошні спіс', async t => {
  const now = clock();
  const s = store(t, now);
  let fail = false, fetches = 0;
  const twitch = { identity: { userId: '42' }, async credentials() {} };
  const intro = new Intro({ store: s, twitch, now, fetchClips: async () => {
    fetches++;
    if (fail) throw new Error('network_unavailable');
    return clipList(fetches + 2);
  } });
  await intro.refresh();
  assert.equal(intro.clips().clips.length, 3);
  await intro.refresh();
  assert.equal(fetches, 1, 'другая актывацыя адразу — без новага запыту');
  now.advance(61_000);
  await intro.refresh();
  assert.equal(intro.clips().clips.length, 4, 'новы кліп падхоплены');
  fail = true;
  now.advance(61_000);
  await intro.refresh();
  assert.equal(intro.error, 'network_unavailable');
  assert.equal(intro.clips().clips.length, 4, 'Twitch недаступны — апошні спіс');
  // Іншы канал — чужыя кліпы не паказваюцца.
  twitch.identity = { userId: '99' };
  assert.equal(intro.clips().clips.length, 0);
});

// ---------- Сцэна ў OBS ----------

/** OBS у памяці: сцэны, крыніцы і элементы сцэн — толькі тое, што выкарыстоўвае стварэнне сцэны інтро. */
function fakeObs() {
  const scenes = new Map([['Сцэна', []]]), inputs = new Map();
  let nextItem = 1;
  const calls = [];
  const obs = {
    calls, scenes, inputs,
    state: { connected: true },
    async request(type, data = {}) {
      calls.push(type);
      switch (type) {
        case 'GetSceneList': return { scenes: [...scenes.keys()].map(sceneName => ({ sceneName })) };
        case 'CreateScene': scenes.set(data.sceneName, []); return {};
        case 'GetInputList': return { inputs: [...inputs].map(([inputName, v]) => ({ inputName, inputKind: v.kind })) };
        case 'CreateInput': {
          if (inputs.has(data.inputName)) throw new Error('obs_request_601');
          inputs.set(data.inputName, { kind: data.inputKind, settings: data.inputSettings });
          const sceneItemId = nextItem++;
          scenes.get(data.sceneName).push({ sceneItemId, sourceName: data.inputName });
          return { sceneItemId };
        }
        case 'SetInputSettings': Object.assign(inputs.get(data.inputName).settings, data.inputSettings); return {};
        case 'GetSceneItemList': return { sceneItems: scenes.get(data.sceneName).map(i => ({ ...i })) };
        case 'CreateSceneItem': { const sceneItemId = nextItem++; scenes.get(data.sceneName).push({ sceneItemId, sourceName: data.sourceName }); return { sceneItemId }; }
        case 'RemoveSceneItem': scenes.set(data.sceneName, scenes.get(data.sceneName).filter(i => i.sceneItemId !== data.sceneItemId)); return {};
        case 'GetVideoSettings': return { baseWidth: 1920, baseHeight: 1080 };
        case 'SetSceneItemTransform': obs.transform = data.sceneItemTransform; return {};
        case 'SetSceneItemEnabled': return {};
        default: throw new Error(`unexpected ${type}`);
      }
    },
  };
  return obs;
}

test('сцэна інтро: стварэнне, паўторнае стварэнне без дублікатаў, абнаўленне адраса', async () => {
  const obs = fakeObs();
  const first = await ensureIntroScene(obs, { url: 'file:///start.html?page=intro&port=1' });
  assert.deepEqual(first, { sceneCreated: true, inputCreated: true, duplicatesRemoved: 0 });
  const second = await ensureIntroScene(obs, { url: 'file:///start.html?page=intro&port=2' });
  assert.deepEqual(second, { sceneCreated: false, inputCreated: false, duplicatesRemoved: 0 });
  assert.equal(obs.scenes.get(INTRO_SCENE).length, 1);
  assert.equal(obs.inputs.size, 1);
  const settings = obs.inputs.get(INTRO_INPUT).settings;
  assert.equal(settings.url, 'file:///start.html?page=intro&port=2');
  assert.equal(settings.width, 1920);
  assert.equal(settings.height, 1560, 'старонка вышэйшая за кадр — месца «за кадрам»');
  assert.equal(settings.reroute_audio, true);
  assert.equal(obs.transform.cropBottom, 480, 'OBS абразае месца «за кадрам»');
  // Крыніцу выпадкова дадалі ў сцэну двойчы — застаецца адна.
  obs.scenes.get(INTRO_SCENE).push({ sceneItemId: 99, sourceName: INTRO_INPUT });
  const third = await ensureIntroScene(obs, { url: 'x' });
  assert.equal(third.duplicatesRemoved, 1);
  assert.equal(obs.scenes.get(INTRO_SCENE).length, 1);
  // Сцэну выдалілі, крыніца засталася — сцэна з’яўляецца зноў з той жа крыніцай.
  obs.scenes.delete(INTRO_SCENE);
  const fourth = await ensureIntroScene(obs, { url: 'x' });
  assert.deepEqual(fourth, { sceneCreated: true, inputCreated: false, duplicatesRemoved: 0 });
  assert.equal(obs.scenes.get(INTRO_SCENE).length, 1);
});

test('сцэна інтро: OBS не падключаны або назва занятая крыніцай іншага тыпу', async () => {
  await assert.rejects(ensureIntroScene({ state: { connected: false } }, { url: 'x' }), /obs_required/);
  const obs = fakeObs();
  obs.inputs.set(INTRO_INPUT, { kind: 'text_gdiplus', settings: {} });
  await assert.rejects(ensureIntroScene(obs, { url: 'x' }), /intro_source_name/);
});

// ---------- API ----------

test('API інтро: налады з дока адразу бачныя оверлею, перазапуск адліку', async t => {
  const dir = tempDir(), web = join(dir, 'web');
  mkdirSync(web);
  writeFileSync(join(web, 'dock.html'), '<!doctype html><title>dock</title>');
  writeFileSync(join(web, 'intro.html'), '<!doctype html><title>intro</title>');
  const app = await createApp({ dataDir: join(dir, 'data'), webRoot: web, port: 0, vault: new MemoryVault(), autoStart: false, backupDirectory: join(dir, 'daily') });
  t.after(() => app.close());
  const page = await fetch(`${app.origin}/intro`);
  assert.equal(page.status, 200);
  const cookie = page.headers.get('set-cookie').split(';')[0];
  const origin = app.origin;
  const headers = { cookie, origin, 'x-tadewusz': '1', 'content-type': 'application/json' };
  const post = (path, body = {}) => fetch(`${origin}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });

  const before = await (await fetch(`${origin}/intro/state`, { headers: { cookie } })).json();
  assert.equal(before.config.countdown, 600);
  assert.equal((await post('/api/intro/config', { ...before.config, countdown: 300, finishText: 'Ужо пачынаем' })).status, 200);
  const after = await (await fetch(`${origin}/intro/state`, { headers: { cookie } })).json();
  assert.equal(after.config.countdown, 300);
  assert.equal(after.config.finishText, 'Ужо пачынаем');
  await post('/api/intro/restart');
  const restarted = await (await fetch(`${origin}/intro/state`, { headers: { cookie } })).json();
  assert.ok(restarted.restartAt > 0);
  assert.equal((await post('/api/intro/config', { ...after.config, countdown: 1 })).status, 400);
  // Без OBS сцэну не стварыць — зразумелая памылка.
  assert.deepEqual(await (await post('/api/intro/scene')).json(), { error: 'obs_required' });
  // Без cookie оверлей нічога не атрымлівае.
  assert.equal((await fetch(`${origin}/intro/state`)).status, 401);
  // Стан для дока ўтрымлівае інтро і адрас старонкі.
  const state = await (await fetch(`${origin}/api/state`, { headers: { cookie } })).json();
  assert.equal(state.intro.config.countdown, 300);
  assert.equal(state.urls.intro, `${origin}/intro`);
});
