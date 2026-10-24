// Укладка «Галасаванне»: прыём пакупак, рэйтынг пазіцый, раўнд і новы раўнд з пераносам балаў.
import { useEffect, useState } from 'preact/hooks';
import { api, errorText, run, type CoreState, type Entry } from './core';
import { Card, Hero, IconButton, points } from './ui';

const AVAILABILITY: Record<string, string> = { absent: 'няма ў стрымера', error: 'памылка праверкі' };

function status(state: CoreState): { tone: 'good' | 'bad' | 'wait' | 'off'; title: string; detail: string } {
  const r = state.reception, round = state.vote.status;
  if (round === 'finalizing') return { tone: 'wait', title: 'Раўнд завяршаецца', detail: state.reception.error ? `Чакае: ${errorText(new Error(state.reception.error))}` : 'Праграма даганяе пакупкі з Twitch' };
  if (round === 'closed') return { tone: 'off', title: 'Раўнд завершаны', detail: 'Пачніце новы раўнд унізе' };
  if (state.twitch.state !== 'connected') return { tone: 'bad', title: 'Twitch не падключаны', detail: 'Сістэма → Падключэнне' };
  if (r.expectedRewards !== r.rewards) return { tone: 'bad', title: 'Узнагароды не створаны', detail: 'Націсніце «Запусціць» — праграма створыць іх' };
  if (!r.wanted || round === 'paused') return { tone: 'off', title: 'Галасаванне прыпынена', detail: 'Узнагароды схаваныя ад гледачоў' };
  if (!r.accepting) return { tone: 'wait', title: 'Падключэнне…', detail: 'Зверка пакупак з Twitch' };
  return { tone: 'good', title: 'Галасаванне ідзе', detail: 'Узнагароды адкрытыя' };
}

