// Pinterest API v5: OAuth sign-in through a local loopback page, then read your boards and pins.
// You need your own Pinterest developer app (App ID + secret) with this redirect URI registered.
const { shell, net, app } = require('electron');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const store = require('./store');

const PORT = 8085;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
// Overridable only so the test suite can point at a local mock server.
const API = process.env.MOOD_PINTEREST_API || 'https://api.pinterest.com/v5';
const AUTH_URL = process.env.MOOD_PINTEREST_AUTH || 'https://www.pinterest.com/oauth/';
const SCOPES = ['boards:read', 'pins:read', 'user_accounts:read'];

function getConfig() {
  return { appId: store.get('pinterest.appId') || '', hasSecret: !!store.getSecret('pinterest.appSecret'), redirectUri: REDIRECT_URI };
}

function saveConfig({ appId, appSecret }) {
  if (appId !== undefined) store.set('pinterest.appId', String(appId).trim());
  if (appSecret) store.setSecret('pinterest.appSecret', String(appSecret).trim());
  return getConfig();
}

function basicAuth() {
  const id = store.get('pinterest.appId');
  const secret = store.getSecret('pinterest.appSecret');
  if (!id || !secret) throw new Error('Add your Pinterest App ID and secret first.');
  return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
}

async function tokenRequest(params) {
  const res = await net.fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: { Authorization: basicAuth(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || `Pinterest sign-in failed (${res.status})`);
  store.setSecret('pinterest.token', JSON.stringify({
    access: body.access_token,
    refresh: body.refresh_token || JSON.parse(store.getSecret('pinterest.token') || '{}').refresh,
    expires: Date.now() + (body.expires_in || 0) * 1000,
  }));
  return body;
}

const page = (title, msg) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font:16px system-ui;background:#f4f1ec;color:#222;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><h2 style="margin:0 0 8px">${title}</h2><p>${msg}</p></div></body>`;

let pendingServer = null;

function signIn() {
  return new Promise((resolve, reject) => {
    const appId = store.get('pinterest.appId');
    if (!appId || !store.getSecret('pinterest.appSecret')) return reject(new Error('Add your Pinterest App ID and secret first.'));
    if (pendingServer) { try { pendingServer.close(); } catch {} }
    const state = crypto.randomBytes(16).toString('hex');
    const timer = setTimeout(() => { server.close(); reject(new Error('Sign-in timed out. Try again.')); }, 5 * 60 * 1000);
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      if (url.pathname !== '/callback') { res.writeHead(404); return res.end(); }
      const done = (ok, title, msg, err) => {
        res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(page(title, msg));
        clearTimeout(timer);
        server.close();
        pendingServer = null;
        ok ? resolve(true) : reject(err);
      };
      if (url.searchParams.get('state') !== state) return done(false, 'Sign-in failed', 'State mismatch. Close this tab and try again.', new Error('State mismatch'));
      const code = url.searchParams.get('code');
      if (!code) return done(false, 'Sign-in cancelled', 'You can close this tab.', new Error(url.searchParams.get('error_description') || 'Sign-in cancelled'));
      try {
        await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI });
        done(true, 'Connected to Pinterest', 'All sorted. You can close this tab and head back to Mood Board Builder.');
      } catch (e) {
        done(false, 'Sign-in failed', e.message, e);
      }
    });
    server.on('error', e => { clearTimeout(timer); reject(e.code === 'EADDRINUSE' ? new Error(`Port ${PORT} is busy. Close whatever is using it and try again.`) : e); });
    server.listen(PORT, 'localhost', () => {
      pendingServer = server;
      const auth = new URL(AUTH_URL);
      auth.search = new URLSearchParams({ client_id: appId, redirect_uri: REDIRECT_URI, response_type: 'code', scope: SCOPES.join(','), state }).toString();
      shell.openExternal(auth.toString());
    });
  });
}

function signOut() { store.setSecret('pinterest.token', null); return true; }

async function accessToken() {
  const tok = JSON.parse(store.getSecret('pinterest.token') || 'null');
  if (!tok || !tok.access) throw new Error('NOT_SIGNED_IN');
  if (tok.expires && Date.now() > tok.expires - 60000 && tok.refresh) {
    await tokenRequest({ grant_type: 'refresh_token', refresh_token: tok.refresh });
    return JSON.parse(store.getSecret('pinterest.token')).access;
  }
  return tok.access;
}

async function api(pathname, params = {}) {
  const url = new URL(API + pathname);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  const res = await net.fetch(url.toString(), { headers: { Authorization: `Bearer ${await accessToken()}` } });
  if (res.status === 401) { signOut(); throw new Error('NOT_SIGNED_IN'); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || `Pinterest request failed (${res.status})`);
  return body;
}

async function all(pathname, params = {}, max = 1000) {
  const items = [];
  let bookmark;
  do {
    const body = await api(pathname, { ...params, page_size: 100, bookmark });
    items.push(...(body.items || []));
    bookmark = body.bookmark;
  } while (bookmark && items.length < max);
  return items;
}

async function status() {
  const config = getConfig();
  try {
    const me = await api('/user_account');
    return { ...config, signedIn: true, username: me.username };
  } catch (e) {
    return { ...config, signedIn: false, error: e.message === 'NOT_SIGNED_IN' ? null : e.message };
  }
}

async function boards() {
  const items = await all('/boards');
  return items.map(b => ({
    id: b.id,
    name: b.name,
    pinCount: b.pin_count,
    cover: b.media && b.media.image_cover_url,
  }));
}

function bestImage(media) {
  if (!media) return null;
  const imgs = media.images || (media.items && media.items[0] && media.items[0].images);
  if (imgs) {
    for (const k of ['originals', '1200x', '600x', '400x300']) if (imgs[k] && imgs[k].url) return imgs[k].url;
  }
  return media.cover_image_url || null;
}

// Download every pin image on a board to a local cache folder and return the file paths.
async function downloadBoard(boardId, onProgress) {
  const pins = await all(`/boards/${encodeURIComponent(boardId)}/pins`);
  const dir = path.join(app.getPath('userData'), 'pinterest-cache', String(boardId).replace(/[^\w-]/g, ''));
  fs.mkdirSync(dir, { recursive: true });
  const jobs = pins.map((p, i) => ({ id: p.id, url: bestImage(p.media), order: i })).filter(j => j.url);
  const files = new Array(pins.length);
  let done = 0;
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const j = jobs[next++];
      const ext = (path.extname(new URL(j.url).pathname) || '.jpg').toLowerCase();
      const dest = path.join(dir, `${String(j.order).padStart(4, '0')}-${String(j.id).replace(/[^\w-]/g, '')}${ext}`);
      try {
        if (!fs.existsSync(dest)) {
          const res = await net.fetch(j.url);
          if (!res.ok) throw new Error(String(res.status));
          fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
        }
        files[j.order] = dest;
      } catch { /* skip images that fail to download */ }
      done++;
      onProgress && onProgress({ done, total: jobs.length });
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  return files.filter(Boolean);
}

module.exports = { getConfig, saveConfig, signIn, signOut, status, boards, downloadBoard, REDIRECT_URI };
