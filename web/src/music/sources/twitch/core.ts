// Музыка праз ядро праграмы: агульны ўваход у Twitch (запыты да Helix і падзеі ўзнагарод) і падключэнне OBS.
// Токенаў у браўзеры няма — ядро само дадае іх да запыту і само абнаўляе.

export interface CoreIdentity {
  connected: boolean;
  login?: string;
  userId?: string;
  clientId?: string;
  scopes?: string[];
}

export interface CoreReply {
  status: number;
  body: unknown;
}

export interface CoreEvents {
  onEvent(type: string, event: unknown): void;
  /** Ці злучана ядро з EventSub. */
  onStatus(connected: boolean): void;
}

export interface CoreTwitch {
  identity(): Promise<CoreIdentity>;
  /** `path` — шлях Helix з параметрамі, напрыклад `/channel_points/custom_rewards?broadcaster_id=1`. */
  helix(method: string, path: string, body?: unknown, keepalive?: boolean): Promise<CoreReply>;
  events(handlers: CoreEvents): () => void;
  /** Адрас і пароль obs-websocket з налад праграмы. */
  obs(): Promise<{ url: string; password: string }>;
}

/** Памылка самога ядра (не Twitch): няма ўваходу, няма сеткі, забаронены запыт. */
export class CoreError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'CoreError';
  }
}

const HEADERS = { 'Content-Type': 'application/json', 'X-Tadewusz': '1' };

export function httpCore(base = ''): CoreTwitch {
  return {
    async identity() {
      const response = await fetch(`${base}/api/music/identity`, { cache: 'no-store' });
      if (!response.ok) throw new CoreError('core_unavailable');
      return (await response.json()) as CoreIdentity;
    },

    async helix(method, path, body, keepalive = false) {
      let response: Response;
      try {
        response = await fetch(`${base}/api/music/helix`, { method: 'POST', headers: HEADERS, keepalive, body: JSON.stringify({ method, path, body }) });
      } catch {
        throw new CoreError('network_unavailable');
      }
      const json = (await response.json().catch(() => null)) as { error?: string } | CoreReply | null;
      if (!response.ok) throw new CoreError(json && 'error' in json && json.error ? json.error : 'core_unavailable');
      return json as CoreReply;
    },

    async obs() {
      const response = await fetch(`${base}/api/music/obs`, { cache: 'no-store' });
      if (!response.ok) throw new CoreError('core_unavailable');
      return (await response.json()) as { url: string; password: string };
    },

    events(handlers) {
      const source = new EventSource(`${base}/api/music/events`);
      source.onmessage = (message) => {
        let data: { type?: string; event?: unknown; connected?: boolean };
        try {
          data = JSON.parse(String(message.data));
        } catch {
          return;
        }
        if (data.type === 'status') handlers.onStatus(data.connected === true);
        else if (typeof data.type === 'string') handlers.onEvent(data.type, data.event);
      };
      // EventSource перападключаецца сам; пакуль сувязі няма — падзеі не прыходзяць.
      source.onerror = () => handlers.onStatus(false);
      return () => source.close();
    },
  };
}
