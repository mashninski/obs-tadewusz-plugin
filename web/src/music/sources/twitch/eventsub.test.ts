// Падзеі ўзнагарод музыкі праз ядро: стан злучэння і даганялка пасля перапынку.

import { describe, expect, it } from 'vitest';
import { createEventSub, type EventSubStatus } from './eventsub';
import { createFakeTwitch } from './fake';

const flush = () => new Promise((r) => setTimeout(r, 1));

function setup() {
  const twitch = createFakeTwitch();
  const statuses: EventSubStatus[] = [];
  const events: string[] = [];
  let welcomes = 0;
  const sub = createEventSub({
    core: twitch.core,
    onWelcome: () => welcomes++,
    onNotification: (type) => events.push(type),
    onStatus: (s) => statuses.push(s),
  });
  return { twitch, sub, statuses, events, welcomes: () => welcomes };
}

describe('падзеі праз ядро', () => {
  it('злучэнне ёсць — статус ok і адна даганялка; падзеі даходзяць', async () => {
    const { twitch, sub, statuses, events, welcomes } = setup();
    twitch.state.rewards.push({ id: 'r', title: 't', cost: 1, prompt: '', background_color: '', is_paused: false, is_enabled: true, is_user_input_required: true, should_redemptions_skip_request_queue: false, managed: true });
    sub.start();
    await flush();
    expect(statuses).toEqual(['connecting', 'ok']);
    expect(welcomes()).toBe(1);
    twitch.redeem('Kasia', 'песня', { rewardId: 'r' });
    expect(events).toEqual(['channel.channel_points_custom_reward_redemption.add']);
  });

  it('перапынак у ядры — «падключэнне», потым новая даганялка', async () => {
    const { twitch, sub, statuses, welcomes } = setup();
    sub.start();
    await flush();
    twitch.setEvents(false);
    twitch.setEvents(true);
    expect(statuses).toEqual(['connecting', 'ok', 'connecting', 'ok']);
    expect(welcomes()).toBe(2);
  });

  it('спынены — падзеі не прымаюцца, статус off', async () => {
    const { twitch, sub, statuses } = setup();
    sub.start();
    await flush();
    sub.stop();
    expect(twitch.listening()).toBe(0);
    expect(statuses.at(-1)).toBe('off');
  });
});
