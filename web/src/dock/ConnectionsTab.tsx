// Укладка «Падключэнні»: Twitch (адзін уваход на ўсю праграму), OBS, Spotify і неабавязковы Steam.
import { useEffect, useState } from 'preact/hooks';
import { Section } from '../music/ui/dock/Section';
import { SpotifyConnection } from '../music/ui/dock/MusicSettings';
import type { DockController } from '../music/ui/dock/controller';
import { useStore } from '../music/ui/shared/hooks';
import { api, errorText, refresh, useAction, type CoreState } from './core';
import { Check, Notice, Row, TextField } from './ui';

export function ConnectionsTab({ state, music }: { state: CoreState; music: DockController }) {
  return (
    <div class="connections">
      <TwitchConnection state={state} music={music} />
      <ObsConnection state={state} music={music} />
      <SpotifyConnection controller={music} />
      <SteamConnection state={state} />
    </div>
  );
}

function TwitchConnection({ state, music }: { state: CoreState; music: DockController }) {
  const { notice, run } = useAction();
  const [clientId, setClientId] = useState(state.settings.twitch.clientId);
  const [code, setCode] = useState<{ uri: string; code: string } | null>(null);
  const musicTwitch = useStore(music.twitch);
  const connected = state.twitch.state === 'connected';

  // Пакуль на экране код, док пытае ядро, ці пацвердзіў стрымер уваход.
  useEffect(() => {
    if (!code) return;
    const id = setInterval(async () => {
      try {
        const result = await api<{ connected?: boolean }>('/api/twitch/poll');
        if (result.connected) { setCode(null); refresh(); }
      } catch (error) {
        setCode(null);
        alert(errorText(error));
      }
    }, 3000);
    return () => clearInterval(id);
  }, [code]);

  const login = () => run(async () => {
    if (clientId !== state.settings.twitch.clientId) await api('/api/settings', { ...state.settings, twitch: { ...state.settings.twitch, clientId } });
    const flow = await api<{ uri: string; code: string }>('/api/twitch/login');
    setCode(flow);
    window.open(flow.uri, '_blank');
  }, '');

  return (
    <Section title="Twitch" help={'Адзін уваход для ўсяго: галасаванне, бягучы радок і замовы музыкі.\n\n1. Устаўце Client ID свайго прыкладання з dev.twitch.tv/console (тып Public)\n2. Націсніце «Увайсці ў Twitch»: адкрыецца twitch.tv/activate\n3. Увайдзіце пад акаўнтам канала і пацвердзіце код\n\nУваход дзейнічае, пакуль вы адкрываеце OBS хоць бы раз на 30 дзён.'}>
      {connected ? (
        <>
          <p class="small good">Падключаны канал {state.twitch.login}</p>
          <Row label="Падзеі Twitch" tone={state.eventsub === 'connected' ? 'good' : 'bad'}>{state.eventsub === 'connected' ? 'ідуць' : 'падключэнне…'}</Row>
          <Row label="Узнагароды музыкі" tone={musicTwitch.problem ? 'bad' : ''}>
            {musicTwitch.status === 'ok' ? (musicTwitch.problem ? musicProblem(musicTwitch.problem) : 'гатовыя') : musicTwitch.status === 'error' ? musicProblem(musicTwitch.problem) : 'чакаюць музыку'}
          </Row>
          {state.legacyMusicRewards && <LegacyMusicRewards />}
          <div class="row-actions">
            <button class="btn" onClick={() => confirm('Адключыць Twitch? Усе ўзнагароды праграмы стануць на паўзу, пакуль вы не ўвайдзеце зноў.')
              && run(() => api('/api/twitch/disconnect'), 'Twitch адключаны')}>Адключыць</button>
          </div>
        </>
      ) : code ? (
        <>
          <div class="field"><span>Код для Twitch</span><div class="device-code">{code.code}</div></div>
          <div class="row-actions">
            <button class="btn primary" onClick={() => window.open(code.uri, '_blank')}>Адкрыць twitch.tv/activate</button>
            <button class="btn" onClick={() => setCode(null)}>Скасаваць</button>
          </div>
          <p class="small muted">Пацвердзіце код на старонцы Twitch, док чакае…</p>
        </>
      ) : (
        <>
          {state.twitch.error === 'login_expired' && <p class="small bad">Уваход у Twitch больш не дзейнічае — увайдзіце зноў</p>}
          {state.twitch.state === 'error' && <p class="small bad">Няма сувязі з Twitch ({state.twitch.error}), спрабую зноў…</p>}
          <TextField label="Client ID" value={clientId} onChange={(v) => setClientId(v.trim())} />
          <div class="row-actions">
            <button class="btn primary" disabled={!/^[a-z0-9]{20,40}$/i.test(clientId)} onClick={() => void login()}>Увайсці ў Twitch</button>
          </div>
        </>
      )}
      <Notice notice={notice} />
    </Section>
  );
}

