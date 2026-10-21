// Укладка «Бягучы радок»: аб’явы стрымера, платныя паведамленні гледачоў, чарга і афармленне.
import { useEffect, useRef, useState } from 'preact/hooks';
import { boldParts, textLength, toggleBold } from '../../../shared/ticker-text.js';
import { Section } from '../music/ui/dock/Section';
import { api, useAction, type CoreState, type TickerConfig } from './core';
import { Check, Notice, NumberField, TextField, time } from './ui';

function rewardStatus(state: CoreState): { text: string; tone: string } {
  const t = state.ticker, r = t.reception;
  if (!r.reward) return { text: 'Узнагарода яшчэ не створана', tone: 'muted' };
  if (r.accepting) return { text: 'Узнагарода адкрытая: гледачы могуць купіць паведамленне', tone: 'good' };
  if (!r.wanted) return { text: 'Прыём выключаны: узнагарода схаваная', tone: 'muted' };
  if (state.twitch.state !== 'connected' || state.eventsub !== 'connected') return { text: 'Узнагарода схаваная: няма сувязі з Twitch', tone: 'bad' };
  if (!t.ready.source) return { text: 'Узнагарода схаваная: крыніца бягучага радка не бачная ў эфіры OBS', tone: 'bad' };
  if (!t.consumer) return { text: 'Узнагарода схаваная: старонка крыніцы не адказвае', tone: 'bad' };
  if (t.waiting) return { text: 'Узнагарода схаваная: паказ не атрымаўся, націсніце «Паўтарыць»', tone: 'bad' };
  return { text: 'Узнагарода схаваная: праверка…', tone: '' };
}

export function TickerTab({ state }: { state: CoreState }) {
  const { notice, run } = useAction();
  const ticker = state.ticker;
  const [draft, setDraft] = useState<TickerConfig>(ticker.config);
  const [dirty, setDirty] = useState(false);
  // Змены з іншага месца падхопліваюцца, пакуль стрымер нічога не правіць.
  useEffect(() => { if (!dirty) setDraft(ticker.config); }, [JSON.stringify(ticker.config)]);

  const update = (patch: Partial<TickerConfig>) => { setDraft((d) => ({ ...d, ...patch })); setDirty(true); };
  const save = async () => { await api('/api/ticker/config', draft); setDirty(false); };
  const job = ticker.current;
  const status = rewardStatus(state);
  const refunds = ticker.refunds.filter((r) => r.target === 'CANCELED');
  const failed = refunds.filter((r) => r.state !== 'done' && r.error).reduce((n, r) => n + r.count, 0);

  return (
    <div class="ticker">
      <section class="now-ticker">
        <p class="small">{job ? <>На экране: <b>{job.kind === 'paid' ? job.nick : 'аб’ява'}</b> · {job.text.slice(0, 80)}</> : 'Зараз на экране нічога'}</p>
        {job && job.state === 'showing' && (
          <button class="btn danger" onClick={() => run(() => api('/api/ticker/cancel', { id: job.id, attempt: job.attempt, generation: job.generation }),
            job.kind === 'paid' ? 'Паказ спынены · балы вернуцца гледачу' : 'Паказ спынены')}>✕ Спыніць паказ</button>
        )}
        {(ticker.waiting > 0 || ticker.error) && (
          <button class="btn" onClick={() => run(() => api('/api/ticker/retry'), 'Чарга адноўлена')}>Паўтарыць пасля памылкі</button>
        )}
      </section>
      <Notice notice={notice} />

      <Section title="Аб’явы" actions={
        <button class="btn" disabled={draft.announcements.length >= 40}
          onClick={() => update({ announcements: [...draft.announcements, { id: crypto.randomUUID(), text: '' }] })}>+ Аб’ява</button>
      } help="Аб’явы паказваюцца па чарзе праз інтэрвал (калі ўключана) або адразу кнопкай ▶. **Тлусты** тэкст — кнопкай Ж або Ctrl+B. Платныя паведамленні гледачоў ідуць у агульную чаргу.">
        {draft.announcements.map((a, index) => (
          <AnnouncementEditor key={a.id} text={a.text} first={index === 0} last={index === draft.announcements.length - 1}
            onChange={(text) => update({ announcements: draft.announcements.map((x) => (x.id === a.id ? { ...x, text } : x)) })}
            onMove={(delta) => {
              const list = [...draft.announcements];
              list.splice(index + delta, 0, list.splice(index, 1)[0]);
              update({ announcements: list });
            }}
            onDelete={() => update({ announcements: draft.announcements.filter((x) => x.id !== a.id) })}
            onShow={() => run(async () => { if (dirty) await save(); await api('/api/ticker/show', { id: a.id }); }, 'Аб’ява ў чарзе')} />
        ))}
        <Check label="Паказваць аб’явы па раскладзе" checked={draft.enabled} onChange={(enabled) => update({ enabled })} />
        <NumberField label="Інтэрвал, секунд" value={draft.interval} min={10} max={86400} onChange={(interval) => update({ interval })} />
        {draft.enabled && ticker.cycle.due && <p class="small muted">Наступная аб’ява каля {time(ticker.cycle.due)}</p>}
        <div class="row-actions">
          <button class="btn primary" disabled={!dirty} onClick={() => run(save, 'Захавана')}>Захаваць</button>
          {dirty && <button class="btn" onClick={() => { setDraft(ticker.config); setDirty(false); }}>Скасаваць змены</button>}
        </div>
      </Section>

      <Section title="Паведамленні гледачоў" help="Глядач купляе ўзнагароду і піша тэкст да 500 знакаў. Узнагарода адкрытая толькі тады, калі крыніца бягучага радка бачная ў эфіры OBS — за паведамленне, якое ніхто не ўбачыць, балы не спісваюцца. Пасля поўнага паказу пакупка пацвярджаецца; калі паказ спынены — балы вяртаюцца.">
        <p class={`small ${status.tone}`}>{status.text}</p>
        <div class="row-actions">
          {ticker.reception.wanted
            ? <button class="btn" onClick={() => run(() => api('/api/ticker/reception', { on: false }), 'Прыём выключаны')}>Выключыць прыём</button>
            : <button class="btn primary" disabled={!ticker.reception.reward} onClick={() => run(() => api('/api/ticker/reception', { on: true }), 'Прыём уключаны')}>Уключыць прыём</button>}
          <button class="btn" onClick={() => run(async () => { if (dirty) await save(); await api('/api/ticker/sync-reward'); }, 'Узнагарода абноўлена')}>
            {ticker.reception.reward ? 'Абнавіць узнагароду' : 'Стварыць узнагароду'}
          </button>
        </div>
        <NumberField label="Кошт паведамлення" value={draft.cost} min={1} onChange={(cost) => update({ cost })} />
        <TextField label="Назва ўзнагароды" value={draft.title} maxLength={45} onChange={(title) => update({ title })} />
        <TextField label="Падказка гледачу" value={draft.prompt} maxLength={200} onChange={(prompt) => update({ prompt })} />
        {failed > 0 && <p class="small bad">Не ўдалося вярнуць балы: {failed}. Праверце падключэнне Twitch.</p>}
      </Section>

      <Section title="Чарга">
        {ticker.queue.length ? (
          <ol class="ticker-queue">{ticker.queue.map((j) => <li key={j.id}>{j.nick ? <b>{j.nick}: </b> : null}{j.text.slice(0, 120)}</li>)}</ol>
        ) : <p class="small muted">Чарга пустая</p>}
      </Section>

      <Section title="Афармленне">
        <div class="grid">
          <NumberField label="Шырыня, px" value={draft.width} min={320} max={1920} onChange={(width) => update({ width })} />
          <NumberField label="Вышыня, px" value={draft.height} min={100} max={600} onChange={(height) => update({ height })} />
          <TextField label="Шрыфт" value={draft.font} onChange={(font) => update({ font })} />
          <NumberField label="Памер шрыфту, px" value={draft.size} min={16} max={80} onChange={(size) => update({ size })} />
          <NumberField label="Пракрутка, px/с" value={draft.speed} min={5} max={80} onChange={(speed) => update({ speed })} />
          <label class="field"><span>Акцэнт</span><input type="color" value={draft.accent} onInput={(e) => update({ accent: e.currentTarget.value })} /></label>
          <NumberField label="Непразрыстасць фону, %" value={Math.round(draft.opacity * 100)} min={0} max={100} onChange={(v) => update({ opacity: v / 100 })} />
        </div>
        <p class="small muted">Доўгі тэкст пракручваецца ўверх. <a href="/ticker?preview=1" target="_blank" rel="noopener">Папярэдні прагляд</a></p>
      </Section>
    </div>
  );
}

