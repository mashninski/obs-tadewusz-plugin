// Ці бачны бягучы радок у эфіры: роўна адна ўключаная крыніца-браўзер з нашым `source` у бягучай праграмнай сцэне
// (з улікам укладзеных сцэн і груп), без фільтраў, павароту і абрэзкі, цалкам у кадры і зверху іншых.
// Невядомае або неадназначнае — «не бачны»: глядач не павінен плаціць за паведамленне, якое не пакажуць.

function fits(t, width, height) {
  const numbers = ['width', 'height', 'sourceWidth', 'sourceHeight', 'scaleX', 'scaleY', 'positionX', 'positionY', 'rotation', 'alignment'];
  if (!t || !numbers.every(key => Number.isFinite(t[key])) || !['width', 'height', 'sourceWidth', 'sourceHeight', 'scaleX', 'scaleY'].every(key => t[key] > 0)
    || !Number.isInteger(t.alignment) || t.rotation !== 0 || t.boundsType !== 'OBS_BOUNDS_NONE'
    || [t.cropLeft, t.cropRight, t.cropTop, t.cropBottom].some(n => n !== 0)) return false;
  const x = t.positionX - ((t.alignment & 1) ? 0 : (t.alignment & 2) ? t.width : t.width / 2);
  const y = t.positionY - ((t.alignment & 4) ? 0 : (t.alignment & 8) ? t.height : t.height / 2);
  return x >= -1 && y >= -1 && x + t.width <= width + 1 && y + t.height <= height + 1;
}

/** @returns {Promise<{source:boolean, name?:string}>} */
export async function tickerSourceStatus(obs, sourceId) {
  try {
    if (!obs.state.connected) return { source: false };
    const { currentProgramSceneName } = await obs.request('GetCurrentProgramScene');
    const { baseWidth, baseHeight } = await obs.request('GetVideoSettings');
    const { transitionCursor } = await obs.request('GetCurrentSceneTransitionCursor').catch(() => ({ transitionCursor: 1 }));
    if (transitionCursor !== 1) return { source: false };
    const unfiltered = async sourceName => {
      const { filters } = await obs.request('GetSourceFilterList', { sourceName });
      return Array.isArray(filters) && filters.every(f => f?.filterEnabled === false);
    };
    let count = 0, visited = 0, safe = true, name;
    const walk = async (scene, group, path, width, height, ancestorsSafe) => {
      if (path.has(scene) || ++visited > 100) throw new Error('ticker_scene_limit');
      path = new Set([...path, scene]);
      const { sceneItems } = await obs.request(group ? 'GetGroupSceneItemList' : 'GetSceneItemList', { sceneName: scene });
      if (!Array.isArray(sceneItems)) throw new Error('ticker_scene_unknown');
      for (const item of sceneItems) {
        if (!item.sceneItemEnabled) continue;
        const t = item.sceneItemTransform;
        if (!t || t.width <= 0 || t.height <= 0) continue;
        const onTop = !sceneItems.some(other => other.sceneItemEnabled && other.sceneItemIndex > item.sceneItemIndex);
        const geometry = ancestorsSafe && onTop && fits(t, width, height);
        if (item.isGroup || item.sourceType === 'OBS_SOURCE_TYPE_SCENE') {
          await walk(item.sourceName, item.isGroup, path, t.sourceWidth, t.sourceHeight, geometry && await unfiltered(item.sourceName));
        } else if (item.inputKind === 'browser_source') {
          const { inputSettings } = await obs.request('GetInputSettings', { inputName: item.sourceName });
          if (String(inputSettings.url ?? '').includes(`source=${sourceId}`)) {
            count++;
            name = item.sourceName;
            safe = safe && geometry && await unfiltered(item.sourceName);
          }
        }
      }
    };
    await walk(currentProgramSceneName, false, new Set(), baseWidth, baseHeight, true);
    safe = safe && await unfiltered(currentProgramSceneName);
    return { source: count === 1 && safe, name };
  } catch {
    return { source: false };
  }
}
