// Оверлей галасавання. Мадэлі руху (пракрутка спіса, змена загалоўкаў) — чыстыя класы, іх правяраюць тэсты.
import { scheduleCue } from './sound.js';

export function elasticProgress(value) {
  const p = Math.max(0, Math.min(1, value));
  const base = .5 - .5 * Math.cos(Math.PI * p);
  return Math.max(0, Math.min(1, base + .012 * Math.sin(6 * Math.PI * p) * Math.sin(Math.PI * p) ** 2));
}
export class ScrollLoop {
  constructor() { this.position = 0; this.max = 0; this.speed = 0; this.direction = 1; this.phase = 'hold'; this.at = 0; }
  configure(max, speed, now) {
    max = Math.max(0, Number.isFinite(max) ? max : 0); speed = Math.max(0, Number.isFinite(speed) ? speed : 0);
    if (Math.abs(this.max - max) < .5 && this.speed === speed) return;
    const heldAtBottom = this.phase === 'hold' && this.direction < 0 && Math.abs(this.position - this.max) < .5;
    this.max = max; this.speed = speed; this.position = Math.max(0, Math.min(max, this.position));
    if (!max || !speed) { this.position = 0; this.phase = 'hold'; this.at = now; return; }
    if (heldAtBottom) { this.position = max; return; }
    if (this.position < .5) { this.position = 0; this.direction = 1; this.phase = 'hold'; this.at = now; }
    else if (max - this.position < .5) { this.position = max; this.direction = -1; this.phase = 'hold'; this.at = now; }
    else this.travel(now);
  }
  travel(now) { this.phase = 'travel'; this.at = now; this.from = this.position; this.target = this.direction > 0 ? this.max : 0; this.duration = Math.max(1600, Math.abs(this.target - this.from) / this.speed * 1000); }
  tick(now) {
    if (!this.max || !this.speed) return this.position = 0;
    for (let step = 0; step < 8; step++) {
      if (this.phase === 'hold') { if (now < this.at + 5000) return this.position; this.travel(this.at + 5000); }
      const p = (now - this.at) / this.duration;
      if (p < 1) return this.position = this.from + (this.target - this.from) * elasticProgress(p);
      this.position = this.target; this.direction *= -1; this.phase = 'hold'; this.at += this.duration;
    }
    this.at = now; return this.position;
  }
}
export class BannerCycle {
  constructor() { this.headlines = []; this.index = 0; this.elapsed = 0; this.last = 0; this.notice = null; this.lastEvent = null; }
  configure(headlines, now, duration = 20, actionDuration = 10) {
    this.duration = duration * 1000; this.actionDuration = actionDuration * 1000;
    const next = Array.isArray(headlines) ? headlines : [];
    if (JSON.stringify(next) === JSON.stringify(this.headlines)) return;
    this.headlines = [...next]; this.index = 0; this.elapsed = 0; this.last = now;
  }
  show(event, now, wallNow = Date.now()) {
    this.tick(now);
    // Толькі свежы адказ сервера пацвярджае, што чарга пустая; інакш паміж
    // канцом абвесткі і наступным запытам мільгануў бы загаловак.
    if (!event) { this.notice = null; return; }
    if (event.id === this.lastEvent && this.notice) return;
    this.lastEvent = event.id;
    const duration = Math.max(0, Math.min(this.actionDuration ?? 10000, (event.expiresAt ?? wallNow + (this.actionDuration ?? 10000)) - wallNow));
    if (duration) this.notice = { text: event.text ?? '', id: event.id, start: now, until: now + duration };
  }
  select(selection, now, wallNow = Date.now()) {
    if (!selection || selection.id === this.selectionId || selection.at + (this.duration ?? 20000) <= wallNow) return;
    if (this.headlines[selection.index] !== selection.text) return;
    this.selectionId = selection.id; this.index = selection.index;
    this.elapsed = Math.max(0, wallNow - selection.at); this.last = now; this.notice = null;
  }
  tick(now) {
    const duration = this.duration ?? 20000;
    const delta = Math.max(0, now - this.last);
    const actionTime = this.notice ? Math.max(0, now - Math.max(this.last, this.notice.start)) : 0;
    this.elapsed += delta - actionTime; this.last = now;
    if (this.headlines.length && this.elapsed >= duration) { this.index = (this.index + Math.floor(this.elapsed / duration)) % this.headlines.length; this.elapsed %= duration; }
    if (this.notice) return { key: `action:${this.notice.id}`, text: this.notice.text, action: true };
    const text = this.headlines[this.index] ?? ''; return { key: `headline:${this.index}:${text}`, text, action: false };
  }
}
// Адзін тэкставы вузел: цалкам сыходзіць улева, потым зноў з'яўляецца справа.
export class HeadlineTicker {
  constructor() { this.configure(0, 0, 0, 0); }
  configure(width, textWidth, speed, now) {
    this.width = Math.max(0, width); this.textWidth = Math.max(0, textWidth);
    this.speed = textWidth > width && speed > 0 ? Math.max(speed, (width + textWidth) / 18) : 0;
    this.at = now;
  }
  tick(now) {
    if (!this.speed) return 0;
    const distance = Math.max(0, now - this.at - 1000) * this.speed / 1000;
    if (!distance) return 0;
    if (distance < this.textWidth) return -distance;
    return this.width - ((distance - this.textWidth) % (this.width + this.textWidth));
  }
}
export function actionSegments(text) {
  const parts = [];
  for (const [index, line] of String(text).split('\n').entries()) {
    if (index) parts.push({ text: '\n', emphasis: false });
    const support = line.match(/^(@\S+)( мацуе )(.+)( на \d+)$/u);
    const added = line.match(/^(@\S+)( дадае )(.+)$/u);
    const match = support ?? added;
    if (!match) { parts.push({ text: line, emphasis: false }); continue; }
    for (let i = 1; i < match.length; i++) parts.push({ text: match[i], emphasis: i === 1 || i === 3 });
  }
  return parts;
}
if (typeof document !== 'undefined') {
  const viewport = document.getElementById('viewport'), track = document.getElementById('track');
  const card = document.getElementById('statusCard'), stage = document.getElementById('messageStage');
  const slots = [...stage.children], scroll = new ScrollLoop(), banner = new BannerCycle();
  let countdown = null, winner = null, serverOffset = 0;
  let previous = '', speed = 24, fetching = false, alertId = null, audio, messageKey = '', slot = 0, generation = 0;
  let titleMotions = [], headline = null, headlineAction = false, headlineGeometry = '';
  const ticker = new HeadlineTicker();
  function rows(entries) {
    return entries.map((entry, index) => {
      const row = document.createElement('div'); row.className = 'row';
      for (const [value, cls] of [[index + 1, 'rank'], [entry.code, 'code'], [entry.title, 'title'], [entry.score, 'score']]) {
        const span = document.createElement('span'); span.className = cls;
        if (cls === 'title') {
          const clip = document.createElement('span'), text = document.createElement('span');
          clip.className = 'title-clip'; text.className = 'title-text'; text.textContent = value; clip.append(text); span.append(clip);
          titleMotions.push({clip,text,motion:new ScrollLoop()});
        } else span.textContent = value;
        if (cls === 'title' && entry.availability === 'absent') { const note = document.createElement('small'); note.textContent = 'Няма ў стрымера'; span.append(note); }
        if (cls === 'title' && entry.availability === 'error') { const warning = document.createElement('small'); warning.textContent = '⚠'; span.append(warning); }
        row.append(span);
      }
      return row;
    });
  }
  function measure() {
    const now = performance.now();
    scroll.configure(Math.max(0, track.getBoundingClientRect().height - viewport.getBoundingClientRect().height), speed, now);
    for (const item of titleMotions) item.motion.configure(Math.max(0,item.text.scrollWidth-item.clip.clientWidth),speed,now);
    if (headline) {
      const geometry = `${headlineAction}:${stage.clientWidth}:${headline.scrollWidth}:${speed}`;
      if (geometry !== headlineGeometry) { headlineGeometry = geometry; ticker.configure(stage.clientWidth,headlineAction ? 0 : headline.scrollWidth,speed,now); }
      stage.style.height = Math.max(headline.parentElement.scrollHeight,1) + 'px';
    }
  }
  function message(value) {
    if (value.key === messageKey) return;
    messageKey = value.key; card.hidden = !value.text; const sequence = ++generation;
    const old = slots[slot]; old.classList.remove('active'); old.classList.add('leaving'); old.setAttribute('aria-hidden','true');
    slot = 1 - slot; const next = slots[slot];
    headline = document.createElement('span'); headline.className = value.countdown ? 'message-text countdown-text' : 'message-text';
    if (value.countdown) {
      const label = document.createElement('span'), time = document.createElement('span');
      label.textContent = 'Да канца галасавання'; time.className = 'countdown-time'; time.textContent = value.time; headline.append(label,time);
    } else if (value.action) {
      for (const part of actionSegments(value.text)) {
        const span = document.createElement('span'); span.textContent = part.text;
        if (part.emphasis) span.className = 'message-emphasis'; headline.append(span);
      }
    } else headline.textContent = value.text;
    next.replaceChildren(headline);
    headlineAction = value.action || value.countdown; headlineGeometry = '';
    next.className = `message-slot${value.action ? ' action' : ''}`; next.setAttribute('aria-hidden','false');
    measure();
    requestAnimationFrame(() => { if (sequence === generation) next.classList.add('active'); });
  }
  async function tone(display, kind) {
    if (!display.sound || display.volume <= 0 || kind === 'error') return;
    try {
      audio ??= new AudioContext(); await audio.resume(); if (audio.state !== 'running') return;
      scheduleCue(audio, kind, display.volume);
    } catch { /* Гук у браўзеры неабавязковы: галасаванне працуе і без яго. */ }
  }
  async function update() {
    if (fetching) return; fetching = true;
    try {
      const response = await fetch('/overlay/state'); if (!response.ok) return;
      const state = await response.json(), display = state.display, now = performance.now(); speed = display.speed;
      document.documentElement.style.setProperty('--header-opacity', display.headerOpacity ?? .85);
      document.documentElement.style.setProperty('--list-opacity', display.listOpacity ?? .75);
      countdown = state.vote.status !== 'closed' ? state.vote.deadline : null;
      winner = state.vote.winner ? { key: `winner:${state.vote.roundId}`, text: state.vote.winner, action: false } : null;
      serverOffset = state.vote.serverNow - Date.now();
      document.body.style.fontFamily = display.font; document.body.style.fontSize = display.size + 'px'; document.body.style.color = display.color;
      document.getElementById('overlay').style.width = Math.min(display.width, Math.max(0, innerWidth - 64)) + 'px'; viewport.style.maxHeight = display.height + 'vh';
      banner.configure(display.headlines, now, display.headlineDuration, display.duration);
      banner.select(state.headlineSelection, now);
      const signature = JSON.stringify(state.vote.entries);
      if (signature !== previous) {
        previous = signature; titleMotions = []; track.replaceChildren(...rows(state.vote.entries));
        if (!state.vote.entries.length) { const empty = document.createElement('div'); empty.id = 'empty'; empty.textContent = 'Пакуль няма пазіцый'; track.append(empty); }
      }
      banner.show(state.notification, now); renderMessage(now); measure();
      if (state.notification && state.notification.id !== alertId) { alertId = state.notification.id; void tone(display, state.notification.kind); }
    } catch { /* Пры часовым збоі сувязі застаецца апошні паказаны стан. */ }
    finally { fetching = false; }
  }
  function renderMessage(now) {
    if (!countdown) {
      // Абвестка (у тым ліку пра пераможцу) ідзе як звычайна, а замест загалоўкаў — пераможца, пакуль раўнд закрыты.
      const value = banner.tick(now);
      return message(winner && !value.action ? winner : value);
    }
    const seconds = Math.max(0, Math.ceil((countdown.due - (Date.now() + serverOffset)) / 1000));
    const time = `${String(Math.floor(seconds / 60)).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}`;
    // Вузел таймера стабільны: звычайная змена загалоўкаў яго не хавае.
    const key = `countdown:${countdown.roundId}`;
    message({ key, text: 'Да канца галасавання', countdown: true, time });
    const clock = headline?.querySelector('.countdown-time'); if (clock) clock.textContent = time;
  }
  function animate(now) {
    track.style.transform = `translate3d(0,${-scroll.tick(now)}px,0)`; renderMessage(now);
    for (const item of titleMotions) item.text.style.transform = `translate3d(${-item.motion.tick(now)}px,0,0)`;
    if (headline) headline.style.transform = `translate3d(${ticker.tick(now)}px,0,0)`;
    requestAnimationFrame(animate);
  }
  if (typeof ResizeObserver !== 'undefined') { const resize = new ResizeObserver(measure); resize.observe(viewport); resize.observe(track); }
  addEventListener('resize', measure); document.fonts?.ready.then(measure);
  update(); setInterval(update, 500); requestAnimationFrame(animate);
}
