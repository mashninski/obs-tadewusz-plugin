import { describe, expect, it } from 'vitest';
import type { ObsCaller } from './spotify-window';
import {
  analyzeVod,
  applyVodFix,
  NO_MUSIC_KIND,
  NO_MUSIC_NAME,
  OBS_BROWSER_EXE,
  planVodFix,
  readVodSnapshot,
  roleOf,
  type AudioInput,
  type OutputConfig,
  type VodSnapshot,
} from './vod-track';

const all = () => [true, true, true, true, true, true];
const only = (...n: number[]) => [1, 2, 3, 4, 5, 6].map((t) => n.includes(t));

const twitchSimple = (patch: Partial<OutputConfig> = {}): OutputConfig => ({
  service: 'twitch',
  mode: 'simple',
  simpleAdvanced: true,
  vodEnabled: true,
  liveTrack: 1,
  vodTrack: 2,
  streaming: false,
  ...patch,
});

const input = (name: string, role: AudioInput['role'], patch: Partial<AudioInput> = {}): AudioInput => ({
  name,
  role,
  tracks: all(),
  muted: false,
  monitored: false,
  active: true,
  ...(role === 'overlay' ? { reroute: true } : {}),
  ...patch,
});

const snap = (output: OutputConfig, inputs: AudioInput[], patch: Partial<VodSnapshot> = {}): VodSnapshot => ({
  output,
  inputs,
  pluginAvailable: false,
  pluginVariant: null,
  scenes: ['Гульня', 'Чат'],
  browserSources: [],
  ...patch,
});

/** Добра наладжаны OBS: эфір — «Звук рабочего стола» і оверлэй, запіс — крыніца плагіна. */
const goodInputs = () => [
  input('Звук рабочего стола', 'desktop', { tracks: only(1) }),
  input('Оверлэй', 'overlay', { tracks: only(1) }),
  input(NO_MUSIC_NAME, 'no-music', { tracks: only(2), excludesObs: true }),
];

