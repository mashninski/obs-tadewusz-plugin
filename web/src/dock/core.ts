// Сувязь дока з ядром праграмы: стан (апытанне) і каманды.
import { useEffect, useRef, useState } from 'preact/hooks';
import { toast } from './ui';

export interface Entry {
  id: string;
  code: string;
  title: string;
  score: number;
  availability?: string;
  manual?: boolean | null;
}

export interface CarryStep {
  id: string;
  title: string;
  before: number;
  after: number;
  removed: boolean;
}

export interface Announcement {
  id: string;
  text: string;
}

export interface TickerConfig {
  version: 1;
  enabled: boolean;
  interval: number;
  width: number;
  height: number;
  font: string;
  size: number;
  speed: number;
  accent: string;
  opacity: number;
  cost: number;
  title: string;
  prompt: string;
  announcements: Announcement[];
}

export interface TickerJob {
  id: string;
  kind: 'automatic' | 'manual' | 'paid';
  nick: string;
  text: string;
  state: string;
  attempt?: string;
  generation?: number;
  voice?: string | null;
  audio?: 'pending' | 'ready' | 'failed' | null;
}

export interface VoiceConfig {
  version: 1;
  enabled: boolean;
  path: string;
  volume: number;
  device: 'cpu' | 'cuda';
  steps: 16 | 32;
  idle: number;
  monitor: boolean;
}

export interface IntroLink {
  id: string;
  url: string;
  label: string;
  qr: boolean;
}

export interface IntroConfig {
  version: 1;
  countdown: number;
  finishText: string;
  linksTitle: string;
  links: IntroLink[];
  clipPause: number;
  donations: boolean;
}

export interface OutroConfig {
  version: 1;
  text: string;
  ownLinks: boolean;
  linksTitle: string;
  links: IntroLink[];
  raidCountdown: number;
}

export interface RaidChannel {
  id: string;
  login: string;
  name: string;
  avatar: string;
  game: string;
  title: string;
  viewers: number;
  mature: boolean;
  thumbnail: string;
}

export interface RaidState {
  access: 'twitch_connect_required' | 'raid_scopes' | null;
  list: { fetchedAt: number | null; channels: RaidChannel[]; error: string | null; loading: boolean };
  current: {
    phase: 'starting' | 'pending' | 'unconfirmed' | 'done' | 'cancelled' | 'failed';
    target: RaidChannel; startedAt: number | null; deadline: number | null; error: string | null; viewers: number | null;
  } | null;
  serverNow: number;
  confirmMs: number;
  outroOnAir: boolean | null;
}

export type SeasonTheme = 'halloween' | 'winter' | 'autumn' | 'spring' | 'custom';
export type SeasonMotion = 'auto' | 'float' | 'fall' | 'tumble';

export interface SeasonConfig {
  version: 1;
  enabled: boolean;
  theme: SeasonTheme;
  motion: SeasonMotion;
  count: number;
  size: number;
  speed: number;
  opacity: number;
  fade: boolean;
}

export type TimerPosition = 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right' | 'center';

export interface TimerConfig {
  version: 1;
  position: TimerPosition;
  scale: number;
  sound: boolean;
  volume: number;
  monitor: boolean;
  hold: number;
}

export interface TimerView {
  id: string;
  goal: string;
  duration: number;
  deadline: number | null;
  left: number | null;
  paused: boolean;
  finished: boolean;
  shown: boolean;
}

export interface Settings {
  schemaVersion: number;
  replies: { enabled: boolean; templates: Record<string, string> };
  obs: { url: string };
  twitch: { clientId: string; addCost: number; supportCosts: number[] };
  steam: { onlySteam: boolean; checkLibrary: boolean; steamId: string };
  display: {
    font: string; size: number; color: string; speed: number; duration: number; headlineDuration: number; volume: number;
    sound: boolean; width: number; height: number; headerOpacity: number; listOpacity: number; headlines: string[];
  };
  backup: { directory: string };
}

