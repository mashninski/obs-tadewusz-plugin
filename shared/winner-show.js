// Сцэнарый завяршэння раўнда на экране — агульны для ядра і оверлея, каб бягучы радок
// абвясціў пераможцу ў той жа момант, калі яго называе шапка оверлея.
// Час адлічваецца ад закрыцця раўнда (result.closedAt).
export const WINNER_SHOW = {
  /** Спіс плаўна вяртаецца наверх. */
  scrollMs: 900,
  /** Хваля колеру бяжыць па бачных радках знізу ўверх. */
  waveStartMs: 900,
  waveMs: 2400,
  /** Хваля спыняецца на першым месцы: шапка называе пераможцу, радок — таксама. */
  revealMs: 3600,
  /** Колькі шапка трымае імя пераможцы. */
  winnerHoldMs: 8000,
  /** Выбылыя пазіцыі растаюць знізу ўверх. */
  dissolveStepMs: 280,
  dissolveMs: 1400,
  /** Мінімум, колькі трымаецца «Выбываюць: …», перш чым шапка скажа пра наступнае галасаванне. */
  removedHoldMs: 4000,
};

export const NEXT_ROUND_TEXT = 'Наступнае галасаванне пачнецца заўтра';

/** Калі шапка пераходзіць да выбылых і да фінальнага радка. */
export function showTimeline(removedCount) {
  const removedAt = WINNER_SHOW.revealMs + WINNER_SHOW.winnerHoldMs;
  const finalAt = removedCount
    // Спіс едзе ўніз да выбылых, яны растаюць і схлопваюцца, потым паўза.
    ? removedAt + Math.max(WINNER_SHOW.removedHoldMs,
      WINNER_SHOW.scrollMs + (removedCount - 1) * WINNER_SHOW.dissolveStepMs + WINNER_SHOW.dissolveMs + 600 + 1200)
    : removedAt;
  return { removedAt, finalAt };
}

export function winnerTickerText(title) {
  return `Пераможца галасавання — **${String(title).replace(/\*\*/g, '')}**`;
}