describe('запіс стрыму без музыкі: праверка', () => {
  it('добра наладжаны OBS — ні Spotify, ні відэа ў запіс не трапяць', () => {
    const report = analyzeVod(snap(twitchSimple(), goodInputs()));
    expect(report).toMatchObject({ spotify: 'safe', video: 'safe', liveTrack: 1, vodTrack: 2, vodEnabled: true });
    expect(report.reasons).toEqual([]);
  });

  it('дарожка VOD выключана — у запісе ўсё, як у эфіры', () => {
    const report = analyzeVod(snap(twitchSimple({ vodEnabled: false }), goodInputs()));
    expect(report).toMatchObject({ spotify: 'leak', video: 'leak', vodEnabled: false });
    expect(report.reasons).toEqual([{ code: 'output-off' }]);
    // «Простой» без дадатковых налад кадыроўшчыка — галачкі VOD у OBS няма зусім.
    expect(analyzeVod(snap(twitchSimple({ simpleAdvanced: false }), goodInputs())).reasons).toEqual([{ code: 'output-off' }]);
  });

  it('як у аўтара 2026-10-19: оверлэй праз Windows — дапоўніць спіс выключэнняў браўзерам OBS', () => {
    const inputs = [
      input('Звук рабочего стола', 'desktop', { tracks: only(1) }),
      input('music', 'overlay', { reroute: false, tracks: only(1) }),
      input(NO_MUSIC_NAME, 'no-music', { tracks: only(2), executables: ['Spotify.exe', 'obs64.exe'] }),
    ];
    const fork = { pluginAvailable: true, pluginVariant: 'fork' as const };
    expect(planVodFix(snap(twitchSimple(), inputs, fork))).toEqual([
      { type: 'exclusions', source: NO_MUSIC_NAME, executables: ['Spotify.exe', 'obs64.exe', OBS_BROWSER_EXE] },
    ]);
    // Новая крыніца адразу без браўзера OBS.
    const fresh = planVodFix(snap(twitchSimple(), inputs.slice(0, 2), fork));
    expect(fresh).toContainEqual({ type: 'create-no-music', scenes: ['Гульня', 'Чат'], vodTrack: 2, executables: ['Spotify.exe', 'obs64.exe', OBS_BROWSER_EXE] });
  });

  it('арыгінальны плагін: оверлэй — праз OBS з праслухоўваннем, браўзер OBS — назад у запіс (абвесткі)', () => {
    const inputs = [
      input('Звук рабочего стола', 'desktop', { tracks: only(1) }),
      input('music', 'overlay', { reroute: false, tracks: only(1, 2) }),
      input(NO_MUSIC_NAME, 'no-music', { tracks: only(2), executables: ['Spotify.exe', 'obs64.exe', OBS_BROWSER_EXE, 'Game.exe'] }),
    ];
    expect(planVodFix(snap(twitchSimple(), inputs, { pluginAvailable: true, pluginVariant: 'original' }))).toEqual([
      { type: 'exclusions', source: NO_MUSIC_NAME, executables: ['Spotify.exe', 'obs64.exe', 'Game.exe'] },
      { type: 'overlay-obs-audio', source: 'music', tracks: only(1) },
    ]);
    // Пасля «Наладзіць»: оверлэй праз OBS і праслухоўваецца, плагін праслухоўванне не захоплівае — гук відэа не трапіць.
    const after = [
      inputs[0],
      input('music', 'overlay', { reroute: true, monitored: true, tracks: only(1) }),
      input(NO_MUSIC_NAME, 'no-music', { tracks: only(2), excludesObs: true }),
    ];
    expect(analyzeVod(snap(twitchSimple(), after))).toMatchObject({ spotify: 'safe', video: 'safe', reasons: [] });
  });

  it('«Расширенный» з аднолькавымі дарожкамі эфіру і запісу — OBS дарожку не дадае', () => {
    const output = twitchSimple({ mode: 'advanced', simpleAdvanced: false, liveTrack: 2, vodTrack: 2 });
    expect(analyzeVod(snap(output, goodInputs())).reasons).toEqual([{ code: 'same-track' }]);
  });

  it('не Twitch або ўласны сервер — невядома', () => {
    expect(analyzeVod(snap(twitchSimple({ service: 'other' }), goodInputs()))).toMatchObject({ spotify: 'unknown', reasons: [{ code: 'not-twitch' }] });
    expect(analyzeVod(snap(twitchSimple({ service: 'custom' }), goodInputs())).reasons).toEqual([{ code: 'custom-server' }]);
  });

  it('«Звук рабочего стола» на дарожцы запісу — Spotify трапіць; без плагіна — падказка пра плагін', () => {
    const report = analyzeVod(snap(twitchSimple(), [input('Звук рабочего стола', 'desktop'), input('Оверлэй', 'overlay', { tracks: only(1) })]));
    expect(report.spotify).toBe('leak');
    expect(report.video).toBe('safe');
    expect(report.reasons).toEqual([{ code: 'desktop-in-vod', source: 'Звук рабочего стола' }, { code: 'no-plugin' }]);
  });

  it('выключаны (mute) «Звук рабочего стола» не лічыцца', () => {
    const inputs = [input('Звук рабочего стола', 'desktop', { muted: true }), input('Оверлэй', 'overlay', { tracks: only(1) })];
    expect(analyzeVod(snap(twitchSimple(), inputs)).spotify).toBe('safe');
  });

  it('захоп Spotify і оверлэй на дарожцы запісу', () => {
    const inputs = [...goodInputs(), input('Spotify', 'spotify', { tracks: only(1, 2) })];
    inputs[1] = input('Оверлэй', 'overlay');
    const report = analyzeVod(snap(twitchSimple(), inputs));
    expect(report).toMatchObject({ spotify: 'leak', video: 'leak' });
    expect(report.reasons).toEqual([
      { code: 'spotify-in-vod', source: 'Spotify' },
      { code: 'overlay-in-vod', source: 'Оверлэй' },
    ]);
  });

  it('оверлэй без «Управлять звуком через OBS» — відэа ідзе праз Windows у крыніцу плагіна', () => {
    const inputs = goodInputs();
    inputs[1] = input('Оверлэй', 'overlay', { reroute: false, tracks: only(1) });
    expect(analyzeVod(snap(twitchSimple(), inputs))).toMatchObject({ video: 'leak', reasons: [{ code: 'overlay-windows', source: 'Оверлэй' }] });
  });

  it('оверлэй грае праз Windows, а крыніца плагіна не захоплівае браўзер OBS — гук відэа не трапіць', () => {
    const inputs = goodInputs();
    inputs[1] = input('Оверлэй', 'overlay', { reroute: false, tracks: only(1) });
    inputs[2] = { ...inputs[2], excludesBrowser: true };
    const report = analyzeVod(snap(twitchSimple(), inputs, { browserSources: ['Абвесткі', 'Чат'] }));
    expect(report).toMatchObject({ spotify: 'safe', video: 'safe' });
    expect(report.reasons).toEqual([{ code: 'browser-excluded', source: 'Абвесткі», «Чат' }]);
  });

  it('праслуханы оверлэй: форк плагіна захоплівае праслухоўванне OBS, арыгінал з obs64.exe — не', () => {
    const fork = goodInputs();
    fork[1] = input('Оверлэй', 'overlay', { tracks: only(1), monitored: true });
    fork[2] = input(NO_MUSIC_NAME, 'no-music', { tracks: only(2), excludesObs: false });
    expect(analyzeVod(snap(twitchSimple(), fork))).toMatchObject({ spotify: 'safe', video: 'leak', reasons: [{ code: 'monitored', source: 'Оверлэй' }] });

    const original = goodInputs();
    original[1] = input('Оверлэй', 'overlay', { tracks: only(1), monitored: true });
    expect(analyzeVod(snap(twitchSimple(), original)).video).toBe('safe');
  });

  it('крыніца плагіна не ў бягучай сцэне і ідзе трансляцыя — заўвагі без «трапіць»', () => {
    const inputs = goodInputs();
    inputs[2] = { ...inputs[2], active: false };
    const report = analyzeVod(snap(twitchSimple({ streaming: true }), inputs));
    expect(report).toMatchObject({ spotify: 'safe', video: 'safe' });
    expect(report.reasons).toEqual([{ code: 'no-music-inactive', source: NO_MUSIC_NAME }, { code: 'streaming' }]);
  });

  it('оверлэя няма — пра відэа невядома', () => {
    expect(analyzeVod(snap(twitchSimple(), [goodInputs()[0], goodInputs()[2]]))).toMatchObject({ spotify: 'safe', video: 'unknown', reasons: [{ code: 'no-overlay' }] });
  });
});

