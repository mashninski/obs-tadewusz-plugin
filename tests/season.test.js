import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApp } from '../core/app.js';
import { ensureSeasonSource, SEASON_INPUT } from '../core/obs/season-source.js';
import { imageType, MAX_IMAGES, Season, seasonDefaults, validateSeason } from '../core/season/season.js';
import { MemoryVault } from '../core/storage/vault.js';
import { advance, centerDistance, createObject } from '../web/src/season/motion.js';
import { store, tempDir } from './helpers.js';

function seeded(seed = 42) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(16)]);
const SVG = Buffer.from('<?xml version="1.0"?>\n<!-- прывід -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle r="5"/></svg>');

// ---------- Налады ----------

test('налады сезона: прадвызначаныя і праверка палёў', () => {
  const c = validateSeason({});
  assert.equal(c.count, 5);
  assert.equal(c.opacity, 0.6);
  assert.equal(c.theme, 'halloween');
  assert.equal(c.enabled, false);
  assert.equal(validateSeason({ count: 40, theme: 'winter', motion: 'tumble', speed: 0.2 }).count, 40);
  for (const [patch, code] of [
    [{ count: 0 }, /season_count/], [{ count: 41 }, /season_count/], [{ count: 2.5 }, /season_count/],
    [{ theme: 'summer' }, /season_theme/], [{ motion: 'spin' }, /season_motion/],
    [{ size: 8 }, /season_size/], [{ speed: 5 }, /season_speed/], [{ opacity: 0 }, /season_opacity/],
    [{ enabled: 'yes' }, /season_settings/], [{ version: 2 }, /season_settings/],
  ]) assert.throws(() => validateSeason(patch), code, JSON.stringify(patch));
  // Лішнія палі не захоўваюцца.
  assert.deepEqual(Object.keys(validateSeason({ extra: 1 })).sort(), Object.keys(seasonDefaults).sort());
});

test('сезон: рух «як у тэмы» для старонкі', t => {
  const season = new Season({ store: store(t), dataDir: tempDir() });
  assert.equal(season.overlayState().config.motion, 'float');
  season.save({ ...seasonDefaults, theme: 'winter' });
  assert.equal(season.overlayState().config.motion, 'fall');
  season.save({ ...seasonDefaults, theme: 'autumn' });
  assert.equal(season.overlayState().config.motion, 'tumble');
  season.save({ ...seasonDefaults, theme: 'autumn', motion: 'float' });
  assert.equal(season.overlayState().config.motion, 'float');
});

// ---------- Карцінкі ----------

test('карцінкі: тып па змесціве, а не па імені', () => {
  assert.equal(imageType(PNG), 'png');
  assert.equal(imageType(WEBP), 'webp');
  assert.equal(imageType(SVG), 'svg');
  assert.equal(imageType(Buffer.from('<svg viewBox="0 0 1 1"/>')), 'svg');
  assert.equal(imageType(Buffer.from('<html><svg></svg></html>')), null);
  assert.equal(imageType(Buffer.from('GIF89a......')), null);
  assert.equal(imageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), null);
});

test('карцінкі: загрузка, свае імёны, памер, колькасць, выдаленне', t => {
  const dataDir = tempDir();
  const season = new Season({ store: store(t), dataDir });
  const { name } = season.upload({ theme: 'halloween', data: PNG.toString('base64') });
  assert.match(name, /^[a-f0-9]{16}\.png$/);
  assert.deepEqual(season.images('halloween'), [name]);
  assert.deepEqual(season.read('halloween', name).bytes, PNG);
  assert.equal(season.read('halloween', name).type, 'image/png');
  assert.match(season.upload({ theme: 'halloween', data: SVG.toString('base64') }).name, /\.svg$/);

  assert.throws(() => season.upload({ theme: 'halloween', data: Buffer.from('not an image').toString('base64') }), /season_image_type/);
  assert.throws(() => season.upload({ theme: 'halloween', data: Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]).toString('base64') }), /season_image_size/);
  assert.throws(() => season.upload({ theme: '../etc', data: PNG.toString('base64') }), /season_theme/);
  assert.throws(() => season.upload({ theme: 'winter', data: '***' }), /season_image/);
  // Чужы шлях не чытаецца і не выдаляецца.
  assert.throws(() => season.read('halloween', '../../obs-bot.sqlite'), /season_image/);
  assert.throws(() => season.remove({ theme: 'halloween', name: '..\\x.png' }), /season_image/);

  for (let i = season.images('winter').length; i < MAX_IMAGES; i++) season.upload({ theme: 'winter', data: WEBP.toString('base64') });
  assert.throws(() => season.upload({ theme: 'winter', data: WEBP.toString('base64') }), /season_image_limit/);

  season.remove({ theme: 'halloween', name });
  assert.equal(season.images('halloween').length, 1);
  assert.equal(season.overlayState().images.length, 1);
  assert.match(season.overlayState().images[0], /^\/season\/image\?theme=halloween&name=[a-f0-9]{16}\.svg$/);
});