/**
 * Аднаразова пры пераездзе: старыя ўзнагароды музыкі створаны іншым Twitch-прыкладаннем (spotify-бот),
 * таму выдаліць іх можна толькі ўваходам пад тым жа Client ID.
 */
function LegacyMusicRewards() {
  const { notice, run } = useAction();
  const [code, setCode] = useState<{ uri: string; code: string } | null>(null);
  useEffect(() => {
    if (!code) return;
    const id = setInterval(async () => {
      try {
        const result = await api<{ removed?: number }>('/api/music/legacy/poll');
        if (result.removed !== undefined) { setCode(null); refresh(); }
      } catch (error) {
        setCode(null);
        alert(errorText(error));
      }
    }, 3000);
    return () => clearInterval(id);
  }, [code]);
  return (
    <div class="legacy">
      <p class="small bad">У канале засталіся ўзнагароды музыкі ад ранейшага spotify-бота. Іх можа выдаліць толькі тое прыкладанне — увайдзіце адзін раз праз яго, і праграма выдаліць іх (балы за незавершаныя замовы вернуцца), а потым створыць новыя.</p>
      {code ? (
        <>
          <div class="device-code">{code.code}</div>
          <div class="row-actions"><button class="btn primary" onClick={() => window.open(code.uri, '_blank')}>Адкрыць twitch.tv/activate</button></div>
        </>
      ) : (
        <div class="row-actions">
          <button class="btn" onClick={() => run(async () => { const flow = await api<{ uri: string; code: string }>('/api/music/legacy/start'); setCode(flow); window.open(flow.uri, '_blank'); }, '')}>
            Выдаліць старыя ўзнагароды музыкі
          </button>
        </div>
      )}
      <Notice notice={notice} />
    </div>
  );
}

function musicProblem(problem: string): string {
  switch (problem) {
    case 'duplicate-title':
    case 'duplicate-title-video':
      return 'у канале ўжо ёсць узнагарода з той жа назвай, створаная іншай праграмай (стары spotify-бот) — выдаліце яе';
    case 'not-affiliate':
      return 'балы канала ёсць толькі ў кампаньёнаў і партнёраў';
    case 'network':
      return 'няма сувязі, спрабую зноў';
    case 'rate':
      return 'Twitch часова абмежаваў запыты';
    default:
      return 'памылка, спрабую зноў';
  }
}

