// Галасы для агучвання паведамленняў гледачоў: 25 «персанажаў».
// Кожны — гэта апісанне голасу для OmniVoice (instruct: пол, узрост, вышыня, шэпт; speed — хуткасць маўлення)
// і ланцужок гукавых эфектаў, які старонка радка накладае ў браўзеры (Web Audio).
// OmniVoice не ўмее «эмоцый» — разнастайнасць даюць спалучэнні атрыбутаў, хуткасці і эфектаў.
// Допустымыя атрыбуты instruct — гл. docs/voice-design.md у OmniVoice; акцэнты (accent) дзейнічаюць толькі на англійскай, таму не выкарыстоўваюцца.
//
// fx: rate — хуткасць прайгравання (мяняе і вышыню: >1 — «бурундук», <1 — «велікан»);
//     filter [тып, частата, Q]; drive 0…1 — перагрузка; ring [частата, доля] — «робат»;
//     tremolo [частата, глыбіня]; echo [секунды, зваротная сувязь, доля]; reverb [секунды, доля];
//     double [цэнты, мс] — другі голас побач («хор»); noise — узровень шуму і трэску.

export const VOICE_PERSONAS = [
  { id: 'news', name: 'Дыктар вячэрніх навін', instruct: 'male, middle-aged, low pitch', speed: 0.95, fx: { reverb: [0.6, 0.08] } },
  { id: 'granny', name: 'Бабуля з лаўкі', instruct: 'female, elderly, high pitch', speed: 0.9, fx: {} },
  { id: 'grandpa', name: 'Дзед-казачнік', instruct: 'male, elderly, low pitch', speed: 0.82, fx: { reverb: [1.2, 0.12] } },
  { id: 'cellar', name: 'Шэпт з падвала', instruct: 'male, low pitch, whisper', speed: 0.9, fx: { filter: ['lowpass', 3000, 0.7], reverb: [2.5, 0.35] } },
  { id: 'ghost', name: 'Прывід старога замка', instruct: 'female, high pitch, whisper', speed: 0.85, fx: { rate: 0.94, echo: [0.28, 0.45, 0.35], reverb: [3.5, 0.4] } },
  { id: 'robot', name: 'Робат Тадэвуш', instruct: 'male, moderate pitch', speed: 1, fx: { filter: ['highpass', 200, 0.7], ring: [55, 0.85] } },
  { id: 'booth', name: 'Званок з тэлефоннай будкі', instruct: 'female, young adult', speed: 1.05, fx: { filter: ['bandpass', 1200, 0.9], drive: 0.25 } },
  { id: 'radio-truck', name: 'Рацыя кіроўцы фуры', instruct: 'male, middle-aged, low pitch', speed: 1.1, fx: { filter: ['bandpass', 1600, 1.4], drive: 0.6, noise: 0.02 } },
  { id: 'chipmunk', name: 'Бурундук пасля кавы', instruct: 'child', speed: 1.2, fx: { rate: 1.38 } },
  { id: 'giant', name: 'Велікан з-пад гары', instruct: 'male, very low pitch', speed: 0.9, fx: { rate: 0.8, reverb: [1.8, 0.25] } },
  { id: 'smartkid', name: 'Маленькі ўсёзнайка', instruct: 'child, high pitch', speed: 1.1, fx: {} },
  { id: 'teen', name: 'Падлетак, якому няёмка', instruct: 'male, teenager', speed: 1.2, fx: { filter: ['lowpass', 5000, 0.7] } },
  { id: 'orator', name: 'Аратар на плошчы', instruct: 'male, middle-aged, low pitch', speed: 0.92, fx: { echo: [0.42, 0.3, 0.3], reverb: [2.2, 0.3] } },
  { id: 'captain', name: 'Камандзір зоркалёта', instruct: 'male, middle-aged, low pitch', speed: 1, fx: { filter: ['bandpass', 1800, 0.7], double: [12, 18], noise: 0.01 } },
  { id: 'alien', name: 'Госць з іншай планеты', instruct: 'female, very high pitch', speed: 1, fx: { ring: [420, 0.5], tremolo: [9, 0.4] } },
  { id: 'underwater', name: 'Голас з-пад вады', instruct: 'male, moderate pitch', speed: 0.95, fx: { filter: ['lowpass', 450, 4], tremolo: [5, 0.5] } },
  { id: 'radio-1930', name: 'Радыё трыццатых гадоў', instruct: 'male, middle-aged', speed: 1.05, fx: { filter: ['bandpass', 1500, 1.1], drive: 0.4, noise: 0.035 } },
  { id: 'stadium', name: 'Дыктар на стадыёне', instruct: 'male, young adult, low pitch', speed: 1, fx: { echo: [0.38, 0.4, 0.4], reverb: [2.8, 0.25] } },
  { id: 'troll', name: 'Пячорны троль', instruct: 'male, elderly, very low pitch', speed: 0.8, fx: { rate: 0.86, drive: 0.2, reverb: [3, 0.4] } },
  { id: 'mouse', name: 'Мыш з мультфільма', instruct: 'female, child, very high pitch', speed: 1.15, fx: { rate: 1.25 } },
  { id: 'sleepy', name: 'Той, хто не выспаўся', instruct: 'male, young adult, low pitch', speed: 0.72, fx: { rate: 0.95 } },
  { id: 'rapid', name: 'Скорагаворка', instruct: 'female, young adult, high pitch', speed: 1.5, fx: {} },
  { id: 'machine', name: 'Аўтаадказчык', instruct: 'female, middle-aged, moderate pitch', speed: 0.95, fx: { filter: ['bandpass', 1400, 0.8], reverb: [0.4, 0.1] } },
  { id: 'demon', name: 'Дэман з-за куліс', instruct: 'male, very low pitch', speed: 0.85, fx: { rate: 0.88, double: [-70, 25], drive: 0.35, reverb: [2.5, 0.3] } },
  { id: 'twins', name: 'Хор блізнят', instruct: 'female, young adult', speed: 1, fx: { double: [18, 30], reverb: [1.5, 0.25] } },
];

