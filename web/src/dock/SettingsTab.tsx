// Укладка «Налады»: кошты галасавання, выгляд оверлея, загалоўкі, адказы ў чат і рэзервовыя копіі.
import { useEffect, useState } from 'preact/hooks';
import { Section } from '../music/ui/dock/Section';
import { api, useAction, type CoreState, type Settings } from './core';
import { Check, Notice, NumberField, TextField } from './ui';

const SAMPLE: Record<string, string> = { title: 'Тэставая гульня', amount: '500', score: '5000', profile: ' https://steamcommunity.com/…', suggestions: 'Гульня A / Гульня B' };

export function SettingsTab({ state }: { state: CoreState }) {
  const { notice, run } = useAction();
  const [draft, setDraft] = useState<Settings>(state.settings);
  const [costs, setCosts] = useState(state.settings.twitch.supportCosts.join(', '));
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (dirty) return;
    setDraft(state.settings);
    setCosts(state.settings.twitch.supportCosts.join(', '));
  }, [JSON.stringify(state.settings)]);

  const edit = (update: (s: Settings) => Settings) => { setDraft(update); setDirty(true); };
  const display = (patch: Partial<Settings['display']>) => edit((s) => ({ ...s, display: { ...s.display, ...patch } }));
  const headlines = draft.display.headlines;
  const save = async () => {
    const supportCosts = costs.split(/[,\s]+/).filter(Boolean).map(Number);
    await api('/api/settings', { ...draft, twitch: { ...draft.twitch, supportCosts } });
    setDirty(false);
  };
  const costsChanged = costs.split(/[,\s]+/).filter(Boolean).map(Number).join(',') !== state.settings.twitch.supportCosts.join(',')
    || draft.twitch.addCost !== state.settings.twitch.addCost;

  return (
    <div class="settings">
      <div class="sticky-save">
        <button class="btn primary" disabled={!dirty} onClick={() => run(save, 'Налады захаваны')}>Захаваць налады</button>
        {dirty && <button class="btn" onClick={() => { setDraft(state.settings); setCosts(state.settings.twitch.supportCosts.join(', ')); setDirty(false); }}>Скасаваць</button>}
        <Notice notice={notice} />
      </div>

      <Section title="Узнагароды галасавання" help="Кошт дадавання гульні і кошты падтрымкі. Пасля змены захавайце налады і націсніце «Абнавіць узнагароды»: праграма зменіць кошты ў Twitch і створыць новыя ўзнагароды, калі іх стала больш. Назвы, змененыя вамі ў Twitch, застаюцца.">
        <NumberField label="Дадаць гульню" value={draft.twitch.addCost} min={1} onChange={(addCost) => edit((s) => ({ ...s, twitch: { ...s.twitch, addCost } }))} />
        <TextField label="Падтрымка (праз коску)" value={costs} onChange={(v) => { setCosts(v); setDirty(true); }} />
        <div class="row-actions">
          <button class="btn" disabled={dirty || costsChanged} onClick={() => run(() => api('/api/voting/sync-rewards'), 'Узнагароды абноўлены')}>Абнавіць узнагароды ў Twitch</button>
        </div>
      </Section>

      <Section title="Загалоўкі над спісам" help="Радкі па чарзе паказваюцца ў верхняй плашцы оверлея. ▶ — паказаць адразу (спачатку захавайце).">
        {headlines.map((text, index) => (
          <div class="inline" key={index}>
            <button class="icon-btn small" title="Паказаць зараз" aria-label="Паказаць зараз" disabled={dirty}
              onClick={() => run(() => api('/api/headline/show', { index }), 'Загаловак на экране')}>▶</button>
            <input value={text} maxLength={120} aria-label={`Загаловак ${index + 1}`}
              onInput={(e) => display({ headlines: headlines.map((h, i) => (i === index ? e.currentTarget.value : h)) })} />
            <button class="icon-btn small" title="Вышэй" aria-label="Вышэй" disabled={index === 0}
              onClick={() => { const list = [...headlines]; list.splice(index - 1, 0, list.splice(index, 1)[0]); display({ headlines: list }); }}>↑</button>
            <button class="icon-btn small danger" title="Выдаліць" aria-label="Выдаліць загаловак" onClick={() => display({ headlines: headlines.filter((_, i) => i !== index) })}>✕</button>
          </div>
        ))}
        <button class="btn" disabled={headlines.length >= 20} onClick={() => display({ headlines: [...headlines, 'Новы загаловак'] })}>+ Загаловак</button>
        <div class="grid">
          <NumberField label="Загаловак, с" value={draft.display.headlineDuration} min={1} max={300} onChange={(headlineDuration) => display({ headlineDuration })} />
          <NumberField label="Абвестка, с" value={draft.display.duration} min={1} max={60} onChange={(duration) => display({ duration })} />
        </div>
      </Section>

      <Section title="Выгляд оверлея">
        <div class="grid">
          <TextField label="Шрыфт" value={draft.display.font} onChange={(font) => display({ font })} />
          <NumberField label="Памер" value={draft.display.size} min={8} max={150} onChange={(size) => display({ size })} />
          <label class="field"><span>Колер</span><input type="color" value={draft.display.color} onInput={(e) => display({ color: e.currentTarget.value })} /></label>
          <NumberField label="Пракрутка, px/с" value={draft.display.speed} min={0} max={200} onChange={(speed) => display({ speed })} />
          <NumberField label="Шырыня, px" value={draft.display.width} min={200} max={1600} onChange={(width) => display({ width })} />
          <NumberField label="Вышыня спіса, %" value={draft.display.height} min={10} max={80} onChange={(height) => display({ height })} />
          <NumberField label="Фон загалоўка, %" value={Math.round(draft.display.headerOpacity * 100)} min={0} max={100} onChange={(v) => display({ headerOpacity: v / 100 })} />
          <NumberField label="Фон спіса, %" value={Math.round(draft.display.listOpacity * 100)} min={0} max={100} onChange={(v) => display({ listOpacity: v / 100 })} />
        </div>
        <Check label="Гук абвестак" checked={draft.display.sound} onChange={(sound) => display({ sound })} />
        <label class="field">
          <span>Гучнасць — {Math.round(draft.display.volume * 100)}%</span>
          <input class="range" type="range" min={0} max={1} step={0.05} value={draft.display.volume} onInput={(e) => display({ volume: Number(e.currentTarget.value) })} />
        </label>
      </Section>

      <Section title="Адказы ў чат" help="Праграма адказвае гледачу ў чаце ад вашага імя пасля пакупкі ў галасаванні. Падстаноўкі ў фігурных дужках.">
        <Check label="Адказваць гледачам" checked={draft.replies.enabled} onChange={(enabled) => edit((s) => ({ ...s, replies: { ...s.replies, enabled } }))} />
        {draft.replies.enabled && Object.entries(draft.replies.templates).map(([key, value]) => (
          <label class="field" key={key}>
            <span>{state.replyDefinitions[key]?.[0] ?? key}</span>
            <textarea rows={2} maxLength={350} value={value}
              onInput={(e) => edit((s) => ({ ...s, replies: { ...s.replies, templates: { ...s.replies.templates, [key]: e.currentTarget.value } } }))} />
            <small class="muted">
              {(state.replyPlaceholders[key] ?? []).length ? `Падстаноўкі: ${state.replyPlaceholders[key].map((p) => `{${p}}`).join(', ')} · ` : ''}
              {value.replace(/\{(\w+)\}/g, (_, k: string) => SAMPLE[k] ?? `{${k}}`)}
            </small>
          </label>
        ))}
      </Section>

      <Section title="Рэзервовыя копіі" help="Праграма робіць копію базы галасавання кожныя 10 хвілін (калі нешта змянілася) і адну ў дзень — у асобную тэчку, 90 дзён. Лепш, каб тэчка была на іншым дыску або ў воблаку.">
        <TextField label="Тэчка дзённых копій" value={draft.backup.directory} placeholder={state.backups.external}
          onChange={(directory) => edit((s) => ({ ...s, backup: { directory } }))} />
      </Section>
    </div>
  );
}