describe('запіс стрыму без музыкі: «Наладзіць»', () => {
  /** Як у аўтара: усё на ўсіх дарожках, дарожка VOD выключана. */
  const asNow = () => [
    input('Звук рабочего стола', 'desktop'),
    input('Мік', 'desktop', { muted: true }),
    input('Оверлэй', 'overlay'),
    input('Spotify', 'spotify', { tracks: only() }),
  ];

  it('з плагінам: уключыць VOD, стварыць крыніцу ва ўсіх сцэнах, прыбраць музыку з дарожкі запісу', () => {
    const steps = planVodFix(snap(twitchSimple({ simpleAdvanced: false, vodEnabled: false }), asNow(), { pluginAvailable: true }));
    expect(steps).toEqual([
      { type: 'enable-vod', mode: 'simple', vodTrack: 2, restart: false },
      { type: 'create-no-music', scenes: ['Гульня', 'Чат'], vodTrack: 2, executables: ['Spotify.exe', 'obs64.exe'] },
      { type: 'tracks', source: 'Звук рабочего стола', role: 'desktop', tracks: [true, false, true, true, true, true], vodTrack: 2 },
      { type: 'tracks', source: 'Мік', role: 'desktop', tracks: [true, false, true, true, true, true], vodTrack: 2 },
      { type: 'tracks', source: 'Оверлэй', role: 'overlay', tracks: [true, false, true, true, true, true], vodTrack: 2 },
    ]);
  });

  it('без плагіна «Звук рабочего стола» застаецца ў запісе (інакш прапала б усё астатняе)', () => {
    const steps = planVodFix(snap(twitchSimple({ vodEnabled: false }), asNow()));
    expect(steps.map((s) => (s.type === 'tracks' ? s.source : s.type))).toEqual(['enable-vod', 'Оверлэй']);
  });

  it('існуючая крыніца плагіна: на дарожку запісу і прэч з эфіру, калі эфір дае «Звук рабочего стола»', () => {
    const inputs = [input('Звук рабочего стола', 'desktop', { tracks: only(1) }), input('Без Spotify', 'no-music', { tracks: only(1) })];
    expect(planVodFix(snap(twitchSimple(), inputs))).toEqual([{ type: 'tracks', source: 'Без Spotify', role: 'no-music', tracks: only(2), vodTrack: 2 }]);
  });

  it('«Расширенный» з аднолькавымі дарожкамі — наступная вольная і перазапуск OBS', () => {
    const output = twitchSimple({ mode: 'advanced', simpleAdvanced: false, liveTrack: 2, vodTrack: 2 });
    expect(planVodFix(snap(output, goodInputs()))[0]).toEqual({ type: 'enable-vod', mode: 'advanced', vodTrack: 3, restart: true });
  });

  it('усё ўжо наладжана або не Twitch — рабіць няма чаго', () => {
    expect(planVodFix(snap(twitchSimple(), goodInputs()))).toEqual([]);
    expect(planVodFix(snap(twitchSimple({ service: 'other', vodEnabled: false }), asNow()))).toEqual([]);
  });
});

