// Правы Twitch, патрэбныя музыцы. Сам уваход (Device Code Flow) і токены — у ядры праграмы.

/** Кіраваць узнагародамі і заказамі (уключае чытанне) і пісаць у чат ад імя стрымера. */
export const SCOPES = ['channel:manage:redemptions', 'user:write:chat'] as const;

/** Ці ёсць усе патрэбныя правы. */
export function hasScopes(scopes: string[]): boolean {
  return SCOPES.every((s) => scopes.includes(s));
}
