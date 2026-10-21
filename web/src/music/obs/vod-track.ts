// Запіс стрыму без музыкі: дарожка Twitch VOD у OBS. Twitch робіць запіс (VOD) і кліпы з асобнай
// аўдыядарожкі, а эфір — з асноўнай. Бот правярае, ці не трапяць на дарожку запісу Spotify і відэа YouTube,
// і па кнопцы «Наладзіць» расстаўляе дарожкі сам. «Звук рабочего стола» нельга ачысціць ад адной праграмы,
// таму ўвесь астатні гук у запіс дае крыніца плагіна win-capture-audio «усё, акрамя Spotify».

import type { ObsCaller } from './spotify-window';
import { MUSIC_OVERLAY_URL } from './video-audio';

export const TRACKS = 6;
/** Дарожкі крыніцы: `tracks[0]` — дарожка 1. */
export type Tracks = boolean[];

/** Від крыніцы плагіна win-capture-audio і назва крыніцы, якую стварае бот. */
export const NO_MUSIC_KIND = 'audio_capture';
export const NO_MUSIC_NAME = 'Гук без музыкі (для запісу)';
/** Што крыніца плагіна не захоплівае: Spotify і праслухоўванне OBS (`obs64.exe`). */
export const NO_MUSIC_EXCLUDE = ['Spotify.exe', 'obs64.exe'];
/**
 * Праграма, праз якую граюць браўзерныя крыніцы OBS без «Управлять звуком через OBS» (у т. л. оверлэй).
 * Яе выключаем з запісу, калі стрымер слухае відэа так, а не праз OBS.
 */
export const OBS_BROWSER_EXE = 'obs-browser-page.exe';

export type ServiceKind = 'twitch' | 'custom' | 'other';

export interface OutputConfig {
  service: ServiceKind;
  mode: 'simple' | 'advanced';
  /** «Простой»: «Включить дополнительные настройки кодировщика» — без іх дарожкі VOD няма. */
  simpleAdvanced: boolean;
  /** Галачка «Дорожка Twitch VOD» у бягучым рэжыме вываду. */
  vodEnabled: boolean;
  /** Дарожка эфіру і дарожка запісу (1…6). У «Простом» — заўсёды 1 і 2. */
  liveTrack: number;
  vodTrack: number;
  /** Ідзе трансляцыя: налады вываду пачнуць дзейнічаць з наступнага запуску. */
  streaming: boolean;
}

export type InputRole =
  /** Увесь гук прылады («Звук рабочего стола») або плагін без Spotify у спісе выключэнняў — у ім ёсць Spotify. */
  | 'desktop'
  /** Захоп самой праграмы Spotify. */
  | 'spotify'
  /** Крыніца з оверлэем бота (гук відэа YouTube). */
  | 'overlay'
  /** Крыніца плагіна «усё, акрамя Spotify». */
  | 'no-music';

export interface AudioInput {
  name: string;
  role: InputRole;
  tracks: Tracks;
  muted: boolean;
  /** Уключана праслухоўванне («Мониторинг аудио»). */
  monitored: boolean;
  /** Ёсць у бягучай сцэне (без гэтага OBS яе гук не змешвае). */
  active: boolean;
  /** Оверлэй: «Управлять звуком через OBS». */
  reroute?: boolean;
  /** Крыніца плагіна не захоплівае праслухоўванне OBS (арыгінальны плагін з `obs64.exe` у спісе). */
  excludesObs?: boolean;
  /** Крыніца плагіна не захоплівае браўзерныя крыніцы OBS без «Управлять звуком через OBS». */
  excludesBrowser?: boolean;
  /** Крыніца плагіна: спіс праграм, якія яна выключае. */
  executables?: string[];
}

export interface VodSnapshot {
  output: OutputConfig;
  inputs: AudioInput[];
  /** Плагін win-capture-audio усталяваны. */
  pluginAvailable: boolean;
  /**
   * Які плагін: арыгінал (bozbez) выключае праграмы па назве — і праслухоўванне OBS (`obs64.exe`);
   * форк (Ayrton09) выключае Spotify сродкамі Windows і праслухоўванне OBS захоплівае.
   */
  pluginVariant: PluginVariant | null;
  scenes: string[];
  /** Іншыя браўзерныя крыніцы без «Управлять звуком через OBS» (абвесткі і г. д.): іх гук ідзе праз Windows. */
  browserSources: string[];
}

