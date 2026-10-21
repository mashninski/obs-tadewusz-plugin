// Музыка ў доку: правілы замоў, гук і відэа; падключэнні Spotify і YouTube (для ўкладкі «Падключэнні»).

import { useEffect, useState } from 'preact/hooks';
import type { RequestRules } from '../../core/rules';
import { safeLocalStorage, SIMULATED_AUDIO } from '../../core/settings';
import { t, type MessageKey } from '../../i18n';
import { readLoginResult } from '../../providers/spotify/auth';
import type { SpotifyInfo } from '../../providers/spotify/sync';
import { useStore } from '../shared/hooks';
import { clock } from '../shared/leader';
import { isClientId, type DockController } from './controller';
import { Hero, ServiceCard, Switch as Toggle } from '../../../dock/ui';
import { Section } from './Section';

/** Шапка ўкладкі «Музыка»: ці прымаюцца замовы і чаму не. Узнагароды музыкі праграма адкрывае і ставіць на паўзу сама. */
export function MusicHero({ controller }: { controller: DockController }) {
  const spotify = useStore(controller.spotify);
  const twitch = useStore(controller.twitch);
  const leader = useStore(controller.leader);
  // Пасля адкрыцця дока мозг адклікаецца не адразу — некалькі секунд гэта не праблема.
  const [settled, setSettled] = useState(false);
  useEffect(() => { const id = setTimeout(() => setSettled(true), 4000); return () => clearTimeout(id); }, []);
  const goConnections = <button class="btn" onClick={() => (location.hash = 'connections')}>Падключэнні</button>;
  if (!leader && !settled) return <Hero tone="wait" title="Падключэнне…" detail="Док чакае плэер музыкі" />;
  if (!leader) return <Hero tone="bad" title="Музыка не працуе" detail="Яна жыве ў оверлэі музыкі — праверце, ці ёсць ён у сцэне OBS" />;
  if (twitch.status === 'off') return <Hero tone="off" title="Замовы не прымаюцца" detail="Twitch не падключаны">{goConnections}</Hero>;
  if (twitch.status === 'error' || twitch.problem) return <Hero tone="bad" title="Узнагароды музыкі не працуюць" detail={musicProblem(twitch.problem)}>{goConnections}</Hero>;
  if (twitch.status === 'connecting' || !twitch.reward) return <Hero tone="wait" title="Падключэнне…" detail="Праграма правярае ўзнагароды музыкі ў Twitch" />;
  const prices = [`песня ${twitch.reward.cost}`, twitch.videoReward ? `відэа ${twitch.videoReward.cost}` : ''].filter(Boolean).join(' · ');
  if (twitch.reward.paused && (!twitch.videoReward || twitch.videoReward.paused)) {
    return <Hero tone="wait" title="Замовы на паўзе" detail={spotify.status === 'off' ? 'Падключыце Spotify — тады адкрыюцца песні' : 'Адкрыюцца самі, калі плэер будзе гатовы'}>
      {spotify.status === 'off' && goConnections}
    </Hero>;
  }
  return <Hero tone="good" title="Замовы адкрытыя" detail={prices} />;
}

/** Чаму ўзнагароды музыкі не працуюць — для шапкі і «Падключэнняў». */
export function musicProblem(problem: string): string {
  switch (problem) {
    case 'duplicate-title':
    case 'duplicate-title-video':
      return 'У канале ёсць узнагарода з той жа назвай ад іншай праграмы';
    case 'not-affiliate':
      return 'Балы канала ёсць толькі ў кампаньёнаў і партнёраў';
    case 'scopes':
      return 'Не хапае правоў Twitch — увайдзіце зноў';
    case 'network':
      return 'Няма сувязі, спрабую зноў';
    case 'rate':
      return 'Twitch часова абмежаваў запыты';
    default:
      return 'Памылка, спрабую зноў';
  }
}

