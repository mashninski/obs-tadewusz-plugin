// Укладка «Галасаванне»: прыём пакупак, спіс пазіцый з баламі, завяршэнне раўнда і новы раўнд.
import { useEffect, useState } from 'preact/hooks';
import { Section } from '../music/ui/dock/Section';
import { api, useAction, type CoreState, type Entry } from './core';
import { Notice, points } from './ui';

const AVAILABILITY: Record<string, string> = {
  absent: 'Няма ў стрымера', available: 'Ёсць у стрымера', error: 'Памылка праверкі', unknown: 'Наяўнасць невядомая', disabled: '',
};

function receptionText(state: CoreState): { text: string; tone: string } {
  const r = state.reception, status = state.vote.status;
  if (state.twitch.state !== 'connected') return { text: 'Twitch не падключаны', tone: 'bad' };
  if (r.expectedRewards !== r.rewards) return { text: 'Узнагароды галасавання яшчэ не створаны', tone: 'bad' };
  if (status === 'finalizing') return { text: 'Вынік чакае зверкі з Twitch', tone: '' };
  if (status === 'closed') return { text: 'Раўнд завершаны', tone: 'muted' };
  if (!r.wanted || status === 'paused') return { text: 'Галасаванне прыпынена · узнагароды схаваныя', tone: 'muted' };
  if (state.eventsub !== 'connected') return { text: 'Падключэнне да Twitch…', tone: '' };
  if (!r.accepting) return { text: 'Зверка пакупак…', tone: '' };
  return { text: 'Галасаванне ідзе · узнагароды адкрытыя', tone: 'good' };
}

export function VotingTab({ state }: { state: CoreState }) {
  const { notice, run } = useAction();
  const vote = state.vote;
  const editable = vote.status === 'open' || vote.status === 'paused';
  const running = state.reception.wanted && vote.status === 'open';
  const status = receptionText(state);

  return (
    <div class="voting">
      <section class="voting-head">
        <p class={`status-line ${status.tone}`}>{status.text}</p>
        {editable && (
          <button class={`btn ${running ? '' : 'primary'}`}
            onClick={() => run(() => api(running ? '/api/voting/stop' : '/api/voting/start'), running ? 'Галасаванне прыпынена' : 'Галасаванне запушчана')}>
            {running ? 'Прыпыніць галасаванне' : 'Запусціць галасаванне'}
          </button>
        )}
        {state.reception.error && <p class="small bad">Апошняя памылка: {state.reception.error}</p>}
      </section>
      <Notice notice={notice} />

      {state.reviews.length > 0 && (
        <Section title="Знешнія скасаванні" help="Пакупку, за якую ўжо налічаны балы, скасавалі ў Twitch уручную. Балы аўтаматычна не мяняліся. Калі згодныя пакінуць іх, закрыйце разбор; калі не — спачатку выпраўце балы пазіцыі.">
          {state.reviews.map((review) => (
            <div class="review" key={review.id}>
              <span>{review.title ?? 'Выдаленая пазіцыя'} · {points(review.cost)}</span>
              <button class="btn" onClick={() => run(() => api('/api/vote/review', { id: review.id }), 'Разбор закрыты')}>Пакінуць балы</button>
            </div>
          ))}
        </Section>
      )}

      {vote.status === 'closed' ? <Closed state={state} run={run} /> : vote.status === 'finalizing' ? (
        <Section title="Завяршэнне">
          <p class="small">Прыём спынены. Праграма дагнала пакупкі з Twitch і зараз пакажа вынік.</p>
          {state.reception.error && <p class="small bad">Чакае: {state.reception.error}</p>}
        </Section>
      ) : (
        <>
          <Entries entries={vote.entries} run={run} />
          <AddEntry run={run} />
          <Countdown state={state} run={run} />
        </>
      )}
    </div>
  );
}

type Run = ReturnType<typeof useAction>['run'];

