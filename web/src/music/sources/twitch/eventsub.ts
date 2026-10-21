// Падзеі ўзнагарод музыкі. Злучэнне EventSub адно на ўсю праграму і жыве ў ядры;
// мозг музыкі атрымлівае падзеі сваіх узнагарод праз ядро (Server-Sent Events).
// Падзеі, што прыйшлі ў перапынак, не вяртаюцца — іх даганяе Get Custom Reward Redemption (гл. twitch.ts).

import type { CoreTwitch } from './core';

export type EventSubStatus = 'off' | 'connecting' | 'ok';

export interface EventSubOptions {
  core: CoreTwitch;
  /** Злучэнне ёсць (зноў): трэба дагнаць прапушчанае. */
  onWelcome(): void;
  onNotification(type: string, event: unknown): void;
  onStatus(status: EventSubStatus): void;
}

export function createEventSub(options: EventSubOptions) {
  let status: EventSubStatus = 'off';
  let close: (() => void) | null = null;

  function setStatus(next: EventSubStatus): void {
    if (status === next) return;
    status = next;
    options.onStatus(next);
  }

  return {
    get status() {
      return status;
    },

    start(): void {
      if (close) return;
      setStatus('connecting');
      close = options.core.events({
        onEvent: (type, event) => options.onNotification(type, event),
        onStatus: (connected) => {
          if (!close) return;
          if (connected && status !== 'ok') {
            setStatus('ok');
            options.onWelcome();
          } else if (!connected) setStatus('connecting');
        },
      });
    },

    stop(): void {
      close?.();
      close = null;
      setStatus('off');
    },
  };
}

export type EventSub = ReturnType<typeof createEventSub>;
