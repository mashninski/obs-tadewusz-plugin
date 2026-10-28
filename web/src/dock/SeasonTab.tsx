// Укладка «Сезон»: лятучыя аб’екты па-над сцэнай — прывіды, сняжынкі, лісце, пялёсткі або свае карцінкі.
// Змены захоўваюцца самі праз імгненне пасля праўкі; старонка ў OBS бярэ іх сама.
import { useRef, useState } from 'preact/hooks';
import { api, errorText, refresh, run, useDraft, type CoreState, type SeasonConfig, type SeasonMotion, type SeasonTheme } from './core';
import { Card, Hero, IconButton, NumberField, Switch, toast } from './ui';

const THEMES: { id: SeasonTheme; label: string }[] = [
  { id: 'halloween', label: 'Хэлоўін — прывіды' },
  { id: 'winter', label: 'Зіма — сняжынкі' },
  { id: 'autumn', label: 'Восень — лісце' },
  { id: 'spring', label: 'Вясна — пялёсткі' },
  { id: 'custom', label: 'Свая — толькі свае карцінкі' },
];

const MOTIONS: { id: SeasonMotion; label: string }[] = [
  { id: 'auto', label: 'Як у тэмы' },
  { id: 'float', label: 'Плаваюць' },
  { id: 'fall', label: 'Падаюць' },
  { id: 'tumble', label: 'Кульгаюцца на ветры' },
];

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/** Файл → base64 без прэфікса `data:…;base64,`. */
const base64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
  reader.onerror = () => reject(new Error('season_image'));
  reader.readAsDataURL(file);
});

export function SeasonTab({ state }: { state: CoreState }) {
  const season = state.season;
  const [draft, update] = useDraft<SeasonConfig>(season.config, (config) => api('/api/season/config', config));
  const set = (patch: Partial<SeasonConfig>) => update({ ...draft, ...patch });
  const images = season.images[draft.theme] ?? [];
  const theme = THEMES.find((t) => t.id === draft.theme)!;
  const empty = draft.theme === 'custom' && images.length === 0;

  return (
    <>
      <Hero tone={!draft.enabled ? 'off' : empty ? 'wait' : 'good'}
        title={draft.enabled ? theme.label : 'Сезон выключаны'}
        detail={empty ? 'Дадайце свае карцінкі ніжэй' : draft.enabled ? `${draft.count} шт. на экране` : 'Уключыце, каб аб’екты з’явіліся ў крыніцы'}>
        <button class="btn primary" disabled={!state.obs.connected} title={state.obs.connected ? '' : 'OBS не падключаны'}
          onClick={async () => {
            const result = await run(() => api<{ sceneName: string; inputCreated: boolean; itemCreated: boolean }>('/api/season/source'), '');
            if (result) toast(result.itemCreated ? `Крыніца «Сезон» дададзена ў сцэну «${result.sceneName}»` : `Крыніца «Сезон» абноўлена ў сцэне «${result.sceneName}»`);
          }}>Дадаць крыніцу ў OBS</button>
      </Hero>

      <Card title="Выгляд"
        help={'Празрыстая крыніца «Tadewusz · Сезон» на ўвесь кадр — верхнім слоем у сцэне, якая зараз у праграме. У іншыя сцэны яе можна дадаць у OBS як існуючую крыніцу.\n\nАб’екты рухаюцца павольна і не затрымліваюцца ў цэнтры кадра. Пакуль крыніца схаваная, старонка нічога не малюе.\n\n«Растаюць і з’яўляюцца» — кожны аб’ект часам плаўна знікае і з’яўляецца ў іншым месцы.'}>
        <div class="stack">
          <Switch label="Паказваць" checked={draft.enabled} onChange={(enabled) => set({ enabled })} />
          <div class="fields wide">
            <label class="field"><span>Тэма</span>
              <select value={draft.theme} onChange={(e) => set({ theme: e.currentTarget.value as SeasonTheme })}>
                {THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>
            <label class="field"><span>Рух</span>
              <select value={draft.motion} onChange={(e) => set({ motion: e.currentTarget.value as SeasonMotion })}>
                {MOTIONS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
          </div>
          <div class="fields">
            <NumberField label="Колькасць" value={draft.count} min={1} max={40} onChange={(n) => set({ count: clamp(Math.round(n), 1, 40) })} />
            <NumberField label="Памер" suffix="px" value={draft.size} min={16} max={256} onChange={(n) => set({ size: clamp(Math.round(n), 16, 256) })} />
            <NumberField label="Хуткасць" suffix="%" value={Math.round(draft.speed * 100)} min={20} max={300} step={10}
              onChange={(n) => set({ speed: clamp(Math.round(n), 20, 300) / 100 })} />
            <NumberField label="Непразрыстасць" suffix="%" value={Math.round(draft.opacity * 100)} min={5} max={100} step={5}
              onChange={(n) => set({ opacity: clamp(Math.round(n), 5, 100) / 100 })} />
          </div>
          <Switch label="Растаюць і з’яўляюцца ў іншым месцы" checked={draft.fade} onChange={(fade) => set({ fade })} />
        </div>
      </Card>

      <Images theme={draft.theme} images={images} max={season.maxImages} maxBytes={season.maxBytes} />
    </>
  );
}

function Images({ theme, images, max, maxBytes }: { theme: SeasonTheme; images: string[]; max: number; maxBytes: number }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    let added = 0;
    for (const file of [...files].slice(0, Math.max(0, max - images.length))) {
      try {
        if (file.size > maxBytes) throw new Error('season_image_size');
        await api('/api/season/upload', { theme, data: await base64(file) });
        added++;
      } catch (error) {
        toast(`${file.name}: ${errorText(error)}`, true);
      }
    }
    if (files.length > max - images.length) toast(`Не больш за ${max} карцінак у тэме`, true);
    if (added) toast(added === 1 ? 'Карцінка дададзена' : `Дададзена карцінак: ${added}`);
    if (input.current) input.current.value = '';
    setBusy(false);
    refresh();
  };

  return (
    <Card title={`Свае карцінкі · ${images.length} / ${max}`}
      actions={<button class="btn" disabled={busy || images.length >= max} onClick={() => input.current?.click()}>{busy ? 'Загружаю…' : 'Дадаць'}</button>}
      help={'PNG, WebP або SVG да 2 МБ, не больш за 20 у тэме. Лепш — з празрыстым фонам, каля 256 px.\n\nСвае карцінкі лётаюць разам з убудаванымі аб’ектамі тэмы; у тэме «Свая» — толькі яны. Рух выбіраецца вышэй.\n\nФайлы захоўваюцца ў тэчцы даных праграмы (data\\season).'}>
      <input ref={input} type="file" accept="image/png,image/webp,image/svg+xml,.png,.webp,.svg" multiple hidden
        onChange={(e) => void upload(e.currentTarget.files)} />
      {images.length ? (
        <ul class="season-images">
          {images.map((name) => (
            <li key={name}>
              <img src={`/season/image?theme=${theme}&name=${name}`} alt="" loading="lazy" />
              <IconButton icon="close" label="Выдаліць карцінку" tone="danger"
                onClick={() => run(() => api('/api/season/remove', { theme, name }), 'Карцінка выдалена')} />
            </li>
          ))}
        </ul>
      ) : <p class="empty-line">Сваіх карцінак у гэтай тэме няма</p>}
    </Card>
  );
}