function Entries({ entries, run }: { entries: Entry[]; run: Run }) {
  const [open, setOpen] = useState<string | null>(null);
  const total = entries.reduce((sum, e) => sum + e.score, 0);
  return (
    <Section title={`Рэйтынг · ${entries.length} · ${points(total)}`}
      help="Націсніце на пазіцыю, каб змяніць балы, перайменаваць, перанесці балы на іншую пазіцыю або выдаліць. Код з трох літар глядач піша ва ўзнагародзе галасавання.">
      <ol class="entries">
        {entries.map((entry, index) => (
          <li key={entry.id} class={open === entry.id ? 'open' : ''}>
            <button class="entry" onClick={() => setOpen(open === entry.id ? null : entry.id)} aria-expanded={open === entry.id}>
              <span class="entry-rank">{index + 1}</span>
              <span class="entry-code">{entry.code}</span>
              <span class="entry-title">
                {entry.title}
                {AVAILABILITY[entry.availability ?? ''] && <small>{AVAILABILITY[entry.availability ?? '']}</small>}
              </span>
              <span class="entry-score">{points(entry.score)}</span>
            </button>
            {open === entry.id && <EntryEditor entry={entry} entries={entries} run={run} onDone={() => setOpen(null)} />}
          </li>
        ))}
      </ol>
      {entries.length === 0 && <p class="muted small">Пакуль няма пазіцый</p>}
    </Section>
  );
}

function EntryEditor({ entry, entries, run, onDone }: { entry: Entry; entries: Entry[]; run: Run; onDone: () => void }) {
  const [score, setScore] = useState(String(entry.score));
  const [title, setTitle] = useState(entry.title);
  const [target, setTarget] = useState('');
  useEffect(() => setScore(String(entry.score)), [entry.score]);

  const remove = async () => {
    const info = await run(() => api<{ score: number; refundable: number; review: boolean }>('/api/vote/removal-info', { id: entry.id }), '');
    if (!info) return;
    const lines = [`Выдаліць «${entry.title}»?`];
    if (info.score > 0) lines.push(`${points(info.score)} балаў згараць: Twitch не вяртае ўжо пацверджаныя галасы. Каб захаваць балы, спачатку перанясіце іх на іншую пазіцыю.`);
    if (info.refundable > 0) lines.push(`Глядачу вернецца кошт дадавання: ${points(info.refundable)}.`);
    if (!confirm(lines.join('\n\n'))) return;
    if (await run(() => api('/api/vote/remove', { id: entry.id, burn: info.score > 0 }), 'Пазіцыя выдалена') !== null) onDone();
  };

  return (
    <div class="entry-editor">
      <div class="inline">
        <input type="number" min={0} value={score} aria-label="Балы" onInput={(e) => setScore(e.currentTarget.value)} />
        <button class="btn" disabled={Number(score) === entry.score}
          onClick={() => run(() => api('/api/vote/edit', { id: entry.id, score: Number(score) }), 'Балы зменены')}>Змяніць балы</button>
      </div>
      <div class="inline">
        <input value={title} maxLength={100} aria-label="Назва" onInput={(e) => setTitle(e.currentTarget.value)} />
        <button class="btn" disabled={!title.trim() || title === entry.title}
          onClick={() => run(() => api('/api/vote/rename', { id: entry.id, title }), 'Назва зменена · код і балы захаваны')}>Перайменаваць</button>
      </div>
      {entry.score > 0 && (
        <div class="inline">
          <select value={target} aria-label="Куды перанесці балы" onChange={(e) => setTarget(e.currentTarget.value)}>
            <option value="">Перанесці балы на…</option>
            {entries.filter((e) => e.id !== entry.id).map((e) => <option key={e.id} value={e.id}>{e.code} · {e.title}</option>)}
          </select>
          <button class="btn" disabled={!target}
            onClick={() => {
              const to = entries.find((e) => e.id === target);
              if (to && confirm(`Перанесці ${points(entry.score)} балаў з «${entry.title}» на «${to.title}»?`))
                void run(() => api('/api/vote/move', { from: entry.id, to: target }), 'Балы перанесены');
            }}>Перанесці</button>
        </div>
      )}
      <div class="inline">
        <select value={entry.manual === true ? 'yes' : entry.manual === false ? 'no' : 'auto'} aria-label="Наяўнасць у стрымера"
          onChange={(e) => run(() => api('/api/vote/availability', { id: entry.id, manual: e.currentTarget.value === 'auto' ? null : e.currentTarget.value === 'yes' }))}>
          <option value="auto">Наяўнасць: аўтаматычна</option>
          <option value="yes">Ёсць у стрымера</option>
          <option value="no">Няма ў стрымера</option>
        </select>
        <button class="btn danger" onClick={() => void remove()}>Выдаліць</button>
      </div>
    </div>
  );
}