export type Verdict = 'safe' | 'leak' | 'unknown';
export type PluginVariant = 'original' | 'fork';

export type VodReason =
  | { code: 'not-twitch' }
  | { code: 'custom-server' }
  | { code: 'output-off' }
  | { code: 'same-track' }
  | { code: 'desktop-in-vod'; source: string }
  | { code: 'spotify-in-vod'; source: string }
  | { code: 'overlay-in-vod'; source: string }
  /** Оверлэй без «Управлять звуком через OBS»: відэа грае праз Windows і трапляе туды ж, куды «Звук рабочего стола». */
  | { code: 'overlay-windows'; source: string }
  /** Праслухоўванне праз OBS: гук трапляе ў крыніцу плагіна або «Звук рабочего стола». */
  | { code: 'monitored'; source: string }
  | { code: 'no-plugin' }
  | { code: 'no-music-inactive'; source: string }
  | { code: 'no-overlay' }
  /** Крыніца плагіна выключае браўзер OBS — гук гэтых браўзерных крыніц таксама не трапіць у запіс. */
  | { code: 'browser-excluded'; source: string }
  | { code: 'streaming' };

export interface VodReport {
  spotify: Verdict;
  video: Verdict;
  liveTrack: number;
  vodTrack: number;
  /** Дарожка запісу ўключана ў наладах вываду. */
  vodEnabled: boolean;
  reasons: VodReason[];
}

const has = (tracks: Tracks, n: number) => tracks[n - 1] === true;
const playing = (i: AudioInput) => !i.muted;

/** Што трапіць у запіс стрыму і чаму. */
export function analyzeVod(s: VodSnapshot): VodReport {
  const { output } = s;
  const base = { liveTrack: output.liveTrack, vodTrack: output.vodTrack, vodEnabled: false };
  if (output.service === 'other') return { ...base, spotify: 'unknown', video: 'unknown', reasons: [{ code: 'not-twitch' }] };
  if (output.service === 'custom') return { ...base, spotify: 'unknown', video: 'unknown', reasons: [{ code: 'custom-server' }] };

  const reasons: VodReason[] = [];
  const sameTrack = output.mode === 'advanced' && output.vodTrack === output.liveTrack;
  const vodEnabled = output.vodEnabled && (output.mode === 'advanced' || output.simpleAdvanced) && !sameTrack;
  if (!vodEnabled) {
    // Без асобнай дарожкі ў запісе ўсё тое ж, што ў эфіры.
    reasons.push({ code: sameTrack && output.vodEnabled ? 'same-track' : 'output-off' });
    const overlay = s.inputs.some((i) => i.role === 'overlay');
    return { ...base, spotify: 'leak', video: overlay ? 'leak' : 'unknown', reasons };
  }

  const vod = output.vodTrack;
  const inVod = (i: AudioInput) => playing(i) && has(i.tracks, vod);
  let spotify: Verdict = 'safe';
  let video: Verdict = 'safe';
  const leak = (what: 'spotify' | 'video' | 'both', reason: VodReason) => {
    if (what !== 'video') spotify = 'leak';
    if (what !== 'spotify') video = 'leak';
    if (!reasons.some((r) => JSON.stringify(r) === JSON.stringify(reason))) reasons.push(reason);
  };

  const desktopInVod = s.inputs.filter((i) => i.role === 'desktop' && inVod(i));
  const noMusicInVod = s.inputs.filter((i) => i.role === 'no-music' && inVod(i));
  const overlays = s.inputs.filter((i) => i.role === 'overlay');

  for (const i of desktopInVod) leak('spotify', { code: 'desktop-in-vod', source: i.name });
  if (desktopInVod.length && !s.inputs.some((i) => i.role === 'no-music') && !s.pluginAvailable) reasons.push({ code: 'no-plugin' });
  for (const i of s.inputs) if (i.role === 'spotify' && inVod(i)) leak('spotify', { code: 'spotify-in-vod', source: i.name });

  // Праслухоўванне праз OBS іграе ў навушніках — гэта захопліваюць «Звук рабочего стола» і крыніца плагіна.
  const hearsObs = desktopInVod.length > 0 || noMusicInVod.some((i) => !i.excludesObs);
  for (const i of s.inputs) {
    if (!playing(i) || !i.monitored || !hearsObs) continue;
    if (i.role === 'spotify') leak('spotify', { code: 'monitored', source: i.name });
    if (i.role === 'overlay' && i.reroute) leak('video', { code: 'monitored', source: i.name });
  }

  if (!overlays.length) {
    video = 'unknown';
    reasons.push({ code: 'no-overlay' });
  }
  for (const i of overlays) {
    if (!playing(i)) continue;
    if (i.reroute) {
      if (has(i.tracks, vod)) leak('video', { code: 'overlay-in-vod', source: i.name });
    } else if (desktopInVod.length || noMusicInVod.some((n) => !n.excludesBrowser)) {
      leak('video', { code: 'overlay-windows', source: i.name });
    }
  }
  if (noMusicInVod.some((n) => n.excludesBrowser) && s.browserSources.length) {
    reasons.push({ code: 'browser-excluded', source: s.browserSources.join('», «') });
  }

  for (const i of noMusicInVod) if (!i.active) reasons.push({ code: 'no-music-inactive', source: i.name });
  if (output.streaming) reasons.push({ code: 'streaming' });
  return { spotify, video, liveTrack: output.liveTrack, vodTrack: vod, vodEnabled: true, reasons };
}

