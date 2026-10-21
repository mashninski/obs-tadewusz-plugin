// Укладка «Налады»: узнагароды галасавання, загалоўкі і выгляд оверлея, адказы ў чат.
// Змены захоўваюцца самі праз імгненне пасля праўкі — як аб’явы радка і правілы музыкі.
import { useState } from 'preact/hooks';
import { api, run, useDraft, type CoreState, type Settings } from './core';
import { Card, IconButton, moveItem, NumberField, Switch, TextField, useSortable } from './ui';

const parseCosts = (text: string) => text.split(/[,\s]+/).filter(Boolean).map(Number);
const validCosts = (costs: number[]) => costs.length > 0 && costs.every((n) => Number.isInteger(n) && n > 0);

export function SettingsTab({ state }: { state: CoreState }) {
  const [draft, update] = useDraft<Settings>(state.settings, (settings) => api('/api/settings', settings));
  const display = (patch: Partial<Settings['display']>, ready = true) => update({ ...draft, display: { ...draft.display, ...patch } }, ready);

  return (
    <>
      <VotingRewards state={state} draft={draft} update={update} />
      <Headlines draft={draft} display={display} />
      <Replies state={state} draft={draft} update={update} />

      <Card title="Выгляд оверлея" collapsible>
        <div class="stack">
          <div class="fields">
            <TextField label="Шрыфт" value={draft.display.font} onChange={(font) => display({ font }, !!font.trim())} />
            <NumberField label="Памер" suffix="px" value={draft.display.size} min={8} max={150} onChange={(size) => display({ size })} />
            <label class="field"><span>Колер</span><input type="color" value={draft.display.color} onInput={(e) => display({ color: e.currentTarget.value })} /></label>
            <NumberField label="Пракрутка" suffix="px/с" value={draft.display.speed} min={0} max={200} onChange={(speed) => display({ speed })} />
            <NumberField label="Шырыня" suffix="px" value={draft.display.width} min={200} max={1600} onChange={(width) => display({ width })} />
            <NumberField label="Вышыня спіса" suffix="%" value={draft.display.height} min={10} max={80} onChange={(height) => display({ height })} />
            <NumberField label="Фон загалоўка" suffix="%" value={Math.round(draft.display.headerOpacity * 100)} min={0} max={100} onChange={(v) => display({ headerOpacity: v / 100 })} />
            <NumberField label="Фон спіса" suffix="%" value={Math.round(draft.display.listOpacity * 100)} min={0} max={100} onChange={(v) => display({ listOpacity: v / 100 })} />
          </div>
          <div class="inline">
            <Switch label="Гук абвестак" checked={draft.display.sound} onChange={(sound) => display({ sound })} />
            <input type="range" min={0} max={1} step={0.05} value={draft.display.volume} disabled={!draft.display.sound} aria-label="Гучнасць абвестак"
              style={{ '--v': `${draft.display.volume * 100}%`, flex: 1 }} onInput={(e) => display({ volume: Number(e.currentTarget.value) })} />
            <span class="count" style={{ width: 32, textAlign: 'right' }}>{Math.round(draft.display.volume * 100)}%</span>
          </div>
        </div>
      </Card>
    </>
  );
}

function VotingRewards({ state, draft, update }: { state: CoreState; draft: Settings; update: (s: Settings, ready?: boolean) => void }) {
  const [costs, setCosts] = useState(draft.twitch.supportCosts.join(', '));
  const synced = state.settings.twitch.addCost === draft.twitch.addCost
    && state.settings.twitch.supportCosts.join(',') === parseCosts(costs).join(',');
  return (
    <Card title="Узнагароды галасавання"
      actions={<button class="btn" disabled={!synced} onClick={() => run(() => api('/api/voting/sync-rewards'), 'Узнагароды абноўлены ў Twitch')}>Абнавіць у Twitch</button>}
      help="Кошт дадавання гульні і кошты падтрымкі. Пасля змены націсніце «Абнавіць у Twitch»: праграма зменіць кошты і створыць новыя ўзнагароды, калі іх стала больш. Назвы, змененыя вамі ў Twitch, застаюцца.">
      <div class="fields wide">
        <NumberField label="Дадаць гульню" value={draft.twitch.addCost} min={1} onChange={(addCost) => update({ ...draft, twitch: { ...draft.twitch, addCost } })} />
        <TextField label="Падтрымка, праз коску" value={costs} onChange={(text) => {
          setCosts(text);
          const supportCosts = parseCosts(text);
          update({ ...draft, twitch: { ...draft.twitch, supportCosts: validCosts(supportCosts) ? supportCosts : draft.twitch.supportCosts } }, validCosts(supportCosts));
        }} />
      </div>
    </Card>
  );
}