export interface CoreState {
  version: string;
  settings: Settings;
  vote: {
    roundId: string;
    status: 'open' | 'paused' | 'finalizing' | 'closed';
    deadline: { due: number } | null;
    serverNow: number;
    carryPending: boolean;
    result: { winnerId: string | null; ranked: Entry[] } | null;
    entries: Entry[];
  };
  reviews: { id: string; cost: number; title: string | null }[];
  carryPreview: CarryStep[] | null;
  reception: {
    wanted: boolean; accepting: boolean; rewards: number; expectedRewards: number; enabled: boolean | null; error: string | null;
    reconciledAt: number | null; outbox: { kind: string; status: string; error: string | null; count: number }[];
  };
  ticker: {
    config: TickerConfig; source: string; current: TickerJob | null; waiting: number; queue: TickerJob[];
    cycle: { due?: number }; ready: { source: boolean }; consumer: boolean; error: string | null;
    refunds: { target: string; state: string; error: string | null; count: number }[];
    reception: { wanted: boolean; accepting: boolean; enabled: boolean | null; reward: string | null; error: string | null };
  };
  voice: {
    config: VoiceConfig; state: 'off' | 'missing' | 'starting' | 'ready' | 'sleeping' | 'failed'; available: boolean; detail: string | null;
    device: string | null; memory: { vramMb: number | null; ramMb: number | null; loadMs: number | null } | null; lastTook: number | null; personas: number;
  };
  twitch: { state: 'disconnected' | 'connecting' | 'connected' | 'error'; error: string | null; login: string | null; flow: boolean };
  /** Засталіся ўзнагароды музыкі ад ранейшага асобнага прыкладання. */
  legacyMusicRewards: boolean;
  eventsub: 'off' | 'connecting' | 'connected' | 'disconnected';
  obs: { connected: boolean; streaming: boolean; error: string | null };
  steam: { catalog: string; library: string };
  backups: { at: string | null; daily: string | null; error: string | null; location: string | null; external: string };
  outro: { config: OutroConfig };
  raid: RaidState;
  intro: { config: IntroConfig; clips: number; byViewers: number; fetchedAt: number | null; fetching: boolean; error: string | null };
  season: { config: SeasonConfig; images: Record<SeasonTheme, string[]>; maxImages: number; maxBytes: number };
  timer: { config: TimerConfig; recent: string[]; timer: TimerView | null; serverNow: number };
  history: { id: number; at: string; event: string }[];
  replyDefinitions: Record<string, [string, string]>;
  replyPlaceholders: Record<string, string[]>;
  urls: { dock: string; overlay: string; ticker: string; music: string; intro: string; season: string; timer: string; background: string; spotifyRedirect: string };
}

/** Каманда ядру. Памылка — `Error` з кодам (тэкст — праз `errorText`). */
export async function api<T = unknown>(path: string, body: unknown = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tadewusz': '1' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('core_unavailable');
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? 'operation_failed');
  return result as T;
}

type Listener = (state: CoreState | null) => void;
const listeners = new Set<Listener>();
let latest: CoreState | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Апытанне ядра раз у 1,5 с — адно на ўвесь док. */
async function poll(): Promise<void> {
  try {
    const response = await fetch('/api/state', { cache: 'no-store' });
    // Пасля пераўсталёўкі ядра старонка магла застацца без cookie — перазагрузка яе выдасць.
    if (response.status === 401) location.reload();
    latest = response.ok ? ((await response.json()) as CoreState) : null;
  } catch {
    latest = null;
  }
  for (const listener of listeners) listener(latest);
  timer = setTimeout(() => void poll(), 1500);
}

/** Абнавіць стан адразу (пасля каманды). */
export function refresh(): void {
  if (timer) clearTimeout(timer);
  void poll();
}

export function useCore(): CoreState | null {
  const [state, setState] = useState(latest);
  useEffect(() => {
    listeners.add(setState);
    if (!timer) void poll();
    return () => void listeners.delete(setState);
  }, []);
  return state;
}

