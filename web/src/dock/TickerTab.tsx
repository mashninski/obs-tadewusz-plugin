// Укладка «Радок»: прыём платных паведамленняў, што ў эфіры зараз і далей, аб’явы стрымера.
// Змены аб’яў захоўваюцца самі (праз імгненне пасля праўкі); пустая аб’ява жыве толькі ў доку, пакуль у ёй няма тэксту.
import { useEffect, useRef, useState } from 'preact/hooks';
import { boldParts, textLength, toggleBold } from '../../../shared/ticker-text.js';
import { api, errorText, run, type Announcement, type CoreState, type TickerConfig } from './core';
import { Card, Hero, IconButton, moveItem, NumberField, Switch, TextField, time, toast, useSortable } from './ui';

function status(state: CoreState): { tone: 'good' | 'bad' | 'wait' | 'off'; title: string; detail: string } {
  const t = state.ticker, r = t.reception;
  if (!r.wanted) return { tone: 'off', title: 'Паведамленні гледачоў выключаны', detail: 'Узнагарода схаваная ад гледачоў' };
  if (!r.reward) return { tone: 'bad', title: 'Узнагарода не створана', detail: state.twitch.state === 'connected' ? '«Стварыць у Twitch» у блоку «Узнагарода»' : 'Падключыце Twitch' };
  if (r.accepting) return { tone: 'good', title: 'Паведамленні гледачоў прымаюцца', detail: 'Узнагарода адкрытая' };
  if (state.twitch.state !== 'connected' || state.eventsub !== 'connected') return { tone: 'bad', title: 'Прыём чакае Twitch', detail: 'Няма сувязі з Twitch' };
  if (!t.ready.source) return { tone: 'wait', title: 'Прыём чакае', detail: 'Крыніца радка не бачная ў эфірнай сцэне OBS' };
  if (!t.consumer) return { tone: 'wait', title: 'Прыём чакае', detail: 'Старонка радка ў OBS не адказвае' };
  if (t.waiting) return { tone: 'bad', title: 'Прыём спынены', detail: 'Паказ не атрымаўся — «Паўтарыць» у блоку «Эфір»' };
  return { tone: 'wait', title: 'Прыём чакае', detail: 'Праверка…' };
}

export function TickerTab({ state }: { state: CoreState }) {
  const ticker = state.ticker;
  const s = status(state);
  const [draft, setDraft] = useState<TickerConfig>(ticker.config);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Пакуль стрымер нічога не правіць, док паказвае захаваныя налады.
  useEffect(() => { if (!dirty.current) setDraft(ticker.config); }, [JSON.stringify(ticker.config)]);

  const save = (next: TickerConfig) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        await api('/api/ticker/config', { ...next, announcements: next.announcements.filter((a) => a.text.trim()) });
        dirty.current = next.announcements.some((a) => !a.text.trim());
      } catch (error) {
        toast(errorText(error), true);
      }
    }, 700);
  };
  const update = (patch: Partial<TickerConfig>) => {
    const next = { ...draft, ...patch };
    dirty.current = true;
    setDraft(next);
    save(next);
  };

  return (
    <>
      <Hero tone={s.tone} title={s.title} detail={s.detail}>
        {ticker.reception.wanted
          ? <button class="btn" onClick={() => run(() => api('/api/ticker/reception', { on: false }), 'Прыём выключаны')}>Выключыць</button>
          : <button class="btn primary" onClick={() => run(async () => {
              if (!ticker.reception.reward) await api('/api/ticker/sync-reward');
              await api('/api/ticker/reception', { on: true });
            }, 'Прыём уключаны')}>Уключыць</button>}
      </Hero>

      <Air state={state} config={draft} />

      <Announcements draft={draft} update={update} />

      <Card title="Узнагарода" collapsible help="Узнагарода «Паведамленне на экране» адкрытая толькі тады, калі радок бачны ў эфіры OBS — за паведамленне, якое ніхто не ўбачыць, балы не спісваюцца. Пасля поўнага паказу пакупка пацвярджаецца, пры спыненні паказу балы вяртаюцца.">
        <div class="stack">
          <div class="fields wide">
            <TextField label="Назва" value={draft.title} maxLength={45} onChange={(title) => update({ title })} />
            <NumberField label="Кошт" value={draft.cost} min={1} onChange={(cost) => update({ cost })} />
          </div>
          <TextField label="Падказка гледачу" value={draft.prompt} maxLength={200} onChange={(prompt) => update({ prompt })} />
          <div class="actions">
            <button class="btn" onClick={() => run(() => api('/api/ticker/sync-reward'), 'Узнагарода абноўлена ў Twitch')}>
              {ticker.reception.reward ? 'Абнавіць у Twitch' : 'Стварыць у Twitch'}
            </button>
          </div>
        </div>
      </Card>

      <Card title="Афармленне" collapsible>
        <div class="fields">
          <NumberField label="Шырыня" suffix="px" value={draft.width} min={320} max={1920} onChange={(width) => update({ width })} />
          <NumberField label="Вышыня" suffix="px" value={draft.height} min={100} max={600} onChange={(height) => update({ height })} />
          <TextField label="Шрыфт" value={draft.font} onChange={(font) => update({ font })} />
          <NumberField label="Памер" suffix="px" value={draft.size} min={16} max={80} onChange={(size) => update({ size })} />
          <NumberField label="Пракрутка" suffix="px/с" value={draft.speed} min={5} max={80} onChange={(speed) => update({ speed })} />
          <NumberField label="Фон" suffix="%" value={Math.round(draft.opacity * 100)} min={0} max={100} onChange={(v) => update({ opacity: v / 100 })} />
          <label class="field"><span>Акцэнт</span><input type="color" value={draft.accent} onInput={(e) => update({ accent: e.currentTarget.value })} /></label>
        </div>
        <p class="hint"><a class="text-btn" href="/ticker?preview=1" target="_blank" rel="noopener">Папярэдні прагляд</a></p>
      </Card>
    </>
  );
}