// ---------- Рух ----------

const W = 1920, H = 1080;

test('рух: аб’екты не затрымліваюцца ў цэнтры кадра і не выходзяць за яго (float)', () => {
  const random = seeded(3);
  const env = { motion: 'float', width: W, height: H, size: 72, speed: 1, fade: false, time: 0, random };
  const objects = Array.from({ length: 20 }, () => createObject({ ...env }));
  let inCenter = 0, samples = 0;
  for (let step = 0; step < 30 * 600; step++) {
    env.time += 1 / 30;
    for (const o of objects) {
      assert.ok(advance(o, 1 / 30, env));
      if (step % 30 === 0) { samples++; if (centerDistance(o.x, o.y, W, H) < 0.5) inCenter++; }
      assert.ok(o.x > -200 && o.x < W + 200 && o.y > -200 && o.y < H + 200, `за кадрам: ${o.x}, ${o.y}`);
      assert.ok(Math.abs(o.angle) <= Math.PI / 18 + 1e-9, 'нахіл не больш за 10°');
    }
  }
  // Унутраная палова эліпса — ~1,2 % плошчы кадра; аб’екты бываюць там рэдка.
  assert.ok(inCenter / samples < 0.02, `у цэнтры ${(100 * inCenter / samples).toFixed(1)} %`);
});

test('рух: падзенне — зверху ўніз і па крузе; кульганне мяняе scaleX', () => {
  const random = seeded(9);
  for (const motion of ['fall', 'tumble']) {
    const env = { motion, width: W, height: H, size: 48, speed: 1, fade: false, time: 0, random };
    const o = createObject({ ...env, initial: false });
    assert.ok(o.y < 0, 'новы аб’ект з’яўляецца над кадрам');
    let wrapped = false, prevY = o.y, flips = new Set();
    for (let step = 0; step < 30 * 120; step++) {
      env.time += 1 / 30;
      advance(o, 1 / 30, env);
      if (o.y < prevY) wrapped = true;
      prevY = o.y;
      flips.add(Math.sign(o.flip));
    }
    assert.ok(wrapped, `${motion}: вярнуўся наверх`);
    if (motion === 'tumble') assert.ok(flips.has(1) && flips.has(-1), 'кульганне');
    else assert.deepEqual([...flips], [1]);
  }
});

test('рух: аб’ект растае і просіць новае месца, калі ўключана fade', () => {
  const random = seeded(5);
  const env = { motion: 'float', width: W, height: H, size: 64, speed: 1, fade: true, time: 0, random };
  const o = createObject({ ...env });
  assert.equal(o.alpha, 0, 'з’яўляецца плаўна');
  let gone = false;
  for (let step = 0; step < 30 * 120 && !gone; step++) {
    env.time += 1 / 30;
    gone = !advance(o, 1 / 30, env);
    assert.ok(o.alpha >= -0.1 && o.alpha <= 1);
  }
  assert.ok(gone);
  const still = createObject({ ...env });
  for (let step = 0; step < 30 * 120; step++) { env.time += 1 / 30; assert.ok(advance(still, 1 / 30, { ...env, fade: false })); }
});

// ---------- Крыніца ў OBS ----------