export type VodFixStep =
  | { type: 'enable-vod'; mode: 'simple' | 'advanced'; vodTrack: number; restart: boolean }
  | { type: 'create-no-music'; scenes: string[]; vodTrack: number; executables: string[] }
  /** Новы спіс праграм, якія не захоплівае крыніца плагіна. */
  | { type: 'exclusions'; source: string; executables: string[] }
  /** Оверлэй: гук праз OBS («Управлять звуком через OBS»), стрымер чуе яго праслухоўваннем, у запіс — не. */
  | { type: 'overlay-obs-audio'; source: string; tracks: Tracks }
  | { type: 'tracks'; source: string; role: InputRole; tracks: Tracks; vodTrack: number };

/** Што зменіць «Наладзіць». Праслухоўванне, «Управлять звуком через OBS» і іншыя крыніцы не чапаем. */
export function planVodFix(s: VodSnapshot): VodFixStep[] {
  const { output } = s;
  if (output.service !== 'twitch') return [];
  const steps: VodFixStep[] = [];

  let vod = output.mode === 'simple' ? 2 : output.vodTrack;
  let restart = false;
  if (output.mode === 'advanced' && vod === output.liveTrack) {
    vod = [2, 3, 4, 5, 6, 1].find((n) => n !== output.liveTrack)!;
    restart = true;
  }
  const enabled = output.vodEnabled && (output.mode === 'advanced' || output.simpleAdvanced);
  if (!enabled || restart) steps.push({ type: 'enable-vod', mode: output.mode, vodTrack: vod, restart });

  const setTrack = (i: AudioInput, n: number, on: boolean) => {
    const tracks = [...i.tracks];
    tracks[n - 1] = on;
    return tracks;
  };
  const change = (i: AudioInput, tracks: Tracks) => {
    if (tracks.some((t, n) => t !== i.tracks[n])) steps.push({ type: 'tracks', source: i.name, role: i.role, tracks, vodTrack: vod });
  };

  const noMusic = s.inputs.filter((i) => i.role === 'no-music');
  const willHaveNoMusic = noMusic.length > 0 || s.pluginAvailable;
  // Оверлэй без «Управлять звуком через OBS»: стрымер чуе відэа праз Windows.
  // Арыгінальны плагін: гук оверлэя — праз OBS і праслухоўванне, якое плагін не захоплівае; астатні гук браўзера застаецца ў запісе.
  // Форк праслухоўванне захоплівае — тады выключаем з запісу ўвесь браўзер OBS.
  const browserOverlays = s.inputs.filter((i) => i.role === 'overlay' && playing(i) && !i.reroute);
  const viaObs = s.pluginVariant === 'original' && willHaveNoMusic;
  const wanted = (current: string[]) => {
    const rest = current.filter((e) => !NO_MUSIC_EXCLUDE.some((x) => matches(e, x)) && !matches(e, OBS_BROWSER_EXE));
    const browser = !viaObs && browserOverlays.length > 0;
    return [...NO_MUSIC_EXCLUDE, ...rest, ...(browser || (!viaObs && current.some((e) => matches(e, OBS_BROWSER_EXE))) ? [OBS_BROWSER_EXE] : [])];
  };
  if (!noMusic.length && s.pluginAvailable && s.scenes.length) {
    steps.push({ type: 'create-no-music', scenes: s.scenes, vodTrack: vod, executables: wanted([]) });
  }
  for (const i of noMusic) {
    if (!i.executables) continue;
    const current = i.executables;
    const next = wanted(current);
    const same = next.length === current.length && next.every((e) => current.some((c) => c.toLowerCase() === e.toLowerCase()));
    if (!same) steps.push({ type: 'exclusions', source: i.name, executables: next });
  }
  if (viaObs) for (const i of browserOverlays) steps.push({ type: 'overlay-obs-audio', source: i.name, tracks: setTrack(i, vod, false) });
  // Калі «Звук рабочего стола» ўжо дае гук у эфір, крыніца плагіна ў эфіры падвоіла б гук.
  const desktopLive = s.inputs.some((i) => i.role === 'desktop' && playing(i) && has(i.tracks, output.liveTrack));
  for (const i of noMusic) {
    let tracks = setTrack(i, vod, true);
    if (desktopLive && vod !== output.liveTrack) tracks = setTrack({ ...i, tracks }, output.liveTrack, false);
    change(i, tracks);
  }
  for (const i of s.inputs) {
    if (!has(i.tracks, vod)) continue;
    if (viaObs && browserOverlays.includes(i)) continue;
    if (i.role === 'spotify' || i.role === 'overlay' || (i.role === 'desktop' && willHaveNoMusic)) change(i, setTrack(i, vod, false));
  }
  return steps;
}

