// «Сістэма → Падключэнне»: усе ўваходы праграмы аднолькавымі карткамі — Twitch, OBS, Spotify, YouTube, Steam.
// Як працуе праграма (падзеі, зверка, копіі) — у раздзеле «Стан».
import { useEffect, useState } from 'preact/hooks';
import type { DockController } from '../music/ui/dock/controller';
import { musicProblem, SpotifyConnection, YouTubeConnection } from '../music/ui/dock/MusicSettings';
import { useStore } from '../music/ui/shared/hooks';
import { api, errorText, refresh, run, type CoreState } from './core';
import { Row, ServiceCard, Switch, TextField, toast, type Tone } from './ui';

type Flow = { uri: string; code: string };

export function ConnectionsSection({ state, music }: { state: CoreState; music: DockController }) {
  return (
    <>
      <TwitchConnection state={state} music={music} />
      <ObsConnection state={state} music={music} />
      <SpotifyConnection controller={music} />
      <YouTubeConnection controller={music} />
      <SteamConnection state={state} />
    </>
  );
}

/** Уваход па кодзе (Device Code Flow): док паказвае код і пытае ядро, ці пацвердзіў стрымер уваход. */
function useDeviceFlow<T>(pollPath: string, done: (result: T) => boolean, success: string) {
  const [flow, setFlow] = useState<Flow | null>(null);
  useEffect(() => {
    if (!flow) return;
    const id = setInterval(async () => {
      try {
        if (done(await api<T>(pollPath))) {
          setFlow(null);
          toast(success);
          refresh();
        }
      } catch (error) {
        setFlow(null);
        toast(errorText(error), true);
      }
    }, 3000);
    return () => clearInterval(id);
  }, [flow]);
  const start = (begin: () => Promise<Flow>) => run(async () => {
    const next = await begin();
    setFlow(next);
    window.open(next.uri, '_blank');
  }, '');
  return { flow, start, cancel: () => setFlow(null) };
}

function DeviceCode({ flow }: { flow: Flow }) {
  return (
    <div class="inline">
      <div class="grow">
        <div class="device-code">{flow.code}</div>
        <div class="hint" style={{ marginTop: 0 }}>Пацвердзіце код на старонцы Twitch — док чакае</div>
      </div>
      <button class="btn primary" onClick={() => window.open(flow.uri, '_blank')}>Адкрыць Twitch</button>
    </div>
  );
}

function TwitchConnection({ state, music }: { state: CoreState; music: DockController }) {
  const [clientId, setClientId] = useState(state.settings.twitch.clientId);
  const login = useDeviceFlow<{ connected?: boolean }>('/api/twitch/poll', (r) => !!r.connected, 'Twitch падключаны');
  const musicTwitch = useStore(music.twitch);
  const twitch = state.twitch;
  const connected = twitch.state === 'connected';

  const tone: Tone = connected ? (state.eventsub === 'connected' ? 'good' : 'wait') : twitch.state === 'connecting' ? 'wait' : twitch.error ? 'bad' : 'off';
  const detail = connected
    ? `${twitch.login} · ${state.eventsub === 'connected' ? 'падзеі ідуць' : 'падключэнне падзей…'}`
    : twitch.error === 'login_expired' ? 'Уваход больш не дзейнічае — увайдзіце зноў'
      : twitch.state === 'error' ? `Няма сувязі (${twitch.error}), спрабую зноў…`
        : 'Не падключаны';
  const musicTrouble = connected && (musicTwitch.status === 'error' || !!musicTwitch.problem);

  const action = connected
    ? <button class="btn ghost" onClick={() => confirm('Адключыць Twitch? Усе ўзнагароды праграмы стануць на паўзу, пакуль вы не ўвайдзеце зноў.')
        && run(() => api('/api/twitch/disconnect'), 'Twitch адключаны')}>Адключыць</button>
    : login.flow
      ? <button class="btn" onClick={login.cancel}>Скасаваць</button>
      : <button class="btn primary" disabled={!/^[a-z0-9]{20,40}$/i.test(clientId)} onClick={() => void login.start(async () => {
          if (clientId !== state.settings.twitch.clientId) await api('/api/settings', { ...state.settings, twitch: { ...state.settings.twitch, clientId } });
          return api<Flow>('/api/twitch/login');
        })}>Увайсці</button>;

  return (
    <ServiceCard name="Twitch" tone={tone} detail={detail} action={action}
      help={'Адзін уваход для ўсяго: галасаванне, бягучы радок і замовы музыкі.\n\n1. Устаўце Client ID свайго прыкладання з dev.twitch.tv/console (тып Public)\n2. Націсніце «Увайсці»: адкрыецца twitch.tv/activate\n3. Увайдзіце пад акаўнтам канала і пацвердзіце код\n\nУваход дзейнічае, пакуль вы адкрываеце OBS хоць бы раз на 30 дзён.'}>
      {!connected ? (
        login.flow ? <DeviceCode flow={login.flow} /> : <TextField label="Client ID" value={clientId} onChange={(v) => setClientId(v.trim())} />
      ) : musicTrouble || state.legacyMusicRewards ? (
        <div class="stack">
          {musicTrouble && <p class="hint bad" style={{ margin: 0 }}>Узнагароды музыкі: {musicProblem(musicTwitch.problem)}</p>}
          {state.legacyMusicRewards && <LegacyMusicRewards />}
        </div>
      ) : null}
    </ServiceCard>
  );
}

/**
 * Аднаразова пры пераездзе: старыя ўзнагароды музыкі створаны іншым Twitch-прыкладаннем (spotify-бот),
 * таму выдаліць іх можна толькі ўваходам пад тым жа Client ID.
 */