/** Эфір: два пастаянныя радкі — што на экране зараз і што будзе далей. */
function Air({ state, config }: { state: CoreState; config: TickerConfig }) {
  const t = state.ticker, job = t.current;
  const next = t.queue.find((j) => j.state === 'queued');
  const cycleNext = (t.cycle as { next?: string | null }).next;
  const scheduled = config.enabled ? config.announcements.find((a) => a.id === cycleNext) ?? config.announcements[0] : null;
  const label = (text: string, nick?: string) => (nick ? <><b>{nick}</b>: {text}</> : text.replace(/\*\*/g, ''));
  return (
    <Card title={`Эфір${t.queue.length > 1 ? ` · у чарзе ${t.queue.length}` : ''}`} flush>
      <ul class="list air">
        <li>
          <span class="air-label">Зараз</span>
          <span class={`air-text ellipsis ${job ? '' : 'faint'}`}>{job ? label(job.text, job.kind === 'paid' ? job.nick : undefined) : 'нічога'}</span>
          {t.waiting > 0 || t.error
            ? <button class="btn" onClick={() => run(() => api('/api/ticker/retry'), 'Чарга адноўлена')}>Паўтарыць</button>
            : <IconButton icon="stop" label={job?.kind === 'paid' ? 'Спыніць паказ (балы вернуцца)' : 'Спыніць паказ'} tone="danger"
                disabled={!job || job.state !== 'showing'}
                onClick={() => job && run(() => api('/api/ticker/cancel', { id: job.id, attempt: job.attempt, generation: job.generation }), 'Паказ спынены')} />}
        </li>
        <li>
          <span class="air-label">Далей</span>
          <span class={`air-text ellipsis ${next || scheduled ? '' : 'faint'}`}>
            {next ? label(next.text, next.kind === 'paid' ? next.nick : undefined)
              : scheduled ? <>{label(scheduled.text.split('\n')[0])}{t.cycle.due ? <span class="faint"> · {time(t.cycle.due)}</span> : null}</>
                : 'нічога'}
          </span>
        </li>
      </ul>
    </Card>
  );
}