// --- Чытанне з OBS ---

const isObject = (x: unknown): x is Record<string, any> => typeof x === 'object' && x !== null && !Array.isArray(x);
const bool = (v: unknown) => v === 'true' || v === '1' || v === true;
const int = (v: unknown, fallback: number) => {
  const n = typeof v === 'string' ? Number.parseInt(v, 10) : NaN;
  return n >= 1 && n <= TRACKS ? n : fallback;
};

/** Шаблон з плагіна (`League*.exe`) → праверка імя праграмы без уліку рэгістра. */
function matches(pattern: string, exe: string): boolean {
  const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
  return re.test(exe);
}

function executables(settings: Record<string, any>): string[] {
  const list = Array.isArray(settings.executable_list) ? settings.executable_list : [];
  return list.map((item: unknown) => (isObject(item) && typeof item.value === 'string' ? item.value : '')).filter(Boolean);
}

/** Роля крыніцы па яе відзе і наладах; `null` — крыніца не мае дачынення да музыкі. */
export function roleOf(kind: string, settings: Record<string, any>): InputRole | null {
  switch (kind) {
    case 'wasapi_output_capture':
      return 'desktop';
    case 'wasapi_process_output_capture':
      // Акно: «Загаловак:Клас:Spotify.exe».
      return typeof settings.window === 'string' && /:spotify\.exe$/i.test(settings.window) ? 'spotify' : null;
    case 'browser_source':
      return typeof settings.url === 'string' && MUSIC_OVERLAY_URL.test(settings.url) ? 'overlay' : null;
    case NO_MUSIC_KIND: {
      if ((settings.mode ?? 0) !== 0) return null;
      const spotify = executables(settings).some((p) => matches(p, 'Spotify.exe'));
      if (settings.exclude === true) return spotify ? 'no-music' : 'desktop';
      return spotify ? 'spotify' : null;
    }
    default:
      return null;
  }
}

function tracksFrom(raw: unknown): Tracks {
  const obj = isObject(raw) ? raw : {};
  return Array.from({ length: TRACKS }, (_, n) => obj[String(n + 1)] === true);
}

async function profile(obs: ObsCaller, category: string, name: string): Promise<string | null> {
  try {
    const res = await obs.call('GetProfileParameter', { parameterCategory: category, parameterName: name });
    return typeof res.parameterValue === 'string' ? res.parameterValue : null;
  } catch {
    return null;
  }
}

