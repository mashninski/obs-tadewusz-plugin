// Сцэна «Інтро» ў OBS: адна крыніца-браўзер 1920×1080 на старонку інтро праграмы.
// Ідэмпатэнтна: калі сцэна і крыніца ўжо ёсць, яны абнаўляюцца, а не дублююцца. Налады самой старонкі
// (адлік, спасылкі, паўза паміж кліпамі) сюды не трапляюць — оверлей бярэ іх з праграмы сам.
export const INTRO_SCENE = 'Інтро';
export const INTRO_INPUT = 'Tadewusz · Інтро';

/**
 * Налады крыніцы-браўзера. Гук кліпаў ідзе праз OBS (гучнасць — у мікшары OBS).
 * Пакуль сцэна не бачная, старонка выключана (ні гуку, ні нагрузкі); пры актывацыі яна загружаецца нанова —
 * адлік пачынаецца з пачатку, спіс кліпаў абнаўляецца, а калода працягваецца (яна захоўваецца ў старонцы).
 */
export const introBrowserSettings = url => ({
  url, is_local_file: false, width: 1920, height: 1080, fps_custom: true, fps: 30,
  reroute_audio: true, shutdown: true, restart_when_active: true, css: '',
});

/** @returns {Promise<{ sceneCreated: boolean, inputCreated: boolean, duplicatesRemoved: number }>} */
export async function ensureIntroScene(obs, { url }) {
  if (!obs.state.connected) throw new Error('obs_required');

  const { scenes } = await obs.request('GetSceneList');
  const sceneCreated = !scenes.some(s => s.sceneName === INTRO_SCENE);
  if (sceneCreated) await obs.request('CreateScene', { sceneName: INTRO_SCENE });

  const settings = introBrowserSettings(url);
  const { inputs } = await obs.request('GetInputList');
  const existing = inputs.find(i => i.inputName === INTRO_INPUT);
  if (existing && existing.inputKind !== 'browser_source') throw new Error('intro_source_name');
  if (existing) await obs.request('SetInputSettings', { inputName: INTRO_INPUT, inputSettings: settings, overlay: true });
  else await obs.request('CreateInput', { sceneName: INTRO_SCENE, inputName: INTRO_INPUT, inputKind: 'browser_source', inputSettings: settings, sceneItemEnabled: true });

  // У сцэне крыніца павінна быць роўна адзін раз.
  const { sceneItems } = await obs.request('GetSceneItemList', { sceneName: INTRO_SCENE });
  const ours = sceneItems.filter(item => item.sourceName === INTRO_INPUT).sort((a, b) => a.sceneItemId - b.sceneItemId);
  let sceneItemId = ours[0]?.sceneItemId;
  if (sceneItemId === undefined) ({ sceneItemId } = await obs.request('CreateSceneItem', { sceneName: INTRO_SCENE, sourceName: INTRO_INPUT, sceneItemEnabled: true }));
  for (const extra of ours.slice(1)) await obs.request('RemoveSceneItem', { sceneName: INTRO_SCENE, sceneItemId: extra.sceneItemId });

  // На ўвесь кадр: пры іншай базавай раздзяляльнасці старонка 1920×1080 упісваецца ў кадр.
  const { baseWidth, baseHeight } = await obs.request('GetVideoSettings');
  await obs.request('SetSceneItemTransform', {
    sceneName: INTRO_SCENE, sceneItemId,
    sceneItemTransform: {
      positionX: 0, positionY: 0, rotation: 0, alignment: 5, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0,
      boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsAlignment: 0, boundsWidth: baseWidth, boundsHeight: baseHeight,
    },
  });
  await obs.request('SetSceneItemEnabled', { sceneName: INTRO_SCENE, sceneItemId, sceneItemEnabled: true });
  return { sceneCreated, inputCreated: !existing, duplicatesRemoved: Math.max(0, ours.length - 1) };
}
