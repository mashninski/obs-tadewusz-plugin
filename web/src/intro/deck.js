// Калода кліпаў інтро: перамешаны парадак без паўтораў, пакуль не паказаны ўсе; потым — новае перамешванне.
// Новыя кліпы з Twitch устаўляюцца ў выпадковае месца яшчэ не паказанай часткі, не перарываючы цыкл.
// Стан калоды можна захаваць і аднавіць (оверлей у OBS перазагружаецца — паўтораў не павінна быць і тады).

export class ClipDeck {
  constructor({ random = Math.random, saved = null } = {}) {
    this.random = random;
    this.pool = new Map();
    /** Яшчэ не паказаныя ў гэтым цыкле (першы — наступны). */
    this.order = Array.isArray(saved?.order) ? saved.order.map(String) : [];
    /** Ужо паказаныя ў гэтым цыкле. */
    this.played = new Set(Array.isArray(saved?.played) ? saved.played.map(String) : []);
    this.last = typeof saved?.last === 'string' ? saved.last : null;
  }

  get size() { return this.pool.size; }

  /** Новы спіс кліпаў: зніклыя выпадаюць, новыя трапляюць у выпадковае месца яшчэ не паказанай часткі. */
  update(clips) {
    const fresh = new Map(clips.map((clip) => [String(clip.id), clip]));
    this.order = this.order.filter((id) => fresh.has(id));
    for (const id of [...this.played]) if (!fresh.has(id)) this.played.delete(id);
    const known = new Set([...this.order, ...this.played]);
    for (const id of fresh.keys()) {
      if (known.has(id)) continue;
      this.order.splice(Math.floor(this.random() * (this.order.length + 1)), 0, id);
      known.add(id);
    }
    this.pool = fresh;
  }

  /** Наступны кліп або `null`, калі кліпаў няма. */
  next() {
    if (!this.refill()) return null;
    const id = this.order.shift();
    this.played.add(id);
    this.last = id;
    return this.pool.get(id);
  }

  /** Які кліп пойдзе наступным (без змены калоды); калі цыкл скончыўся, новае перамешванне робіцца ўжо цяпер. */
  peek() {
    return this.refill() ? this.pool.get(this.order[0]) ?? null : null;
  }

  /** Калі ўсе кліпы цыкла паказаныя — новае перамешванне. `false`, калі кліпаў няма. */
  refill() {
    if (!this.pool.size) return false;
    if (this.order.length) return true;
    this.played.clear();
    this.order = shuffle([...this.pool.keys()], this.random);
    // Апошні кліп мінулага цыкла не павінен адразу ісці першым у новым.
    if (this.order.length > 1 && this.order[0] === this.last) {
      const swap = 1 + Math.floor(this.random() * (this.order.length - 1));
      [this.order[0], this.order[swap]] = [this.order[swap], this.order[0]];
    }
    return true;
  }

  save() {
    return { order: [...this.order], played: [...this.played], last: this.last };
  }
}

/** Фішэр — Ейтс. */
export function shuffle(list, random = Math.random) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