describe('запіс стрыму без музыкі: ролі крыніц', () => {
  it('па відзе і наладах', () => {
    expect(roleOf('wasapi_output_capture', {})).toBe('desktop');
    expect(roleOf('wasapi_process_output_capture', { window: 'Spotify Premium:Chrome_WidgetWin_0:Spotify.exe' })).toBe('spotify');
    expect(roleOf('wasapi_process_output_capture', { window: 'Discord:Chrome_WidgetWin_1:Discord.exe' })).toBeNull();
    expect(roleOf('browser_source', { url: 'http://127.0.0.1:18745/music.html' })).toBe('overlay');
    expect(roleOf('browser_source', { url: 'https://streamelements.com/overlay/1' })).toBeNull();
    const list = (...v: string[]) => v.map((value) => ({ value, selected: false, hidden: false }));
    expect(roleOf(NO_MUSIC_KIND, { exclude: true, executable_list: list('spotify.exe', 'obs64.exe') })).toBe('no-music');
    expect(roleOf(NO_MUSIC_KIND, { exclude: true, executable_list: list('Spot*.exe') })).toBe('no-music');
    expect(roleOf(NO_MUSIC_KIND, { exclude: true, executable_list: list('Discord.exe') })).toBe('desktop');
    expect(roleOf(NO_MUSIC_KIND, { executable_list: list('Spotify.exe') })).toBe('spotify');
    expect(roleOf(NO_MUSIC_KIND, { mode: 1, executable_list: list('Spotify.exe') })).toBeNull();
  });
});

/** Падробны OBS: адказы на запыты і спіс выкліканых змен. */
function fakeObs() {
  const changes: [string, Record<string, unknown> | undefined][] = [];
  const profile: Record<string, string> = { 'Output/Mode': 'Simple', 'SimpleOutput/UseAdvanced': 'false' };
  const inputs: Record<string, { kind: string; settings: Record<string, unknown>; tracks: Record<string, boolean>; monitor?: string; muted?: boolean }> = {
    'Звук рабочего стола': { kind: 'wasapi_output_capture', settings: {}, tracks: { 1: true, 2: true, 3: true, 4: true, 5: true, 6: true } },
    Мікрафон: { kind: 'wasapi_input_capture', settings: {}, tracks: { 1: true, 2: true } },
    Оверлэй: {
      kind: 'browser_source',
      settings: { url: 'http://127.0.0.1:18745/music.html', reroute_audio: true },
      tracks: { 1: true, 2: true },
      monitor: 'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT',
    },
    Абвесткі: { kind: 'browser_source', settings: { url: 'https://streamelements.com/overlay/x' }, tracks: { 1: true, 2: true } },
  };
  const obs: ObsCaller = {
    async call(type, data = {}) {
      const name = String(data.inputName ?? data.sourceName ?? '');
      switch (type) {
        case 'GetStreamServiceSettings':
          return { streamServiceType: 'rtmp_common', streamServiceSettings: { service: 'Twitch', key: 'не друкуецца' } };
        case 'GetProfileParameter': {
          const value = profile[`${data.parameterCategory}/${data.parameterName}`];
          return { parameterValue: value ?? null, defaultParameterValue: null };
        }
        case 'GetStreamStatus':
          return { outputActive: false };
        case 'GetInputList':
          return { inputs: Object.entries(inputs).map(([inputName, i]) => ({ inputName, inputKind: i.kind, unversionedInputKind: i.kind })) };
        case 'GetInputSettings':
          return { inputSettings: inputs[name].settings };
        case 'GetInputAudioTracks':
          return { inputAudioTracks: inputs[name].tracks };
        case 'GetInputMute':
          return { inputMuted: inputs[name].muted === true };
        case 'GetInputAudioMonitorType':
          return { monitorType: inputs[name].monitor ?? 'OBS_MONITORING_TYPE_NONE' };
        case 'GetSourceActive':
          return { videoActive: true, videoShowing: true };
        case 'GetInputKindList':
          return { inputKinds: ['browser_source', NO_MUSIC_KIND] };
        case 'GetSceneList':
          return { scenes: [{ sceneName: 'Чат' }, { sceneName: 'Гульня' }] };
        case 'GetInputDefaultSettings':
          return { defaultInputSettings: { mode: 0, exclude: false, latency: 0 } };
        default:
          changes.push([type, data]);
          return {};
      }
    },
  };
  return { obs, changes };
}