function LegacyMusicRewards() {
  const login = useDeviceFlow<{ removed?: number }>('/api/music/legacy/poll', (r) => r.removed !== undefined, 'Старыя ўзнагароды выдалены');
  return (
    <div class="stack">
      <p class="hint" style={{ margin: 0 }}>У канале засталіся ўзнагароды музыкі ад ранейшага spotify-бота. Іх можа выдаліць толькі тое прыкладанне: увайдзіце праз яго адзін раз — праграма выдаліць іх (балы за незавершаныя замовы вернуцца) і створыць новыя.</p>
      {login.flow ? <DeviceCode flow={login.flow} /> : (
        <div class="actions">
          <button class="btn" onClick={() => void login.start(() => api<Flow>('/api/music/legacy/start'))}>Выдаліць старыя ўзнагароды</button>
        </div>
      )}
    </div>
  );
}

function ObsConnection({ state, music }: { state: CoreState; music: DockController }) {
  const [url, setUrl] = useState(state.settings.obs.url);
  const [password, setPassword] = useState('');
  const obs = state.obs;
  const detail = obs.connected ? (obs.streaming ? 'Падключаны · эфір ідзе' : 'Падключаны') : obs.error === 'obs_password' ? 'Пароль не падыходзіць' : 'Не падключаны';
  return (
    <ServiceCard name="OBS" tone={obs.connected ? 'good' : 'bad'} detail={detail} collapsible open={!obs.connected}
      action={<button class="btn" onClick={() => run(async () => { await api('/api/obs/reconnect'); music.connectObs(); }, 'Падключаюся да OBS')}>Перападключыць</button>}
      help={'Праграма падключаецца да obs-websocket, каб бачыць эфір, бягучы радок у сцэне і гук для хвалі музыкі.\n\nУ OBS: Інструменты → Налады WebSocket-сервера → Уключыць. Пароль адтуль упішыце тут.'}>
      <form class="fields wide" onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          if (url !== state.settings.obs.url) await api('/api/settings', { ...state.settings, obs: { url } });
          if (password) await api('/api/secret', { key: 'obsPassword', value: password });
          setPassword('');
          music.connectObs();
        }, 'Захавана · падключаюся да OBS');
      }}>
        <TextField label="Адрас obs-websocket" value={url} onChange={(v) => setUrl(v.trim())} />
        <div class="field">
          <span>Пароль</span>
          <div class="copy-row">
            <input type="password" value={password} placeholder="не змяняць" autocomplete="off" onInput={(e) => setPassword(e.currentTarget.value)} />
            <button class="btn primary" disabled={url === state.settings.obs.url && !password}>Захаваць</button>
          </div>
        </div>
      </form>
    </ServiceCard>
  );
}

function SteamConnection({ state }: { state: CoreState }) {
  const [key, setKey] = useState('');
  const [query, setQuery] = useState('');
  const [apps, setApps] = useState<{ appId: number; title: string }[]>([]);
  const steam = state.settings.steam;
  const save = (patch: Partial<typeof steam>) => run(() => api('/api/settings', { ...state.settings, steam: { ...steam, ...patch } }), 'Захавана');
  return (
    <ServiceCard name="Steam" tone={steam.steamId ? 'good' : 'off'} collapsible
      detail={steam.steamId ? `SteamID ${steam.steamId}` : 'Неабавязкова · гульні па спасылцы і праверка бібліятэкі'}
      action={<button class="btn" onClick={() => run(async () => { location.href = (await api<{ uri: string }>('/api/steam/login')).uri; }, '')}>{steam.steamId ? 'Змяніць' : 'Увайсці'}</button>}
      help="Steam дапамагае дадаваць гульні па спасылцы на краму і пазначаць, якія гульні ёсць у вашай бібліятэцы. Без яго галасаванне працуе як звычайна.">
      <div class="stack">
        <div class="field">
          <span>Steam Web API key</span>
          <div class="copy-row">
            <input type="password" value={key} placeholder="не змяняць" autocomplete="off" onInput={(e) => setKey(e.currentTarget.value)} />
            <button class="btn" disabled={!key} onClick={() => run(async () => { await api('/api/secret', { key: 'steamKey', value: key }); setKey(''); }, 'Ключ захаваны')}>Захаваць</button>
          </div>
        </div>
        <div>
          <Row label="Каталог">
            {state.steam.catalog} <button class="text-btn" onClick={() => run(() => api('/api/steam/catalog'), 'Каталог загружаны')}>абнавіць</button>
          </Row>
          <Row label="Бібліятэка">
            {state.steam.library} <button class="text-btn" disabled={!steam.steamId} onClick={() => run(() => api('/api/steam/library'), 'Бібліятэка праверана')}>праверыць</button>
          </Row>
        </div>
        <Switch label="Дадаваць толькі гульні з каталога Steam" checked={steam.onlySteam} onChange={(onlySteam) => save({ onlySteam })} />
        <Switch label="Пазначаць, ці ёсць гульня ў маёй бібліятэцы" checked={steam.checkLibrary} onChange={(checkLibrary) => save({ checkLibrary })} />
        <form class="copy-row" onSubmit={(e) => { e.preventDefault(); void run(async () => setApps((await api<{ apps: typeof apps }>('/api/steam/search', { query })).apps), ''); }}>
          <input value={query} placeholder="Знайсці спасылку на гульню" onInput={(e) => setQuery(e.currentTarget.value)} />
          <button class="btn" disabled={!query.trim()}>Знайсці</button>
        </form>
        {apps.length > 0 && (
          <ul class="steam-results">
            {apps.map((a) => <li key={a.appId}><span class="grow ellipsis">{a.title}</span><code>store.steampowered.com/app/{a.appId}</code></li>)}
          </ul>
        )}
      </div>
    </ServiceCard>
  );
}