function AnnouncementEditor({ text, first, last, onChange, onMove, onDelete, onShow }: {
  text: string; first: boolean; last: boolean; onChange: (text: string) => void; onMove: (delta: number) => void; onDelete: () => void; onShow: () => void;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const bold = () => {
    const el = area.current;
    if (!el) return;
    const result = toggleBold(el.value, el.selectionStart, el.selectionEnd);
    onChange(result.text);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(result.start, result.end); });
  };
  const parts = boldParts(text);
  return (
    <div class="announcement">
      <textarea ref={area} rows={3} value={text} maxLength={4000} aria-label="Тэкст аб’явы" onInput={(e) => onChange(e.currentTarget.value)}
        onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); bold(); } }} />
      {parts.some((p) => p.bold) && (
        <div class="bold-preview">{parts.map((p, i) => (p.bold ? <strong key={i}>{p.text}</strong> : <span key={i}>{p.text}</span>))}</div>
      )}
      <div class="toolbar">
        <button class="icon-btn small" title="Паказаць зараз" aria-label="Паказаць зараз" onClick={onShow}>▶</button>
        <button class="icon-btn small" title="Тлусты шрыфт · Ctrl+B" aria-label="Тлусты шрыфт" onMouseDown={(e) => e.preventDefault()} onClick={bold}><b>Ж</b></button>
        <button class="icon-btn small" title="Вышэй" aria-label="Вышэй" disabled={first} onClick={() => onMove(-1)}>↑</button>
        <button class="icon-btn small" title="Ніжэй" aria-label="Ніжэй" disabled={last} onClick={() => onMove(1)}>↓</button>
        <button class="icon-btn small danger" title="Выдаліць" aria-label="Выдаліць аб’яву" onClick={onDelete}>✕</button>
        <span class={`count small ${textLength(text) > 2000 ? 'bad' : 'muted'}`}>{textLength(text)} / 2000</span>
      </div>
    </div>
  );
}

