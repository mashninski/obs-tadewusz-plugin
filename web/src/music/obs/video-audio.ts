// Гук відэа для хвалі. Гук з iframe YouTube старонка прааналізаваць не можа (іншы origin),
// таму бярэм узровень крыніцы OBS «Браузер», у якой адкрыты оверлэй (з уключаным «Управлять звуком через OBS»).

import type { ObsCaller } from './spotify-window';

const isObject = (x: unknown): x is Record<string, any> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Адрас крыніцы з оверлэем музыкі: сама старонка або старонка чакання ядра (obs/start.html?page=music). */
export const MUSIC_OVERLAY_URL = /music\.html|[?&]page=music(?:&|$)/i;

export interface OverlaySource {
  name: string;
  /** Уключана «Управлять звуком через OBS»: толькі тады ў OBS ёсць узровень гуку гэтай крыніцы. */
  audio: boolean;
}

/** Крыніца OBS з оверлэем (спачатку — тая, гук якой ідзе праз OBS). `null` — такой крыніцы няма. */
export async function findOverlaySource(obs: ObsCaller): Promise<OverlaySource | null> {
  const res = await obs.call('GetInputList', { inputKind: 'browser_source' });
  const inputs = Array.isArray(res.inputs) ? (res.inputs as Record<string, unknown>[]) : [];
  let fallback: OverlaySource | null = null;
  for (const input of inputs) {
    const name = String(input.inputName ?? '');
    if (!name) continue;
    try {
      const settings = (await obs.call('GetInputSettings', { inputName: name })).inputSettings;
      if (!isObject(settings) || typeof settings.url !== 'string' || !/overlay\.html/i.test(settings.url)) continue;
      if (settings.reroute_audio === true) return { name, audio: true };
      fallback ??= { name, audio: false };
    } catch {
      // Крыніца знікла, пакуль чыталі спіс.
    }
  }
  return fallback;
}