export async function readOutputConfig(obs: ObsCaller): Promise<OutputConfig> {
  const service = await obs.call('GetStreamServiceSettings');
  const type = String(service.streamServiceType ?? '');
  const settings = isObject(service.streamServiceSettings) ? service.streamServiceSettings : {};
  const kind: ServiceKind =
    type === 'rtmp_common' && String(settings.service ?? '').toLowerCase() === 'twitch'
      ? 'twitch'
      : type === 'rtmp_custom' && /twitch\.tv/i.test(String(settings.server ?? ''))
        ? 'custom'
        : 'other';
  const mode = (await profile(obs, 'Output', 'Mode'))?.toLowerCase() === 'advanced' ? 'advanced' : 'simple';
  let streaming = false;
  try {
    streaming = (await obs.call('GetStreamStatus')).outputActive === true;
  } catch {
    // Стан трансляцыі не абавязковы для праверкі.
  }
  if (mode === 'simple') {
    return {
      service: kind,
      mode,
      simpleAdvanced: bool(await profile(obs, 'SimpleOutput', 'UseAdvanced')),
      vodEnabled: bool(await profile(obs, 'SimpleOutput', 'VodTrackEnabled')),
      liveTrack: 1,
      vodTrack: 2,
      streaming,
    };
  }
  return {
    service: kind,
    mode,
    simpleAdvanced: false,
    vodEnabled: bool(await profile(obs, 'AdvOut', 'VodTrackEnabled')),
    liveTrack: int(await profile(obs, 'AdvOut', 'TrackIndex'), 1),
    vodTrack: int(await profile(obs, 'AdvOut', 'VodTrackIndex'), 2),
    streaming,
  };
}

/** Чытае ўсё, што патрэбна для праверкі: налады вываду, крыніцы з музыкай, плагін, сцэны. */
export async function readVodSnapshot(obs: ObsCaller): Promise<VodSnapshot> {
  const output = await readOutputConfig(obs);
  const list = await obs.call('GetInputList');
  const raw = Array.isArray(list.inputs) ? (list.inputs as Record<string, unknown>[]) : [];
  const inputs: AudioInput[] = [];
  const browserSources: string[] = [];
  for (const input of raw) {
    const name = String(input.inputName ?? '');
    const kind = String(input.unversionedInputKind ?? input.inputKind ?? '');
    if (!name || !['wasapi_output_capture', 'wasapi_process_output_capture', 'browser_source', NO_MUSIC_KIND].includes(kind)) continue;
    try {
      const settings = (await obs.call('GetInputSettings', { inputName: name })).inputSettings;
      const role = roleOf(kind, isObject(settings) ? settings : {});
      if (!role) {
        if (kind === 'browser_source' && !(isObject(settings) && settings.reroute_audio === true)) browserSources.push(name);
        continue;
      }
      const tracks = tracksFrom((await obs.call('GetInputAudioTracks', { inputName: name })).inputAudioTracks);
      const muted = (await obs.call('GetInputMute', { inputName: name })).inputMuted === true;
      const monitor = String((await obs.call('GetInputAudioMonitorType', { inputName: name })).monitorType ?? '');
      let active = true;
      try {
        active = (await obs.call('GetSourceActive', { sourceName: name })).videoActive !== false;
      } catch {
        // Старыя версіі obs-websocket — лічым, што крыніца ў сцэне.
      }
      const item: AudioInput = { name, role, tracks, muted, monitored: monitor !== '' && monitor !== 'OBS_MONITORING_TYPE_NONE', active };
      if (role === 'overlay') item.reroute = isObject(settings) && settings.reroute_audio === true;
      if (role === 'no-music') {
        const list = executables(settings as Record<string, any>);
        item.executables = list;
        item.excludesObs = list.some((p) => matches(p, 'obs64.exe'));
        item.excludesBrowser = list.some((p) => matches(p, OBS_BROWSER_EXE));
      }
      inputs.push(item);
    } catch {
      // Крыніца знікла, пакуль чыталі спіс, або ў яе няма гуку.
    }
  }
  let pluginAvailable = false;
  try {
    const kinds = (await obs.call('GetInputKindList', { unversioned: true })).inputKinds;
    pluginAvailable = Array.isArray(kinds) && kinds.includes(NO_MUSIC_KIND);
  } catch {
    // Без спісу відаў лічым, што плагіна няма.
  }
  let scenes: string[] = [];
  try {
    const res = await obs.call('GetSceneList');
    scenes = Array.isArray(res.scenes) ? (res.scenes as Record<string, unknown>[]).map((sc) => String(sc.sceneName ?? '')).filter(Boolean) : [];
  } catch {
    // Без сцэн крыніцу плагіна стварыць нельга.
  }
  const pluginVariant = pluginAvailable ? await pluginVariantOf(obs) : null;
  // Форк захоплівае праслухоўванне OBS, нават калі `obs64.exe` у спісе.
  if (pluginVariant !== 'original') for (const i of inputs) if (i.role === 'no-music') i.excludesObs = false;
  return { output, inputs, pluginAvailable, pluginVariant, scenes, browserSources };
}