const ERRORS: Record<string, string> = {
  core_unavailable: 'Праграма не адказвае · Праверце, ці адкрыты OBS',
  operation_failed: 'Дзеянне не выканана · Праверце падключэнні і журнал',
  network_unavailable: 'Няма сувязі з інтэрнэтам · Паспрабуйце пазней',
  twitch_connect_required: 'Спачатку падключыце Twitch (Сістэма → Падключэнне)',
  client_id_required: 'Увядзіце і захавайце Client ID',
  client_id: 'Client ID — толькі лацінскія літары і лічбы',
  oauth_expired: 'Код уваходу састарэў · Націсніце «Увайсці ў Twitch» яшчэ раз',
  oauth_identity: 'Twitch не пацвердзіў правы · Увайдзіце пад акаўнтам свайго канала',
  remote_401: 'Уваход у Twitch скончыўся · Падключыцеся зноў',
  remote_403: 'Twitch не дазволіў дзеянне · Балы канала ёсць толькі ў кампаньёнаў і партнёраў',
  remote_429: 'Twitch часова абмежаваў запыты · Паўтарыце праз хвіліну',
  reward_title_taken: 'Узнагарода з такой назвай ужо ёсць у Twitch · Перайменуйце або выдаліце яе',
  reward_state: 'Twitch не пацвердзіў узнагароду · Паўтарыце',
  obs_local_only: 'Адрас OBS: толькі ws://127.0.0.1:порт',
  reward_cost: 'Кошты: цэлыя лікі ад 1, ад 2 да 11 узнагарод',
  reward_duplicate: 'Кошты падтрымкі не павінны паўтарацца',
  entry_title: 'Назва: ад 1 да 100 знакаў',
  entry_duplicate: 'Такая пазіцыя ўжо ёсць',
  entry_missing: 'Пазіцыя не знойдзена',
  entry_score: 'Балы: цэлы лік ад 0',
  entry_same: 'Выберыце іншую пазіцыю',
  entry_has_points: 'На пазіцыі ёсць балы · Перанясіце іх або пацвердзіце, што яны згараюць',
  round_closed: 'Раўнд не адкрыты',
  round_finalizing: 'Вынік яшчэ чакае зверкі з Twitch',
  countdown_expired: 'Час галасавання скончыўся · Вынік чакае зверкі',
  external_cancel_review: 'Спачатку разбярыце знешняе скасаванне (вышэй)',
  finalization_outbox_pending: 'Twitch яшчэ не пацвердзіў апошнія пакупкі',
  fulfillment_pending: 'Пацвярджэнне пакупкі ў Twitch яшчэ не завершана · Паўтарыце праз хвіліну',
  review_missing: 'Разбор ужо закрыты',
  display_headlines: 'Загалоўкі: да 20 радкоў па 120 знакаў',
  display_style: 'Праверце шрыфт і колер',
  display_size: 'Праверце памер і хуткасць',
  display_options: 'Праверце налады адлюстравання',
  display_opacity: 'Непразрыстасць: ад 0 да 100 %',
  reply_template: 'Адказ: ад 1 да 350 знакаў, без пераносаў радка',
  reply_placeholder: 'У адказе невядомая падстаноўка',
  backup_directory: 'Тэчка рэзерву: недапушчальныя сімвалы',
  backup_failed: 'Рэзервовая копія не запісалася · Праверце дыск',
  ticker_text: 'Тэкст: пусты радок, кіруючы знак або задоўгі',
  ticker_settings: 'Праверце налады бягучага радка',
  ticker_announcement: 'Аб’ява не знойдзена · Захавайце змены',
  ticker_backpressure: 'Чарга бягучага радка поўная',
  voice_settings: 'Праверце налады голасу: тэчка OmniVoice і гучнасць 0–100 %',
  voice_not_ready: 'Голас яшчэ не гатовы · Пачакайце, пакуль загрузіцца мадэль',
  voice_waking: 'Мадэль спала — загружаецца · Паспрабуйце праз хвіліну',
  voice_timeout: 'OmniVoice не адказаў за 2 хвіліны · Працэс перазапушчаны',
  voice_synthesis: 'OmniVoice не змог агучыць тэкст',
  voice_worker_exited: 'Працэс OmniVoice спыніўся · Перазапуск…',
  voice_stopped: 'Голас выключаны',
  voice_audio: 'Аўдыя не знойдзена',
  voice_persona: 'Невядомы голас',
  body_limit: 'Занадта шмат тэксту за раз',
  secret_format: 'Пароль або ключ задоўгі',
  steam_connection_required: 'Падключыце Steam і захавайце ключ API',
  steam_catalog_unavailable: 'Спачатку загрузіце каталог Steam',
  steam_catalog_not_confirmed: 'Гульня не знойдзена ў каталогу Steam · Праверце назву або спасылку',
  steam_catalog_ambiguous: 'Некалькі гульняў з такой назвай · Устаўце спасылку Steam',
  steam_library_private_or_unavailable: 'Бібліятэка Steam закрытая або недаступная',
  steam_identity: 'Уваход у Steam не пацверджаны',
  countdown_value: 'Таймер: ад 10 секунд да гадзіны',
  obs_required: 'Спачатку падключыце OBS (Сістэма → Падключэнне)',
  obs_disconnected: 'OBS не адказвае · Праверце падключэнне',
  obs_request_timeout: 'OBS не адказаў за 4 секунды · Паўтарыце',
  season_settings: 'Праверце налады «Сезона»',
  season_theme: 'Невядомая тэма',
  season_motion: 'Невядомы від руху',
  season_count: 'Колькасць: ад 1 да 40',
  season_size: 'Памер: ад 16 да 256 px',
  season_speed: 'Хуткасць: ад 20 да 300 %',
  season_opacity: 'Непразрыстасць: ад 5 да 100 %',
  season_image: 'Файл не прачытаўся · Паспрабуйце іншы',
  season_image_size: 'Карцінка большая за 2 МБ',
  season_image_type: 'Толькі PNG, WebP або SVG',
  season_image_limit: 'У тэме ўжо 20 карцінак · Выдаліце лішнія',
  season_source_name: 'У OBS ужо ёсць крыніца «Tadewusz · Сезон» іншага тыпу · Перайменуйце яе',
  timer_source_name: 'У OBS ужо ёсць крыніца «Tadewusz · Таймер» іншага тыпу · Перайменуйце яе',
  timer_settings: 'Праверце налады таймера',
  timer_position: 'Невядомае месца на экране',
  timer_scale: 'Памер: ад 50 да 200 %',
  timer_volume: 'Гучнасць: ад 0 да 100 %',
  timer_hold: 'Пасля нуля: ад 0 да 600 секунд',
  timer_goal: 'Мэта: да 80 знакаў, без службовых сімвалаў',
  timer_duration: 'Час: ад секунды да 12 гадзін',
  timer_not_running: 'Таймер не ідзе',
  timer_not_paused: 'Таймер не на паўзе',
  outro_source_name: 'У OBS ужо ёсць крыніца «Tadewusz · Аўтра» іншага тыпу · Перайменуйце яе',
  outro_text: 'Надпіс: ад 1 да 80 знакаў',
  outro_links_title: 'Загаловак спасылак: да 60 знакаў',
  outro_options: 'Праверце налады аўтра',
  outro_raid_countdown: 'Адлік да Raid Now: ад 3 да 60 секунд',
  outro_links: 'Спасылак — не больш за 8',
  outro_link: 'Праверце спасылку: адрас без прабелаў да 200 знакаў, подпіс да 60',
  raid_scopes: 'Патрэбны паўторны ўваход у Twitch · Новыя правы для рэйду',
  raid_target: 'Канала няма ў спісе · Абнавіце спіс',
  raid_in_progress: 'Рэйд ужо ідзе · Адмяніце яго або дачакайцеся',
  raid_not_pending: 'Рэйд не ідзе · Адмяняць няма чаго',
  raid_refused: 'Twitch не дазволіў рэйд · Канал не прымае рэйды ад вас або ў рэйдзе зашмат гледачоў',
  raid_channel_missing: 'Twitch не знайшоў канал · Абнавіце спіс',
  raid_conflict: 'Рэйд ужо ідзе ў Twitch · Адмяніце яго ў чаце або тут',
  raid_rate_limit: 'Twitch: не больш за 10 рэйдаў за 10 хвілін · Паспрабуйце пазней',
  raid_unconfirmed: 'Twitch не пацвердзіў рэйд · Праверце чат',
  intro_source_name: 'У OBS ужо ёсць крыніца «Tadewusz · Інтро» іншага тыпу · Перайменуйце яе',
  intro_countdown: 'Адлік: ад 10 секунд да 6 гадзін',
  intro_finish_text: 'Надпіс на нулі: ад 1 да 80 знакаў',
  intro_links_title: 'Загаловак спасылак: да 60 знакаў',
  intro_clip_pause: 'Паўза паміж кліпамі: ад 0 да 120 секунд',
  intro_links: 'Спасылак — не больш за 8',
  intro_link: 'Праверце спасылку: адрас без прабелаў да 200 знакаў, подпіс да 60',
};