/** Правілы замоў: кошты, даўжыня, ліміт гледача — у адну сетку. */
export function MusicRules({ controller }: { controller: DockController }) {
  const rules = useStore(controller.settings).rules;
  const set = (patch: Partial<RequestRules>) => controller.updateSettings((s) => ({ ...s, rules: { ...s.rules, ...patch } }));
  return (
    <Section title="Правілы замоў" help={t('settings.rules.help')}>
      <div class="fields">
        <NumberField label="Песня, балаў" value={rules.price} step={50} onChange={(price) => set({ price })} />
        <NumberField label="Відэа, балаў" value={rules.videoPrice} step={50} onChange={(videoPrice) => set({ videoPrice })} />
        <NumberField label="Песня, да хв" value={rules.maxDurationMin} onChange={(maxDurationMin) => set({ maxDurationMin })} />
        <NumberField label="Відэа, да хв" value={rules.videoMaxDurationMin} onChange={(videoMaxDurationMin) => set({ videoMaxDurationMin })} />
        <NumberField label="Замоў ад гледача" value={rules.maxPerUser} onChange={(maxPerUser) => set({ maxPerUser })} />
      </div>
      <div class="hint">
        <Toggle label={t('settings.rules.allowExplicit')} checked={rules.allowExplicit} onChange={(allowExplicit) => set({ allowExplicit })} />
      </div>
    </Section>
  );
}