/**
 * Форк плагіна (Ayrton09) пазнаём па наладзе «Задержка» (`latency`) сярод налад па змаўчанні — у арыгінале яе няма.
 * Не атрымалася прачытаць — лічым форкам (з ім праверка асцярожнейшая).
 */
async function pluginVariantOf(obs: ObsCaller): Promise<PluginVariant> {
  try {
    const res = await obs.call('GetInputDefaultSettings', { inputKind: NO_MUSIC_KIND });
    return isObject(res.defaultInputSettings) && 'latency' in res.defaultInputSettings ? 'fork' : 'original';
  } catch {
    return 'fork';
  }
}

// --- Змены ---

/** Спіс праграм у наладах плагіна — як яго захоўвае OBS (`editable_list`). */
const listSetting = (list: string[]) => list.map((value) => ({ value, selected: false, hidden: false }));

const tracksObject = (tracks: Tracks) => Object.fromEntries(tracks.map((on, n) => [String(n + 1), on]));

/** Выконвае крокі «Наладзіць» па чарзе. Памылка спыняе выкананне — астатняе пакажа наступная праверка. */
export async function applyVodFix(obs: ObsCaller, steps: VodFixStep[]): Promise<void> {
  for (const step of steps) {
    if (step.type === 'enable-vod') {
      const set = (category: string, name: string, value: string) =>
        obs.call('SetProfileParameter', { parameterCategory: category, parameterName: name, parameterValue: value });
      if (step.mode === 'simple') {
        await set('SimpleOutput', 'UseAdvanced', 'true');
        await set('SimpleOutput', 'VodTrackEnabled', 'true');
      } else {
        await set('AdvOut', 'VodTrackIndex', String(step.vodTrack));
        await set('AdvOut', 'VodTrackEnabled', 'true');
      }
    } else if (step.type === 'create-no-music') {
      const [first, ...rest] = step.scenes;
      await obs.call('CreateInput', {
        sceneName: first,
        inputName: NO_MUSIC_NAME,
        inputKind: NO_MUSIC_KIND,
        inputSettings: { mode: 0, exclude: true, executable_list: listSetting(step.executables) },
        sceneItemEnabled: true,
      });
      const tracks = Array.from({ length: TRACKS }, (_, n) => n + 1 === step.vodTrack);
      await obs.call('SetInputAudioTracks', { inputName: NO_MUSIC_NAME, inputAudioTracks: tracksObject(tracks) });
      for (const sceneName of rest) await obs.call('CreateSceneItem', { sceneName, sourceName: NO_MUSIC_NAME, sceneItemEnabled: true });
    } else if (step.type === 'exclusions') {
      await obs.call('SetInputSettings', { inputName: step.source, inputSettings: { executable_list: listSetting(step.executables) }, overlay: true });
    } else if (step.type === 'overlay-obs-audio') {
      await obs.call('SetInputSettings', { inputName: step.source, inputSettings: { reroute_audio: true }, overlay: true });
      await obs.call('SetInputAudioMonitorType', { inputName: step.source, monitorType: 'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT' });
      await obs.call('SetInputAudioTracks', { inputName: step.source, inputAudioTracks: tracksObject(step.tracks) });
    } else {
      await obs.call('SetInputAudioTracks', { inputName: step.source, inputAudioTracks: tracksObject(step.tracks) });
    }
  }
}
