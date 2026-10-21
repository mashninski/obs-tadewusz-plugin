// Злучэнне з obs-websocket 5. Падключаецца само і перападключаецца, пакуль праграма працуе.
import { createHash, randomUUID } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('base64');

export class Obs {
  constructor({ url, password, WebSocketImpl = globalThis.WebSocket, log = () => {}, now = Date.now }) {
    Object.assign(this, { url, password, WebSocketImpl, log, now });
    this.pending = new Map();
    this.state = { connected: false, streaming: false, error: null };
    this.attempt = 0;
    this.nextAttempt = 0;
    this.running = false;
  }

  start() { this.running = true; }

  stop() {
    this.running = false;
    this.disconnect();
  }

  disconnect() {
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.fail();
  }

  fail(error = null) {
    this.state = { connected: false, streaming: false, error };
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('obs_disconnected')); }
    this.pending.clear();
  }

  /** Паўторная спроба злучэння з паўзамі 1…30 с. Выклікаецца з цыкла праграмы. */
  async tick() {
    if (!this.running || this.socket || this.now() < this.nextAttempt) return;
    try {
      await this.connect();
      this.attempt = 0;
    } catch (error) {
      this.nextAttempt = this.now() + Math.min(30_000, 1000 * 2 ** Math.min(this.attempt++, 5));
      if (this.attempt === 1) this.log('warn', 'obs.waiting', error.message);
    }
  }

  async connect() {
    this.disconnect();
    const password = await this.password();
    const socket = new this.WebSocketImpl(this.url());
    this.socket = socket;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { finish(new Error('obs_timeout')); socket.close(); }, 7000);
      let settled = false;
      const finish = error => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(); };
      socket.addEventListener('message', message => {
        if (this.socket !== socket) return;
        let op, d;
        try { ({ op, d } = JSON.parse(message.data)); } catch { finish(new Error('obs_protocol')); socket.close(); return; }
        if (op === 0) {
          const identify = { rpcVersion: 1, eventSubscriptions: 64 }; // Outputs: стан эфіру
          if (d.authentication) identify.authentication = hash(hash(password + d.authentication.salt) + d.authentication.challenge);
          socket.send(JSON.stringify({ op: 1, d: identify }));
        } else if (op === 2) {
          this.state = { connected: true, streaming: false, error: null };
          this.log('info', 'obs.connected');
          finish();
          this.request('GetStreamStatus').then(s => { this.state.streaming = s.outputActive === true; }).catch(() => {});
        } else if (op === 5 && d.eventType === 'StreamStateChanged') {
          this.state.streaming = d.eventData.outputActive === true;
        } else if (op === 7) {
          const pending = this.pending.get(d.requestId);
          if (!pending) return;
          clearTimeout(pending.timer);
          this.pending.delete(d.requestId);
          if (d.requestStatus.result) pending.resolve(d.responseData ?? {});
          else pending.reject(new Error(`obs_request_${d.requestStatus.code}`));
        }
      });
      socket.addEventListener('close', event => {
        if (this.socket === socket) { this.socket = null; this.fail(event.code === 4009 ? 'obs_password' : 'obs_closed'); }
        finish(new Error(event.code === 4009 ? 'obs_password' : 'obs_closed'));
      });
      socket.addEventListener('error', () => finish(new Error('obs_unavailable')));
    });
  }

  request(requestType, requestData = {}) {
    if (!this.state.connected || !this.socket) return Promise.reject(new Error('obs_disconnected'));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error('obs_request_timeout')); }, 4000);
      this.pending.set(requestId, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } })); }
      catch { clearTimeout(timer); this.pending.delete(requestId); reject(new Error('obs_disconnected')); }
    });
  }

  /** Перазагрузіць старонку крыніцы-браўзера (калі яна засталася на старонцы памылкі). */
  refreshBrowser(inputName) {
    return this.request('PressInputPropertiesButton', { inputName, propertyName: 'refreshnocache' });
  }
}