function ObsConnection({ state, music }: { state: CoreState; music: DockController }) {
  const { notice, run } = useAction();
  const [url, setUrl] = useState(state.settings.obs.url);
  const [password, setPassword] = useState('');
  const obs = state.obs;
  return (
    <Section title="OBS" help={'Праграма падключаецца да obs-websocket, каб бачыць эфір, бягучы радок у сцэне і гук для хвалі музыкі.\n\nУ OBS: Інструменты → Налады WebSocket-сервера → Уключыць. Пароль адтуль упішыце тут.'}>
      <Row label="Стан" tone={obs.connected ? 'good' : 'bad'}>
        {obs.connected ? (obs.streaming ? 'падключаны · эфір ідзе' : 'падключаны') : obs.error === 'obs_password' ? 'пароль не падыходзіць' : 'не падключаны'}
      </Row>
      <TextField label="Адрас" value={url} onChange={(v) => setUrl(v.trim())} />
      <TextField label="Пароль" type="password" value={password} placeholder="не змяняць" onChange={setPassword} />
      <div class="row-actions">
        <button class="btn primary" disabled={url === state.settings.obs.url && !password}
          onClick={() => run(async () => {
            if (url !== state.settings.obs.url) await api('/api/settings', { ...state.settings, obs: { url } });
            if (password) await api('/api/secret', { key: 'obsPassword', value: password });
            setPassword('');
            music.connectObs();
          }, 'Захавана · падключаюся да OBS')}>Захаваць</button>
        <button class="btn" onClick={() => run(async () => { await api('/api/obs/reconnect'); music.connectObs(); }, 'Падключаюся да OBS')}>Перападключыць</button>
      </div>
      <Notice notice={notice} />
    </Section>
  );
}

function SteamConnection({ state }: { state: CoreState }) {
  const { notice, run } = useAction();
  const [open, setOpen] = useState(!!state.settings.steam.steamId);
  const [key, setKey] = useState('');
  const [query, setQuery] = useState('');
  const [apps, setApps] = useState<{ appId: number; title: string }[]>([]);
  const steam = state.settings.steam;
  const save = (patch: Partial<typeof steam>) => run(() => api('/api/settings', { ...state.settings, steam: { ...steam, ...patch } }), 'Захавана');
  return (
    <Section title="Steam · неабавязкова" actions={<button class="btn" onClick={() => setOpen(!open)}>{open ? 'Схаваць' : 'Паказаць'}</button>}
      help="Steam дапамагае дадаваць гульні па спасылцы на краму і паказваць, якія гульні ёсць у вашай бібліятэцы. Без яго галасаванне працуе як звычайна.">
      {open && (
        <>
          <Row label="SteamID" tone={steam.steamId ? '' : 'muted'}>{steam.steamId || 'не падключаны'}</Row>
          <div class="row-actions">
            <button class="btn" onClick={() => run(async () => { location.href = (await api<{ uri: string }>('/api/steam/login')).uri; }, '')}>Увайсці ў Steam</button>
          </div>
          <TextField label="Steam Web API key" type="password" value={key} placeholder="не змяняць" onChange={setKey} />
          <div class="row-actions">
            <button class="btn" disabled={!key} onClick={() => run(async () => { await api('/api/secret', { key: 'steamKey', value: key }); setKey(''); }, 'Ключ захаваны')}>Захаваць ключ</button>
            <button class="btn" onClick={() => run(() => api('/api/steam/catalog'), 'Каталог загружаны')}>Загрузіць каталог</button>
            <button class="btn" disabled={!steam.steamId} onClick={() => run(() => api('/api/steam/library'), 'Бібліятэка праверана')}>Праверыць бібліятэку</button>
          </div>
          <Row label="Каталог">{state.steam.catalog}</Row>
          <Row label="Бібліятэка">{state.steam.library}</Row>
          <Check label="Дадаваць толькі гульні з каталога Steam" checked={steam.onlySteam} onChange={(onlySteam) => save({ onlySteam })} />
          <Check label="Пазначаць, ці ёсць гульня ў маёй бібліятэцы" checked={steam.checkLibrary} onChange={(checkLibrary) => save({ checkLibrary })} />
          <form class="inline" onSubmit={(e) => { e.preventDefault(); void run(async () => setApps((await api<{ apps: typeof apps }>('/api/steam/search', { query })).apps), ''); }}>
            <input value={query} placeholder="Пошук у каталогу" onInput={(e) => setQuery(e.currentTarget.value)} />
            <button class="btn" disabled={!query.trim()}>Знайсці</button>
          </form>
          {apps.length > 0 && <ul class="steam-results">{apps.map((a) => <li key={a.appId}><code>https://store.steampowered.com/app/{a.appId}/</code> {a.title}</li>)}</ul>}
        </>
      )}
      <Notice notice={notice} />
    </Section>
  );
}
