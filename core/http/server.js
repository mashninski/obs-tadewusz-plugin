// HTTP-сервер толькі на 127.0.0.1: док, оверлеі і API.
// Абарона: дакладны Host (ад DNS rebinding), cookie сесіі для API, Origin і асобны загаловак для POST (ад CSRF).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg',
};
const PAGES = { '/': 'dock.html', '/overlay': 'overlay.html', '/ticker': 'ticker.html', '/music': 'music.html' };
const SAFE_ERROR = /^[a-z0-9_:-]{1,80}$/;
const BODY_LIMIT = 256 * 1024;

export class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; }
}

/**
 * @param {{ port:number, webRoot:string, session:string, version:string, log:Function,
 *   get: Record<string, (url:URL, res:import('node:http').ServerResponse) => unknown>,
 *   post: Record<string, (body:any) => unknown> }} options
 */
export async function startServer({ port, webRoot, session, version, log, get, post }) {
  let origin = '';
  const security = {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; "
      + "script-src 'self' https://www.youtube.com https://s.ytimg.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com; "
      + "connect-src 'self' https: wss: ws://127.0.0.1:* ws://localhost:*; media-src 'self' https: blob:; worker-src 'self' blob:; frame-ancestors 'self'",
  };
  const json = (res, status, data) => {
    res.writeHead(status, { ...security, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  };
  const cookieOk = req => new RegExp(`(?:^|;\\s*)tadewusz=${session}(?:;|$)`).test(req.headers.cookie ?? '');

  async function serveFile(res, pathname) {
    const relative = PAGES[pathname] ?? decodeURIComponent(pathname.slice(1));
    const file = normalize(join(webRoot, relative));
    if (!file.startsWith(normalize(webRoot) + sep) || !TYPES[extname(file)]) return false;
    let bytes;
    try { bytes = await readFile(file); } catch { return false; }
    const headers = { ...security, 'Content-Type': `${TYPES[extname(file)]}; charset=utf-8` };
    // Кожная старонка праграмы атрымлівае cookie сесіі (і док, і оверлеі ў OBS).
    if (extname(file) === '.html') headers['Set-Cookie'] = `tadewusz=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`;
    if (pathname.startsWith('/assets/')) headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    res.writeHead(200, headers);
    res.end(bytes);
    return true;
  }

  async function readBody(req) {
    let raw = '', bytes = 0;
    req.setEncoding('utf8');
    for await (const chunk of req) {
      bytes += Buffer.byteLength(chunk);
      if (bytes > BODY_LIMIT) throw new HttpError(413, 'body_limit');
      raw += chunk;
    }
    try { return raw ? JSON.parse(raw) : {}; } catch { throw new HttpError(400, 'invalid_json'); }
  }

  const server = createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(origin).host) throw new HttpError(403, 'host');
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && url.pathname === '/bootstrap/ready') {
        // Старонка чакання (file://) пытаецца, ці гатовае ядро.
        res.writeHead(200, { ...security, 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ app: 'Tadewusz', version }));
      }
      if (req.method === 'GET' && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/overlay/') && !get[url.pathname]) {
        if (await serveFile(res, url.pathname)) return;
        throw new HttpError(404, 'not_found');
      }
      if (url.pathname !== '/steam/callback' && !cookieOk(req)) throw new HttpError(401, 'session_required');
      if (req.method === 'GET') {
        const handler = get[url.pathname];
        if (!handler) throw new HttpError(404, 'not_found');
        const result = await handler(url, res);
        if (result !== undefined && !res.headersSent) json(res, 200, result);
        return;
      }
      if (req.method !== 'POST' || req.headers.origin !== origin || req.headers['x-tadewusz'] !== '1'
        || !req.headers['content-type']?.startsWith('application/json')) throw new HttpError(403, 'origin_required');
      const handler = post[url.pathname];
      if (!handler) throw new HttpError(404, 'not_found');
      json(res, 200, (await handler(await readBody(req))) ?? { ok: true });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 400;
      const code = SAFE_ERROR.test(error.message) ? error.message : 'operation_failed';
      if (!(error instanceof HttpError)) log('warn', 'http.operation', code);
      if (!res.headersSent) json(res, status, { error: code });
      else res.end();
    }
  });
  server.requestTimeout = 0; // SSE-злучэнні музыкі доўгія
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, origin, close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(() => resolve()); }) };
}