function Announcements({ draft, update }: { draft: TickerConfig; update: (patch: Partial<TickerConfig>) => void }) {
  const list = draft.announcements;
  const sortable = useSortable((from, to) => update({ announcements: moveItem(list, from, to) }));
  const set = (id: string, text: string) => update({ announcements: list.map((a) => (a.id === id ? { ...a, text } : a)) });
  return (
    <Card title="Аб’явы" flush
      actions={<IconButton icon="plus" label="Новая аб’ява" disabled={list.length >= 40}
        onClick={() => update({ announcements: [...list, { id: crypto.randomUUID(), text: '' }] })} />}
      help={'Аб’явы ідуць па чарзе праз інтэрвал (калі ўключана «Па раскладзе») або адразу кнопкай ▶.\n\nТлусты тэкст — **так** або Ctrl+B. Парадак — перацягваннем за ⠿. Змены захоўваюцца самі.'}>
      <div class="add-row" style={{ borderTop: 0, paddingTop: 2 }}>
        <Switch label="Па раскладзе" checked={draft.enabled} onChange={(enabled) => update({ enabled })} />
        <span class="grow" />
        <span class="muted small">кожныя</span>
        <input type="number" min={10} max={86400} value={draft.interval} style={{ width: 70, flex: 'none' }} aria-label="Інтэрвал, секунд"
          onChange={(e) => update({ interval: Number(e.currentTarget.value) })} />
        <span class="muted small">с</span>
      </div>
      <ul class="list">
        {list.map((a, index) => {
          const row = sortable.row(index);
          return (
            <li key={a.id} {...row} class={`announcement ${row.class}`}>
              <span class="icon-btn small handle" title="Перацягнуць" {...sortable.handle(index)}>⠿</span>
              <AnnouncementText announcement={a} onChange={(text) => set(a.id, text)} />
              <div class="row-tools">
                <IconButton icon="play" label="Паказаць зараз" disabled={!a.text.trim()}
                  onClick={() => run(() => api('/api/ticker/show', { id: a.id }), 'Аб’ява ў чарзе')} />
                <IconButton icon="close" label="Выдаліць аб’яву" tone="danger"
                  onClick={() => (!a.text.trim() || confirm('Выдаліць аб’яву?')) && update({ announcements: list.filter((x) => x.id !== a.id) })} />
              </div>
            </li>
          );
        })}
      </ul>
      {list.length === 0 && <p class="empty-line">Аб’яў пакуль няма</p>}
    </Card>
  );
}

/** Тэкст аб’явы: у спакоі — з тлустым шрыфтам, па кліку — поле рэдагавання. */
function AnnouncementText({ announcement, onChange }: { announcement: Announcement; onChange: (text: string) => void }) {
  const [editing, setEditing] = useState(!announcement.text);
  const [text, setText] = useState(announcement.text);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (!editing) setText(announcement.text); }, [announcement.text, editing]);
  useEffect(() => { if (editing) area.current?.focus(); }, [editing]);

  const change = (value: string) => { setText(value); onChange(value); };
  const bold = () => {
    const el = area.current;
    if (!el) return;
    const result = toggleBold(el.value, el.selectionStart, el.selectionEnd);
    change(result.text);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(result.start, result.end); });
  };

  if (!editing) {
    return (
      <div class={`announcement-text ${text ? '' : 'empty'}`} role="button" tabIndex={0} title="Рэдагаваць"
        onClick={() => setEditing(true)} onKeyDown={(e) => e.key === 'Enter' && setEditing(true)}>
        {text ? boldParts(text).map((p, i) => (p.bold ? <strong key={i}>{p.text}</strong> : <span key={i}>{p.text}</span>)) : 'Пустая аб’ява'}
      </div>
    );
  }
  return (
    <>
      <textarea ref={area} rows={Math.min(6, Math.max(2, text.split('\n').length))} value={text} maxLength={4000} aria-label="Тэкст аб’явы"
        onInput={(e) => change(e.currentTarget.value)} onBlur={() => text.trim() && setEditing(false)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); bold(); }
          if (e.key === 'Escape') setEditing(false);
        }} />
      <div class="row-tools" style={{ flexDirection: 'column' }}>
        <IconButton icon="bold" label="Тлусты шрыфт · Ctrl+B" onMouseDown={(e) => e.preventDefault()} onClick={bold} />
        <span class={`count ${textLength(text) > 2000 ? 'bad' : ''}`}>{textLength(text)}</span>
      </div>
    </>
  );
}