function fakeObs({ program = 'Гульня' } = {}) {
  const scenes = new Map([[program, [{ sceneItemId: 1, sourceName: 'Камера' }, { sceneItemId: 2, sourceName: 'Гульня' }]]]), inputs = new Map();
  let nextItem = 10;
  const obs = {
    scenes, inputs, state: { connected: true }, indexes: {},
    async request(type, data = {}) {
      switch (type) {
        case 'GetVideoSettings': return { baseWidth: 2560, baseHeight: 1440 };
        case 'GetCurrentProgramScene': return { currentProgramSceneName: program };
        case 'GetInputList': return { inputs: [...inputs].map(([inputName, v]) => ({ inputName, inputKind: v.kind })) };
        case 'CreateInput': {
          inputs.set(data.inputName, { kind: data.inputKind, settings: data.inputSettings });
          const sceneItemId = nextItem++;
          scenes.get(data.sceneName).push({ sceneItemId, sourceName: data.inputName });
          return { sceneItemId };
        }
        case 'SetInputSettings': Object.assign(inputs.get(data.inputName).settings, data.inputSettings); return {};
        case 'GetSceneItemList': return { sceneItems: scenes.get(data.sceneName).map(i => ({ ...i })) };
        case 'CreateSceneItem': { const sceneItemId = nextItem++; scenes.get(data.sceneName).push({ sceneItemId, sourceName: data.sourceName }); return { sceneItemId }; }
        case 'RemoveSceneItem': scenes.set(data.sceneName, scenes.get(data.sceneName).filter(i => i.sceneItemId !== data.sceneItemId)); return {};
        case 'SetSceneItemTransform': obs.transform = data.sceneItemTransform; return {};
        case 'SetSceneItemIndex': {
          const list = scenes.get(data.sceneName), item = list.find(i => i.sceneItemId === data.sceneItemId);
          list.splice(list.indexOf(item), 1);
          list.splice(data.sceneItemIndex, 0, item);
          return {};
        }
        case 'SetSceneItemEnabled': return {};
        default: throw new Error(`unexpected ${type}`);
      }
    },
  };
  return obs;
}

test('крыніца сезона: у праграмнай сцэне, на ўвесь кадр, верхнім слоем, без дублікатаў', async () => {
  const obs = fakeObs();
  const first = await ensureSeasonSource(obs, { url: 'file:///start.html?page=season&port=1' });
  assert.deepEqual(first, { sceneName: 'Гульня', inputCreated: true, itemCreated: true });
  const settings = obs.inputs.get(SEASON_INPUT).settings;
  assert.equal(settings.width, 2560);
  assert.equal(settings.height, 1440);
  assert.equal(settings.fps, 30);
  assert.equal(settings.shutdown, true, 'схаваная крыніца не працуе');
  assert.match(settings.css, /rgba\(0, 0, 0, 0\)/, 'празрысты фон');
  assert.equal(obs.transform.boundsWidth, 2560);
  assert.equal(obs.scenes.get('Гульня').at(-1).sourceName, SEASON_INPUT, 'верхні слой');

  // Хтосьці перасунуў уніз і дадаў другі раз — застаецца адна, зноў наверсе, адрас абноўлены.
  const list = obs.scenes.get('Гульня');
  list.unshift(list.pop());
  list.push({ sceneItemId: 99, sourceName: SEASON_INPUT }, { sceneItemId: 100, sourceName: 'Чат' });
  const second = await ensureSeasonSource(obs, { url: 'x' });
  assert.deepEqual(second, { sceneName: 'Гульня', inputCreated: false, itemCreated: false });
  assert.equal(obs.scenes.get('Гульня').filter(i => i.sourceName === SEASON_INPUT).length, 1);
  assert.equal(obs.scenes.get('Гульня').at(-1).sourceName, SEASON_INPUT);
  assert.equal(obs.inputs.get(SEASON_INPUT).settings.url, 'x');
  assert.equal(obs.inputs.size, 1);
});

test('крыніца сезона: OBS не падключаны або назва занятая крыніцай іншага тыпу', async () => {
  await assert.rejects(ensureSeasonSource({ state: { connected: false } }, { url: 'x' }), /obs_required/);
  const obs = fakeObs();
  obs.inputs.set(SEASON_INPUT, { kind: 'image_source', settings: {} });
  await assert.rejects(ensureSeasonSource(obs, { url: 'x' }), /season_source_name/);
});

// ---------- API ----------