function AddEntry({ run }: { run: Run }) {
  const [title, setTitle] = useState('');
  return (
    <form class="inline add" onSubmit={(e) => {
      e.preventDefault();
      void run(() => api('/api/vote/add', { title }), 'Пазіцыя дададзена').then((r) => r !== null && setTitle(''));
    }}>
      <input value={title} maxLength={100} placeholder="Назва гульні або спасылка Steam" aria-label="Новая пазіцыя" onInput={(e) => setTitle(e.currentTarget.value)} />
      <button class="btn" disabled={!title.trim()}>Дадаць</button>
    </form>
  );
}

function Countdown({ state, run }: { state: CoreState; run: Run }) {
  const deadline = state.vote.deadline;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [deadline]);
  const offset = state.vote.serverNow - Date.now();
  const left = deadline ? Math.max(0, Math.ceil((deadline.due - now - offset) / 1000)) : 0;
  return (
    <Section title="Завяршэнне раўнда" help="«Праз 60 с» запускае таймер на экране; пасля яго прыём спыняецца, праграма дагоньвае пакупкі з Twitch і паказвае пераможцу. Новы раўнд пачынаецца асобнай кнопкай — з правілам пераносу балаў.">
      {deadline ? (
        <div class="inline">
          <span class="countdown">Да канца: {left} с</span>
          <button class="btn" onClick={() => run(() => api('/api/vote/countdown/cancel'), 'Таймер скасаваны')}>Скасаваць таймер</button>
        </div>
      ) : (
        <div class="inline">
          <button class="btn" onClick={() => run(() => api('/api/vote/countdown', { seconds: 60 }), 'Таймер запушчаны')}>Завяршыць праз 60 с</button>
          <button class="btn" onClick={() => confirm('Завяршыць раўнд зараз? Прыём спыніцца, вынік з’явіцца пасля зверкі з Twitch.')
            && run(() => api('/api/vote/close'), 'Раўнд завяршаецца')}>Завяршыць зараз</button>
        </div>
      )}
    </Section>
  );
}

function Closed({ state, run }: { state: CoreState; run: Run }) {
  const result = state.vote.result;
  const winner = result?.ranked.find((e) => e.id === result.winnerId);
  const plan = state.carryPreview;
  return (
    <Section title="Вынік раўнда" help="Правіла пераносу: пераможцу застаецца 1/5 балаў, месцам 2–6 — 2/3, астатнія без змен. Знізу выбывае па адной пазіцыі на кожныя поўныя 5 (6–10 пазіцый — 1, 11–15 — 2 і г. д.).">
      <p class="winner">{winner ? <>Пераможца: <b>{winner.title}</b> · {points(winner.score)}</> : 'Раўнд завершаны без пазіцый'}</p>
      {plan && (
        <table class="carry">
          <tbody>
            {plan.map((step) => (
              <tr key={step.id} class={step.removed ? 'removed' : ''}>
                <td>{step.title}</td>
                <td class="num">{points(step.before)}</td>
                <td class="num">{step.removed ? 'выбывае' : step.after === step.before ? '—' : points(step.after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button class="btn primary" onClick={() => confirm(plan ? 'Пачаць новы раўнд і прымяніць перанос балаў, як у табліцы?' : 'Пачаць новы раўнд?')
        && run(() => api('/api/vote/next'), 'Новы раўнд адкрыты')}>Пачаць новы раўнд</button>
    </Section>
  );
}
