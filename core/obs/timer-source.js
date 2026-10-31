// Крыніца «Таймер» у OBS: празрыстая старонка на ўвесь кадр (картка адліку — у куце па наладах), верхнім слоем.
// Сігнал на нулі ідзе праз мікшар OBS (у эфір); з маніторынгам стрымер чуе яго і сам.
import { ensureOverlaySource, TIMER_INPUT } from './season-source.js';
import { routeTickerAudio } from './ticker-source.js';

export { TIMER_INPUT };

export const timerBrowserSettings = (url, width, height) => ({
  url, is_local_file: false, width, height, fps_custom: true, fps: 30, reroute_audio: true, shutdown: true, restart_when_active: false,
  css: 'body { background-color: rgba(0, 0, 0, 0); margin: 0px auto; overflow: hidden; }',
});

export async function ensureTimerSource(obs, { url, monitor }) {
  const result = await ensureOverlaySource(obs, { inputName: TIMER_INPUT, settings: (w, h) => timerBrowserSettings(url, w, h), nameError: 'timer_source_name' });
  await routeTimerAudio(obs, { monitor });
  return result;
}

/** Маніторынг сігналу па наладзе; крыніцы няма — нічога не робіць. */
export async function routeTimerAudio(obs, { monitor }) {
  if (!obs.state.connected) return { changed: false };
  const { inputs } = await obs.request('GetInputList');
  if (!inputs.some(i => i.inputName === TIMER_INPUT && i.inputKind === 'browser_source')) return { changed: false };
  return routeTickerAudio(obs, TIMER_INPUT, { monitor });
}