test('API сезона: налады, карцінкі (у тым ліку вялікі запыт), старонка і абарона', async t => {
  const dir = tempDir(), web = join(dir, 'web');
  mkdirSync(web);
  writeFileSync(join(web, 'dock.html'), '<!doctype html><title>dock</title>');
  writeFileSync(join(web, 'season.html'), '<!doctype html><title>season</title>');
  const app = await createApp({ dataDir: join(dir, 'data'), webRoot: web, port: 0, vault: new MemoryVault(), autoStart: false, backupDirectory: join(dir, 'daily') });
  t.after(() => app.close());
  const page = await fetch(`${app.origin}/season`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /season/);
  const cookie = page.headers.get('set-cookie').split(';')[0];
  const origin = app.origin;
  const headers = { cookie, origin, 'x-tadewusz': '1', 'content-type': 'application/json' };
  const post = (path, body = {}) => fetch(`${origin}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const get = path => fetch(`${origin}${path}`, { headers: { cookie } });

  const before = await (await get('/season/state')).json();
  assert.equal(before.config.enabled, false);
  assert.equal(before.config.motion, 'float');
  assert.equal((await post('/api/season/config', { ...seasonDefaults, enabled: true, theme: 'winter', count: 12 })).status, 200);
  const after = await (await get('/season/state')).json();
  assert.equal(after.config.count, 12);
  assert.equal(after.config.motion, 'fall');
  assert.deepEqual(await (await post('/api/season/config', { ...seasonDefaults, count: 99 })).json(), { error: 'season_count' });

  // Карцінка амаль 2 МБ (base64 ~2,7 МБ) праходзіць праз асобны ліміт маршруту.
  const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024 - PNG.length - 10)]);
  const uploaded = await post('/api/season/upload', { theme: 'winter', data: big.toString('base64') });
  assert.equal(uploaded.status, 200);
  const { name } = await uploaded.json();
  const image = await get(`/season/image?theme=winter&name=${name}`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.equal((await image.arrayBuffer()).byteLength, big.length);
  // Іншыя маршруты — з ранейшым лімітам.
  assert.equal((await post('/api/season/config', { pad: 'x'.repeat(300 * 1024) })).status, 413);

  const svg = await (await post('/api/season/upload', { theme: 'winter', data: SVG.toString('base64') })).json();
  const svgResponse = await get(`/season/image?theme=winter&name=${svg.name}`);
  assert.match(svgResponse.headers.get('content-security-policy'), /sandbox/, 'SVG не выконвае скрыптаў');

  const state = await (await get('/api/state')).json();
  assert.equal(state.season.config.count, 12);
  assert.equal(state.season.images.winter.length, 2);
  assert.equal(state.urls.season, `${origin}/season`);
  assert.equal((await post('/api/season/remove', { theme: 'winter', name })).status, 200);
  assert.equal((await (await get('/season/state')).json()).images.length, 1);
  assert.equal((await get('/season/image?theme=winter&name=../x')).status, 400);
  // Без OBS крыніцу не дадаць; без cookie старонка нічога не атрымлівае.
  assert.deepEqual(await (await post('/api/season/source')).json(), { error: 'obs_required' });
  assert.equal((await fetch(`${origin}/season/state`)).status, 401);
});

test('бягучы радок пад «Сезонам» застаецца бачным; пад іншай крыніцай — не', async () => {
  const { tickerSourceStatus } = await import('../core/obs/ticker-source.js');
  const transform = { width: 1920, height: 80, sourceWidth: 1920, sourceHeight: 80, scaleX: 1, scaleY: 1, positionX: 0, positionY: 1000,
    rotation: 0, alignment: 5, boundsType: 'OBS_BOUNDS_NONE', cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0 };
  const full = { ...transform, height: 1080, sourceHeight: 1080, positionY: 0 };
  const scene = top => [
    { sceneItemId: 1, sceneItemIndex: 0, sceneItemEnabled: true, sourceName: 'Радок', inputKind: 'browser_source', sceneItemTransform: transform },
    { sceneItemId: 2, sceneItemIndex: 1, sceneItemEnabled: true, sourceName: top, inputKind: 'browser_source', sceneItemTransform: full },
  ];
  const obs = items => ({
    state: { connected: true },
    async request(type, data) {
      switch (type) {
        case 'GetCurrentProgramScene': return { currentProgramSceneName: 'Гульня' };
        case 'GetVideoSettings': return { baseWidth: 1920, baseHeight: 1080 };
        case 'GetCurrentSceneTransitionCursor': return { transitionCursor: 1 };
        case 'GetSourceFilterList': return { filters: [] };
        case 'GetSceneItemList': return { sceneItems: items };
        case 'GetInputSettings': return { inputSettings: { url: data.inputName === 'Радок' ? 'http://x/ticker?source=abc' : 'http://x/season' } };
        default: throw new Error(`unexpected ${type}`);
      }
    },
  });
  assert.deepEqual(await tickerSourceStatus(obs(scene(SEASON_INPUT)), 'abc'), { source: true, name: 'Радок' });
  assert.equal((await tickerSourceStatus(obs(scene('Чат')), 'abc')).source, false);
});