export const personaById = id => VOICE_PERSONAS.find(p => p.id === id) ?? null;

/** Колькі часу гучыць эфект пасля голасу (рэха і рэверберацыя), мс. */
export function voiceTailMs(persona) {
  const fx = persona?.fx ?? {};
  let tail = 0;
  if (fx.reverb) tail = Math.max(tail, fx.reverb[0]);
  // Рэха знікае да −60 дБ.
  if (fx.echo) tail = Math.max(tail, fx.echo[0] * Math.ceil(Math.log(0.001) / Math.log(Math.max(0.05, fx.echo[1]))));
  return Math.round(Math.min(tail, 6) * 1000);
}

/** Поўная працягласць гучання: сам голас з улікам хуткасці прайгравання і «хвост» эфектаў, мс. */
export function voiceDurationMs(audioMs, persona) {
  const rate = persona?.fx?.rate ?? 1;
  const doubled = persona?.fx?.double ? persona.fx.double[1] : 0;
  return Math.ceil(audioMs / rate + doubled + voiceTailMs(persona));
}

// Паўтаральны «выпадковы» шум: аднолькавы гук пры кожным прайграванні.
function noiseSource(seed) {
  let x = seed >>> 0 || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) / 4294967296) * 2 - 1; };
}

function impulse(ctx, seconds) {
  const length = Math.max(1, Math.round(ctx.sampleRate * seconds)), buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel), random = noiseSource(7 + channel);
    for (let i = 0; i < length; i++) data[i] = random() * (1 - i / length) ** 3;
  }
  return buffer;
}

function shaper(ctx, amount) {
  const curve = new Float32Array(1024), k = amount * 60;
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  const node = ctx.createWaveShaper();
  node.curve = curve;
  node.oversample = '4x';
  return node;
}

function crackle(ctx, seconds, level) {
  const length = Math.max(1, Math.round(ctx.sampleRate * seconds)), buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0), random = noiseSource(42);
  for (let i = 0; i < length; i++) {
    const hiss = random() * level * 0.5;
    data[i] = random() > 0.9993 ? hiss + random() * level * 6 : hiss;
  }
  return buffer;
}

/**
 * Прайграць голас з эфектамі персанажа. Вяртае працягласць (мс) і `stop()`.
 * @param {BaseAudioContext} ctx
 * @param {AudioBuffer} buffer
 * @param {{fx?: Record<string, any>}} persona
 * @param {{volume?: number, destination?: AudioNode, when?: number}} [options]
 */
