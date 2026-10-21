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
  twitch: { state: 'disconnected' | 'connecting' | 'connected' | 'error'; error: string | null; login: string | null; flow: boolean };
  /** Засталіся ўзнагароды музыкі ад ранейшага асобнага прыкладання. */
  legacyMusicRewards: boolean;
  eventsub: 'off' | 'connecting' | 'connected' | 'disconnected';
  obs: { connected: boolean; streaming: boolean; error: string | null };
  steam: { catalog: string; library: string };
  backups: { at: string | null; daily: string | null; error: string | null; location: string | null; external: string };
  history: { id: number; at: string; event: string }[];
  replyDefinitions: Record<string, [string, string]>;
  replyPlaceholders: Record<string, string[]>;
  urls: { dock: string; overlay: string; ticker: string; music: string; spotifyRedirect: string };
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
  twitch_connect_required: 'Спачатку падключыце Twitch (укладка «Падключэнні»)',
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
  body_limit: 'Занадта шмат тэксту за раз',
  secret_format: 'Пароль або ключ задоўгі',
  steam_connection_required: 'Падключыце Steam і захавайце ключ API',
  steam_catalog_unavailable: 'Спачатку загрузіце каталог Steam',
  steam_catalog_not_confirmed: 'Гульня не знойдзена ў каталогу Steam · Праверце назву або спасылку',
  steam_catalog_ambiguous: 'Некалькі гульняў з такой назвай · Устаўце спасылку Steam',
  steam_library_private_or_unavailable: 'Бібліятэка Steam закрытая або недаступная',
  steam_identity: 'Уваход у Steam не пацверджаны',
  countdown_value: 'Таймер: ад 10 секунд да гадзіны',
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