export function errorText(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error);
  return ERRORS[code] ?? `Дзеянне не выканана (${code})`;
}

/** Выканаць каманду: вынік — усплывальным паведамленнем, стан абнаўляецца адразу. `null` — памылка. */
export async function run<T>(fn: () => Promise<T>, success = 'Гатова'): Promise<T | null> {
  try {
    const result = await fn();
    toast(success);
    refresh();
    return result;
  } catch (error) {
    toast(errorText(error), true);
    refresh();
    return null;
  }
}

/**
 * Чарнавік, які захоўваецца сам праз імгненне пасля праўкі (як аб’явы радка і налады музыкі).
 * Пакуль змены не захаваныя, апытанне ядра іх не перазапісвае. `ready: false` — значэнне яшчэ няпоўнае, не захоўваць.
 */
export function useDraft<T>(saved: T, persist: (value: T) => Promise<unknown>, delay = 700) {
  const [draft, setDraft] = useState(saved);
  const dirty = useRef(false);
  const pending = useRef<{ value: T; timer: ReturnType<typeof setTimeout> } | null>(null);
  const save = useRef(persist);
  save.current = persist;
  useEffect(() => { if (!dirty.current) setDraft(saved); }, [JSON.stringify(saved)]);

  const flush = async () => {
    const job = pending.current;
    if (!job) return;
    clearTimeout(job.timer);
    pending.current = null;
    try {
      await save.current(job.value);
      if (!pending.current) dirty.current = false;
      refresh();
    } catch (error) {
      toast(errorText(error), true);
    }
  };
  // Пераход на іншую ўкладку не губляе апошнюю праўку.
  useEffect(() => () => void flush(), []);

  const update = (next: T, ready = true) => {
    dirty.current = true;
    setDraft(next);
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = ready ? { value: next, timer: setTimeout(() => void flush(), delay) } : null;
  };
  return [draft, update] as const;
}