function Headlines({ draft, display }: { draft: Settings; display: (patch: Partial<Settings['display']>, ready?: boolean) => void }) {
  const list = draft.display.headlines;
  const set = (next: string[]) => display({ headlines: next }, next.every((h) => h.trim()));
  const sortable = useSortable((from, to) => set(moveItem(list, from, to)));
  return (
    <Card title="Загалоўкі над спісам" flush
      actions={<IconButton icon="plus" label="Новы загаловак" disabled={list.length >= 20} onClick={() => display({ headlines: [...list, ''] }, false)} />}
      help="Радкі па чарзе паказваюцца ў верхняй плашцы оверлея галасавання. ▶ — паказаць адразу. Парадак — перацягваннем за ⠿.">
      <ul class="list">
        {list.map((text, index) => {
          const row = sortable.row(index);
          return (
            <li key={index} {...row}>
              <span class="icon-btn small handle" title="Перацягнуць" {...sortable.handle(index)}>⠿</span>
              <input class="bare grow" value={text} maxLength={120} placeholder="Тэкст загалоўка" aria-label={`Загаловак ${index + 1}`}
                onInput={(e) => set(list.map((h, i) => (i === index ? e.currentTarget.value : h)))} />
              <div class="row-tools">
                <IconButton icon="play" label="Паказаць зараз" disabled={!text.trim()}
                  onClick={() => run(() => api('/api/headline/show', { index }), 'Загаловак на экране')} />
                <IconButton icon="close" label="Выдаліць загаловак" tone="danger" onClick={() => set(list.filter((_, i) => i !== index))} />
              </div>
            </li>
          );
        })}
      </ul>
      {list.length === 0 && <p class="empty-line">Загалоўкаў няма</p>}
      <div class="add-row">
        <span class="muted small">Загаловак</span>
        <input type="number" min={1} max={300} value={draft.display.headlineDuration} aria-label="Загаловак, секунд" style={{ width: 56, flex: 'none' }}
          onChange={(e) => display({ headlineDuration: Number(e.currentTarget.value) })} />
        <span class="muted small">с</span>
        <span class="grow" />
        <span class="muted small">Абвестка</span>
        <input type="number" min={1} max={60} value={draft.display.duration} aria-label="Абвестка, секунд" style={{ width: 56, flex: 'none' }}
          onChange={(e) => display({ duration: Number(e.currentTarget.value) })} />
        <span class="muted small">с</span>
      </div>
    </Card>
  );
}

function Replies({ state, draft, update }: { state: CoreState; draft: Settings; update: (s: Settings, ready?: boolean) => void }) {
  const replies = draft.replies;
  const setTemplate = (key: string, value: string) => {
    const templates = { ...replies.templates, [key]: value };
    update({ ...draft, replies: { ...replies, templates } }, Object.values(templates).every((t) => t.trim() && !t.includes('\n')));
  };
  return (
    <Card title="Адказы ў чат" collapsible
      actions={<Switch label="" checked={replies.enabled} onChange={(enabled) => update({ ...draft, replies: { ...replies, enabled } })} />}
      help="Праграма адказвае гледачу ў чаце ад вашага імя пасля пакупкі ў галасаванні. Падстаноўкі ў фігурных дужках замяняюцца на назву гульні, колькасць балаў і г. д.">
      <div class="stack">
        {Object.entries(replies.templates).map(([key, value]) => {
          const placeholders = state.replyPlaceholders[key] ?? [];
          return (
            <label class="field" key={key}>
              <span>{state.replyDefinitions[key]?.[0] ?? key}</span>
              <textarea class="fit" rows={1} maxLength={350} value={value} disabled={!replies.enabled} onInput={(e) => setTemplate(key, e.currentTarget.value)} />
              {placeholders.length > 0 && <small class="faint">{placeholders.map((p) => `{${p}}`).join(' ')}</small>}
            </label>
          );
        })}
      </div>
    </Card>
  );
}