export function VotingTab({ state }: { state: CoreState }) {
  const vote = state.vote;
  const editable = vote.status === 'open' || vote.status === 'paused';
  const running = state.reception.wanted && vote.status === 'open';
  const s = status(state);
  return (
    <>
      <Hero tone={s.tone} title={s.title} detail={s.detail}>
        {editable && (
          <button class={`btn ${running ? '' : 'primary'}`}
            onClick={() => run(() => api(running ? '/api/voting/stop' : '/api/voting/start'), running ? 'Галасаванне прыпынена' : 'Галасаванне запушчана')}>
            {running ? 'Прыпыніць' : 'Запусціць'}
          </button>
        )}
      </Hero>

      {state.reviews.length > 0 && (
        <Card title="Знешнія скасаванні" flush help="Пакупку, за якую ўжо налічаны балы, скасавалі ў Twitch уручную. Балы аўтаматычна не мяняліся: калі ўсё правільна — пакіньце іх, інакш спачатку выпраўце балы пазіцыі.">
          <ul class="list">
            {state.reviews.map((review) => (
              <li key={review.id}>
                <span class="grow bad">{review.title ?? 'Выдаленая пазіцыя'} · {points(review.cost)}</span>
                <button class="btn" onClick={() => run(() => api('/api/vote/review', { id: review.id }), 'Разбор закрыты')}>Пакінуць балы</button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {vote.status === 'closed' ? <Closed state={state} /> : (
        <>
          <Entries entries={vote.entries} editable={editable} />
          {editable && <Round state={state} />}
        </>
      )}
    </>
  );
}

function Entries({ entries, editable }: { entries: Entry[]; editable: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const total = entries.reduce((sum, e) => sum + e.score, 0);
  return (
    <Card title={`Рэйтынг · ${entries.length} · ${points(total)}`} flush
      help="Націсніце на пазіцыю, каб змяніць балы, назву, наяўнасць, перанесці балы на іншую пазіцыю або выдаліць. Код з трох літар глядач піша ва ўзнагародзе галасавання.">
      <ol class="list entries">
        {entries.map((entry, index) => (
          <li key={entry.id} class={open === entry.id ? 'open' : ''}>
            <button class="entry" disabled={!editable} onClick={() => setOpen(open === entry.id ? null : entry.id)} aria-expanded={open === entry.id}>
              <span class="entry-rank">{index + 1}</span>
              <span class="entry-code">{entry.code}</span>
              <span class="entry-title">{entry.title}{AVAILABILITY[entry.availability ?? ''] && <small>{AVAILABILITY[entry.availability ?? '']}</small>}</span>
              <span class="entry-score">{points(entry.score)}</span>
            </button>
            {open === entry.id && <EntryEditor entry={entry} entries={entries} onDone={() => setOpen(null)} />}
          </li>
        ))}
      </ol>
      {entries.length === 0 && <p class="empty-line">Пакуль няма пазіцый</p>}
      {editable && (
        <form class="add-row" onSubmit={(e) => {
          e.preventDefault();
          void run(() => api('/api/vote/add', { title }), 'Пазіцыя дададзена').then((r) => r !== null && setTitle(''));
        }}>
          <input value={title} maxLength={100} placeholder="Новая гульня: назва або спасылка Steam" aria-label="Новая пазіцыя" onInput={(e) => setTitle(e.currentTarget.value)} />
          <button class="btn" disabled={!title.trim()}>Дадаць</button>
        </form>
      )}
    </Card>
  );
}

function EntryEditor({ entry, entries, onDone }: { entry: Entry; entries: Entry[]; onDone: () => void }) {
  const [score, setScore] = useState(String(entry.score));
  const [title, setTitle] = useState(entry.title);
  const [target, setTarget] = useState('');
  useEffect(() => setScore(String(entry.score)), [entry.score]);
  useEffect(() => setTitle(entry.title), [entry.title]);

  const remove = async () => {
    const info = await run(() => api<{ score: number; refundable: number }>('/api/vote/removal-info', { id: entry.id }), '');
    if (!info) return;
    const lines = [`Выдаліць ${entry.title}?`];
    if (info.score > 0) lines.push(`${points(info.score)} балаў згараць: Twitch не вяртае ўжо пацверджаныя галасы. Каб іх захаваць, спачатку перанясіце балы.`);
    if (info.refundable > 0) lines.push(`Глядачу вернецца кошт дадавання: ${points(info.refundable)}.`);
    if (!confirm(lines.join('\n\n'))) return;
    if (await run(() => api('/api/vote/remove', { id: entry.id, burn: info.score > 0 }), 'Пазіцыя выдалена') !== null) onDone();
  };
  const move = () => {
    const to = entries.find((e) => e.id === target);
    if (to && confirm(`Перанесці ${points(entry.score)} балаў: ${entry.title} → ${to.title}?`))
      void run(() => api('/api/vote/move', { from: entry.id, to: target }), 'Балы перанесены');
  };

  return (
    <div class="entry-editor">
      <form class="inline" onSubmit={(e) => { e.preventDefault(); void run(() => api('/api/vote/edit', { id: entry.id, score: Number(score) }), 'Балы зменены'); }}>
        <input type="number" min={0} value={score} aria-label="Балы" title="Балы" onInput={(e) => setScore(e.currentTarget.value)} />
        <IconButton icon="check" label="Захаваць балы" type="submit" disabled={Number(score) === entry.score} />
      </form>
      <form class="inline" onSubmit={(e) => { e.preventDefault(); void run(() => api('/api/vote/rename', { id: entry.id, title }), 'Назва зменена'); }}>
        <input value={title} maxLength={100} aria-label="Назва" title="Назва" onInput={(e) => setTitle(e.currentTarget.value)} />
        <IconButton icon="check" label="Захаваць назву" type="submit" disabled={!title.trim() || title === entry.title} />
      </form>
      <div class="inline">
        <select value={target} aria-label="Перанесці балы на" disabled={entry.score === 0} onChange={(e) => setTarget(e.currentTarget.value)}>
          <option value="">{entry.score ? 'Перанесці балы на…' : 'Балаў няма'}</option>
          {entries.filter((e) => e.id !== entry.id).map((e) => <option key={e.id} value={e.id}>{e.code} · {e.title}</option>)}
        </select>
        <IconButton icon="arrow" label="Перанесці" disabled={!target} onClick={move} />
      </div>
      <div class="inline">
        <select value={entry.manual === true ? 'yes' : entry.manual === false ? 'no' : 'auto'} aria-label="Наяўнасць у стрымера"
          onChange={(e) => run(() => api('/api/vote/availability', { id: entry.id, manual: e.currentTarget.value === 'auto' ? null : e.currentTarget.value === 'yes' }), '')}>
          <option value="auto">Наяўнасць: аўта</option>
          <option value="yes">Ёсць у стрымера</option>
          <option value="no">Няма ў стрымера</option>
        </select>
        <IconButton icon="close" label="Выдаліць пазіцыю" tone="danger" onClick={() => void remove()} />
      </div>
    </div>
  );
}

function Round({ state }: { state: CoreState }) {
  const deadline = state.vote.deadline;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [deadline]);
  const left = deadline ? Math.max(0, Math.ceil((deadline.due - now - (state.vote.serverNow - Date.now())) / 1000)) : 0;
  return (
    <Card title="Раўнд" help="«Праз 60 с» запускае таймер на экране. Пасля яго прыём спыняецца, праграма даганяе пакупкі з Twitch і паказвае пераможцу. Новы раўнд пачынаецца асобна — з правілам пераносу балаў.">
      <div class="inline">
        <span class="grow num">{deadline ? `Да канца галасавання: ${left} с` : <span class="muted">Таймер не запушчаны</span>}</span>
        {deadline
          ? <button class="btn" onClick={() => run(() => api('/api/vote/countdown/cancel'), 'Таймер скасаваны')}>Скасаваць</button>
          : <button class="btn" onClick={() => run(() => api('/api/vote/countdown', { seconds: 60 }), 'Таймер запушчаны')}>Праз 60 с</button>}
        <button class="btn ghost" onClick={() => confirm('Завяршыць раўнд зараз? Прыём спыніцца, вынік з’явіцца пасля зверкі з Twitch.')
          && run(() => api('/api/vote/close'), 'Раўнд завяршаецца')}>Зараз</button>
      </div>
    </Card>
  );
}

function Closed({ state }: { state: CoreState }) {
  const result = state.vote.result;
  const winner = result?.ranked.find((e) => e.id === result.winnerId);
  const plan = state.carryPreview;
  return (
    <Card title="Вынік раўнда" flush help="Правіла пераносу: пераможцу застаецца 1/5 балаў, месцам 2–6 — 2/3, астатнім — без змен. Знізу выбывае па адной пазіцыі на кожныя поўныя 5: 6–10 пазіцый — 1, 11–15 — 2 і г. д.">
      <p class="empty-line" style={{ color: 'var(--text)' }}>{winner ? <>Пераможца: <b>{winner.title}</b> · {points(winner.score)}</> : 'Раўнд завершаны без пазіцый'}</p>
      {plan && (
        <table class="carry">
          <tbody>
            {plan.map((step) => (
              <tr key={step.id} class={step.removed ? 'removed' : ''}>
                <td>{step.title}</td>
                <td class="num faint">{points(step.before)}</td>
                <td class="num">{step.removed ? 'выбывае' : step.after === step.before ? '—' : points(step.after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div class="add-row">
        <span class="grow" />
        <button class="btn primary" onClick={() => confirm(plan ? 'Пачаць новы раўнд і перанесці балы, як у табліцы?' : 'Пачаць новы раўнд?')
          && run(() => api('/api/vote/next'), 'Новы раўнд адкрыты')}>Пачаць новы раўнд</button>
      </div>
    </Card>
  );
}
