// Крыніцы «Сезон» і «Таймер» у OBS: празрыстая старонка-браўзер на ўвесь кадр, верхнім слоем у бягучай праграмнай сцэне.
// Ідэмпатэнтна: калі крыніца ўжо ёсць, абнаўляюцца налады; у сцэне яна застаецца адна і падымаецца наверх.
// Налады самой анімацыі (тэма, колькасць, хуткасць) сюды не трапляюць — старонка бярэ іх з праграмы сама.
export const SEASON_INPUT = 'Tadewusz · Сезон';
/** Тут, а не ў timer-source.js: радок правярае, што празрыстыя крыніцы яго не закрываюць (без цыклу імпартаў). */
export const TIMER_INPUT = 'Tadewusz · Таймер';

/**
 * Налады крыніцы: памер — базавая раздзяляльнасць OBS, 30 кадраў/с. Пакуль крыніца не бачная, старонка
 * выключаная (нагрузкі няма). Фон празрысты — як у стандартным CSS крыніцы-браўзера OBS.
 */
export const seasonBrowserSettings = (url, width, height) => ({
  url, is_local_file: false, width, height, fps_custom: true, fps: 30, reroute_audio: false, shutdown: true, restart_when_active: false,
  css: 'body { background-color: rgba(0, 0, 0, 0); margin: 0px auto; overflow: hidden; }',
});

/** @returns {Promise<{ sceneName: string, inputCreated: boolean, itemCreated: boolean }>} */
export function ensureSeasonSource(obs, { url }) {
  return ensureOverlaySource(obs, { inputName: SEASON_INPUT, settings: (w, h) => seasonBrowserSettings(url, w, h), nameError: 'season_source_name' });
}

/**
 * Празрыстая крыніца-браўзер на ўвесь кадр, верхнім слоем у праграмнай сцэне (агульнае для «Сезона» і «Таймера»).
 * `settings(width, height)` — налады крыніцы для базавай раздзяляльнасці OBS.
 * @returns {Promise<{ sceneName: string, inputCreated: boolean, itemCreated: boolean }>}
 */
export async function ensureOverlaySource(obs, { inputName, settings: make, nameError }) {
  if (!obs.state.connected) throw new Error('obs_required');
  const { baseWidth, baseHeight } = await obs.request('GetVideoSettings');
  const { currentProgramSceneName: sceneName } = await obs.request('GetCurrentProgramScene');

  const settings = make(baseWidth, baseHeight);
  const { inputs } = await obs.request('GetInputList');
  const existing = inputs.find(i => i.inputName === inputName);
  if (existing && existing.inputKind !== 'browser_source') throw new Error(nameError);
  if (existing) await obs.request('SetInputSettings', { inputName, inputSettings: settings, overlay: true });
  else await obs.request('CreateInput', { sceneName, inputName, inputKind: 'browser_source', inputSettings: settings, sceneItemEnabled: true });

  // У сцэне — роўна адзін раз.
  const { sceneItems } = await obs.request('GetSceneItemList', { sceneName });
  const ours = sceneItems.filter(item => item.sourceName === inputName).sort((a, b) => a.sceneItemId - b.sceneItemId);
  let sceneItemId = ours[0]?.sceneItemId;
  // Новая крыніца трапляе ў сцэну разам з CreateInput; існуючую трэба дадаць, калі ў гэтай сцэне яе няма.
  const itemCreated = !existing || sceneItemId === undefined;
  if (sceneItemId === undefined) ({ sceneItemId } = await obs.request('CreateSceneItem', { sceneName, sourceName: inputName, sceneItemEnabled: true }));
  for (const extra of ours.slice(1)) await obs.request('RemoveSceneItem', { sceneName, sceneItemId: extra.sceneItemId });

  await obs.request('SetSceneItemTransform', {
    sceneName, sceneItemId,
    sceneItemTransform: {
      positionX: 0, positionY: 0, rotation: 0, alignment: 5, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0,
      boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsAlignment: 0, boundsWidth: baseWidth, boundsHeight: baseHeight,
    },
  });
  // Верхні слой: у obs-websocket большы індэкс — вышэй у спісе.
  const { sceneItems: after } = await obs.request('GetSceneItemList', { sceneName });
  await obs.request('SetSceneItemIndex', { sceneName, sceneItemId, sceneItemIndex: after.length - 1 });
  await obs.request('SetSceneItemEnabled', { sceneName, sceneItemId, sceneItemEnabled: true });
  return { sceneName, inputCreated: !existing, itemCreated };
}