export function playVoice(ctx, buffer, persona, { volume = 1, destination = ctx.destination, when = ctx.currentTime } = {}) {
  const fx = persona?.fx ?? {}, nodes = [], sources = [];
  const node = n => { nodes.push(n); return n; };
  const rate = fx.rate ?? 1, seconds = buffer.duration / rate;
  const master = node(ctx.createGain());
  master.gain.value = Math.max(0, Math.min(1, volume));
  master.connect(destination);

  // Ланцужок: крыніца(ы) → фільтр → перагрузка → кольцавая мадуляцыя → трэмала → (сухі + рэха + рэверберацыя) → гучнасць.
  const input = node(ctx.createGain());
  let tail = input;
  const chain = next => { tail.connect(next); tail = next; };
  if (fx.filter) {
    const filter = node(ctx.createBiquadFilter());
    [filter.type, filter.frequency.value, filter.Q.value] = fx.filter;
    chain(filter);
  }
  if (fx.drive) {
    chain(node(shaper(ctx, fx.drive)));
    const trim = node(ctx.createGain());
    trim.gain.value = 1 / (1 + fx.drive);
    chain(trim);
  }
  if (fx.ring) {
    const [frequency, mix] = fx.ring, out = node(ctx.createGain()), dry = node(ctx.createGain()), wet = node(ctx.createGain());
    const carrier = node(ctx.createOscillator());
    dry.gain.value = 1 - mix;
    wet.gain.value = 0;
    carrier.frequency.value = frequency;
    const depth = node(ctx.createGain());
    depth.gain.value = mix;
    carrier.connect(depth).connect(wet.gain);
    tail.connect(dry).connect(out);
    tail.connect(wet).connect(out);
    sources.push(carrier);
    tail = out;
  }
  if (fx.tremolo) {
    const [frequency, amount] = fx.tremolo, gain = node(ctx.createGain()), lfo = node(ctx.createOscillator()), depth = node(ctx.createGain());
    gain.gain.value = 1 - amount / 2;
    lfo.frequency.value = frequency;
    depth.gain.value = amount / 2;
    lfo.connect(depth).connect(gain.gain);
    sources.push(lfo);
    chain(gain);
  }
  tail.connect(master);
  if (fx.echo) {
    const [time, feedback, mix] = fx.echo, delay = node(ctx.createDelay(2)), loop = node(ctx.createGain()), send = node(ctx.createGain());
    delay.delayTime.value = time;
    loop.gain.value = feedback;
    send.gain.value = mix;
    tail.connect(send).connect(delay).connect(master);
    delay.connect(loop).connect(delay);
  }
  if (fx.reverb) {
    const [length, mix] = fx.reverb, convolver = node(ctx.createConvolver()), send = node(ctx.createGain());
    convolver.buffer = impulse(ctx, length);
    send.gain.value = mix;
    tail.connect(send).connect(convolver).connect(master);
  }

  const voice = gainValue => {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const level = node(ctx.createGain());
    level.gain.value = gainValue;
    source.connect(level).connect(input);
    sources.push(source);
    return source;
  };
  voice(fx.double ? 0.7 : 1).start(when);
  if (fx.double) {
    const [cents, ms] = fx.double, second = voice(0.55);
    second.playbackRate.value = rate * 2 ** (cents / 1200);
    second.start(when + ms / 1000);
  }
  if (fx.noise) {
    const hiss = ctx.createBufferSource(), level = node(ctx.createGain());
    hiss.buffer = crackle(ctx, seconds + 0.3, fx.noise);
    level.gain.value = 1;
    hiss.connect(level).connect(master);
    sources.push(hiss);
    hiss.start(when);
  }
  for (const source of sources) if (source instanceof OscillatorNode) source.start(when);

  const duration = voiceDurationMs(buffer.duration * 1000, persona);
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const source of sources) { try { source.stop(); } catch { /* ужо спынены */ } }
    for (const n of nodes) { try { n.disconnect(); } catch { /* ужо адлучаны */ } }
  };
  const end = when + duration / 1000 + 0.1;
  for (const source of sources) { try { source.stop(end); } catch { /* ігнараваць */ } }
  return { duration, stop };
}