describe('запіс стрыму без музыкі: OBS', () => {
  it('оверлэй праз OBS: «Управлять звуком через OBS», праслухоўванне і дарожкі', async () => {
    const { obs, changes } = fakeObs();
    await applyVodFix(obs, [{ type: 'overlay-obs-audio', source: 'Оверлэй', tracks: only(1) }]);
    expect(changes).toEqual([
      ['SetInputSettings', { inputName: 'Оверлэй', inputSettings: { reroute_audio: true }, overlay: true }],
      ['SetInputAudioMonitorType', { inputName: 'Оверлэй', monitorType: 'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT' }],
      ['SetInputAudioTracks', { inputName: 'Оверлэй', inputAudioTracks: { 1: true, 2: false, 3: false, 4: false, 5: false, 6: false } }],
    ]);
  });

  it('дапаўненне спісу выключэнняў захоўвае ўжо выбраныя праграмы', async () => {
    const { obs, changes } = fakeObs();
    await applyVodFix(obs, [{ type: 'exclusions', source: NO_MUSIC_NAME, executables: ['Spotify.exe', OBS_BROWSER_EXE] }]);
    expect(changes).toEqual([
      [
        'SetInputSettings',
        {
          inputName: NO_MUSIC_NAME,
          inputSettings: { executable_list: [{ value: 'Spotify.exe', selected: false, hidden: false }, { value: OBS_BROWSER_EXE, selected: false, hidden: false }] },
          overlay: true,
        },
      ],
    ]);
  });

  it('чытае налады і крыніцы, «Наладзіць» дае патрэбныя запыты', async () => {
    const { obs, changes } = fakeObs();
    const snapshot = await readVodSnapshot(obs);
    expect(snapshot.output).toMatchObject({ service: 'twitch', mode: 'simple', simpleAdvanced: false, vodEnabled: false, liveTrack: 1, vodTrack: 2 });
    expect(snapshot.inputs.map((i) => [i.name, i.role])).toEqual([
      ['Звук рабочего стола', 'desktop'],
      ['Оверлэй', 'overlay'],
    ]);
    expect(snapshot.inputs[1]).toMatchObject({ reroute: true, monitored: true, tracks: only(1, 2) });
    expect(snapshot).toMatchObject({ pluginAvailable: true, pluginVariant: 'fork', scenes: ['Чат', 'Гульня'], browserSources: ['Абвесткі'] });

    await applyVodFix(obs, planVodFix(snapshot));
    expect(changes.map(([type, d]) => [type, d?.parameterName ?? d?.inputName ?? d?.sceneName])).toEqual([
      ['SetProfileParameter', 'UseAdvanced'],
      ['SetProfileParameter', 'VodTrackEnabled'],
      ['CreateInput', NO_MUSIC_NAME],
      ['SetInputAudioTracks', NO_MUSIC_NAME],
      ['CreateSceneItem', 'Гульня'],
      ['SetInputAudioTracks', 'Звук рабочего стола'],
      ['SetInputAudioTracks', 'Оверлэй'],
    ]);
    expect(changes[2][1]).toMatchObject({
      sceneName: 'Чат',
      inputKind: NO_MUSIC_KIND,
      inputSettings: { mode: 0, exclude: true, executable_list: [{ value: 'Spotify.exe' }, { value: 'obs64.exe' }] },
    });
    expect(changes[3][1]?.inputAudioTracks).toEqual({ 1: false, 2: true, 3: false, 4: false, 5: false, 6: false });
    expect(changes[6][1]?.inputAudioTracks).toEqual({ 1: true, 2: false, 3: false, 4: false, 5: false, 6: false });
  });
});