/** Гук і відэа: крыніца для хвалі, гучнасць відэа, рэклама. Мяняецца рэдка — у згорнутай картцы. */
export function MusicSound({ controller }: { controller: DockController }) {
  const settings = useStore(controller.settings);
  const meters = useStore(controller.meters);
  const youtube = useStore(controller.youtube);
  const obsStatus = useStore(controller.obs).status;
  const setVideo = (patch: Partial<typeof settings.video>) => controller.updateSettings((s) => ({ ...s, video: { ...s.video, ...patch } }));
  const names = Object.keys(meters);
  const selected = settings.audioSource;
  const waveNames = selected && selected !== SIMULATED_AUDIO && !names.includes(selected) ? [selected, ...names] : names;
  const videoNames = settings.video.audioSource && !names.includes(settings.video.audioSource) ? [settings.video.audioSource, ...names] : names;

  let videoAudio = '';
  if (obsStatus === 'connected' && !settings.video.audioSource) {
    videoAudio = youtube.overlaySource && youtube.overlayAudio ? t('settings.video.audio.found', { name: youtube.overlaySource })
      : youtube.overlaySource ? t('settings.video.audio.noAudio', { name: youtube.overlaySource }) : t('settings.video.audio.notFound');
  }

  return (
    <Section title="Гук і відэа" collapsible help={`${t('settings.audio.help')}\n\n${t('settings.video.help')}`}>
      <div class="stack">
        <div class="fields wide">
          <label class="field">
            <span>Хваля: крыніца гуку</span>
            <select value={selected} onChange={(e) => controller.updateSettings((s) => ({ ...s, audioSource: e.currentTarget.value }))}>
              <option value="">{t('settings.audio.none')}</option>
              <option value={SIMULATED_AUDIO}>{t('settings.audio.simulated')}</option>
              {waveNames.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label class="field">
            <span>Хваля падчас відэа</span>
            <select value={settings.video.audioSource} onChange={(e) => setVideo({ audioSource: e.currentTarget.value })}>
              <option value="">{t('settings.video.audio.auto')}</option>
              {videoNames.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
        </div>
        {videoAudio && <p class="hint">{videoAudio}</p>}
        <label class="field">
          <span>Гучнасць відэа — {settings.video.volume}%</span>
          <input type="range" min={0} max={100} step={1} value={settings.video.volume} style={{ '--v': `${settings.video.volume}%` }}
            onInput={(e) => setVideo({ volume: Number(e.currentTarget.value) })} />
        </label>
        <Toggle label={t('settings.video.skipAds')} checked={settings.video.skipAds} onChange={(skipAds) => setVideo({ skipAds })} />
        {names.length > 0 ? (
          <ul class="meters">
            {names.map((name) => (
              <li key={name} class={name === selected ? 'selected' : ''}>
                <span class="meter-name">{name}</span>
                <span class="meter"><span class="meter-fill" style={{ width: `${(meters[name] ?? 0) * 100}%` }} /></span>
              </li>
            ))}
          </ul>
        ) : (
          <p class="hint">{obsStatus === 'connected' ? t('settings.audio.waiting') : t('settings.audio.connectFirst')}</p>
        )}
      </div>
    </Section>
  );
}

/** Лікавае поле: тэкст трымаецца ў полі, пакуль стрымер піша (док часта перамалёўваецца ад узроўню гуку). */
function NumberField({ label, value, step = 1, onChange }: { label: string; value: number; step?: number; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft);
    if (Number.isInteger(n) && n > 0 && n !== value) onChange(n);
    setDraft(null);
  };
  return (
    <label class="field">
      <span>{label}</span>
      <input type="number" min={step > 1 ? step : 1} step={step} value={draft ?? String(value)}
        onInput={(e) => setDraft(e.currentTarget.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()}
        // Стрэлкі і кола мышы — адразу захаваць новае значэнне.
        onChange={(e) => {
          if (document.activeElement !== e.currentTarget) return;
          const n = Number(e.currentTarget.value);
          if (Number.isInteger(n) && n > 0) onChange(n);
        }} />
    </label>
  );
}

// ---------- Падключэнні ----------

export function SpotifyConnection({ controller }: { controller: DockController }) {
  const clientId = useStore(controller.settings).spotify.clientId;
  const info = useStore(controller.spotify);
  const connected = info.status !== 'off';
  const login = connected ? null : readLoginResult(safeLocalStorage());
  const tone = info.status === 'ok' ? 'good' : info.status === 'connecting' ? 'wait' : connected ? 'bad' : 'off';
  const detail = connected
    ? `${spotifyStatusText(info)}${info.status === 'ok' ? ` · ${info.problem ? t(`settings.spotify.problem.${info.problem}`) : info.device ? t('settings.spotify.device', { device: info.device }) : t('settings.spotify.noDevice')}` : ''}`
    : login && !login.ok ? loginErrorText(login.error ?? '') : 'Не падключаны';
  return (
    <ServiceCard name="Spotify" tone={tone} detail={detail} help={t('settings.spotify.help')}
      action={connected
        ? <button class="btn" onClick={controller.disconnectSpotify}>{t('settings.spotify.disconnect')}</button>
        : <button class="btn primary" disabled={!isClientId(clientId)} onClick={() => void controller.connectSpotify()}>Падключыць</button>}>
      {connected ? null : (
        <>
          <div class="fields wide">
            <label class="field">
              <span>{t('settings.spotify.clientId')}</span>
              <input value={clientId} spellcheck={false} autocomplete="off"
                onInput={(e) => { const value = e.currentTarget.value.trim(); controller.updateSettings((s) => ({ ...s, spotify: { ...s.spotify, clientId: value } })); }} />
            </label>
            <div class="field">
              <span>{t('settings.spotify.redirect')}</span>
              <CopyRow value={controller.spotifyRedirectUri} />
            </div>
          </div>
          {clientId && !isClientId(clientId) && <p class="hint bad">{t('settings.spotify.badClientId')}</p>}
        </>
      )}
    </ServiceCard>
  );
}

/** YouTube: уваход патрэбны толькі дзеля Premium (відэа без рэкламы). */
export function YouTubeConnection({ controller }: { controller: DockController }) {
  const youtube = useStore(controller.youtube);
  return (
    <ServiceCard name="YouTube" tone={youtube.ads ? 'bad' : 'off'}
      detail={youtube.ads ? t('settings.video.adsSeen', { n: youtube.ads }) : t('settings.video.signIn.hint')}
      action={<button class="btn" onClick={controller.signInYouTube}>Увайсці</button>} />
  );
}

function spotifyStatusText(info: SpotifyInfo): string {
  switch (info.status) {
    case 'connecting':
      return t('settings.spotify.connecting');
    case 'limited':
      return t('settings.spotify.limited', { time: clock(info.limitedUntil) });
    case 'error':
      return t(`settings.spotify.problem.${info.problem || 'other'}`);
    default:
      return info.user ? t('settings.spotify.connected', { user: info.user }) : t('settings.spotify.connectedNoName');
  }
}

const LOGIN_ERRORS = ['expired', 'access_denied', 'invalid_client', 'state'] as const;

function loginErrorText(code: string): string {
  return (LOGIN_ERRORS as readonly string[]).includes(code)
    ? t(`settings.spotify.error.${code}` as MessageKey)
    : t('settings.spotify.error.other', { code });
}

/** Поле толькі для чытання з кнопкай «Капіяваць». */
export function CopyRow({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Буфер абмену недаступны — адрас можна вылучыць у полі і скапіяваць Ctrl+C.
    }
  };
  return (
    <div class="copy-row">
      <input readOnly value={value} onFocus={(e) => e.currentTarget.select()} />
      <button class="btn" onClick={copy}>{copied ? 'Скапіявана' : 'Капіяваць'}</button>
    </div>
  );
}
