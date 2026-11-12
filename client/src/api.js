// Demo build (GitHub Pages): no server, so GET calls are answered from a recorded snapshot (public/demo-data.json)
// of the sample database and every change is refused. Normal builds never set VITE_DEMO.
export const DEMO = import.meta.env.VITE_DEMO === '1';
const BASE = import.meta.env.BASE_URL;
let demoData = null;
const demoKey = (path, params) => {
  const qs = new URLSearchParams(Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)]));
  const [p, q = ''] = path.split('?');
  for (const [k, v] of new URLSearchParams(q)) qs.set(k, v);
  qs.sort();
  const s = qs.toString();
  return s ? `${p}?${s}` : p;
};
async function demoGet(path, params) {
  if (!demoData) demoData = await (await fetch(`${BASE}demo-data.json`)).json();
  const key = demoKey(path, params);
  if (key in demoData) return demoData[key];
  const bare = key.split('?')[0];
  if (bare in demoData) return demoData[bare];
  const alt = Object.keys(demoData).find((k) => k.split('?')[0] === bare);
  if (alt) return demoData[alt];
  throw Object.assign(new Error('This screen has no sample data in the online demo.'), { status: 404 });
}

const USER_KEY = 'sw_user';
const REMEMBER_USER_KEY = 'sw_remember_username';

// The login token is an HttpOnly cookie set by the server — page scripts never see it, so nothing secret is
// kept in localStorage / sessionStorage. Only the display name and module list (used to draw menus) are
// stored; the server re-checks access on every request.
const stores = () => {
  const out = [];
  try { out.push(localStorage); } catch { /* blocked */ }
  try { out.push(sessionStorage); } catch { /* blocked */ }
  return out;
};
const readKey = (k) => {
  for (const s of stores()) { const v = s.getItem(k); if (v != null) return v; }
  return null;
};

export const session = {
  get loggedIn() { return !!session.user; },
  get user() {
    try { return JSON.parse(readKey(USER_KEY)); } catch { return null; }
  },
  save(user, remember = true) {
    session.clear();
    const [local, sess] = stores();
    (remember ? local : sess || local)?.setItem(USER_KEY, JSON.stringify(user));
  },
  clear() {
    for (const s of stores()) { s.removeItem(USER_KEY); s.removeItem('sw_token'); }
  },
  async logout() {
    if (DEMO) { session.clear(); return; }
    try { await fetch('/api/auth/logout', { method: 'POST', headers: CLIENT_HEADERS, credentials: 'same-origin' }); } catch { /* offline */ }
    session.clear();
  },
  get rememberedUsername() {
    try { return localStorage.getItem(REMEMBER_USER_KEY) || ''; } catch { return ''; }
  },
  set rememberedUsername(v) {
    try { v ? localStorage.setItem(REMEMBER_USER_KEY, v) : localStorage.removeItem(REMEMBER_USER_KEY); } catch { /* ignore */ }
  },
};

// The API refuses any request without this header (blocks other sites and pasted /api URLs).
export const CLIENT_HEADERS = { 'X-Staffware-Client': '1' };

// Raw fetch for file downloads — same session cookie and header as api().
export async function apiBlob(path) {
  if (DEMO) throw new Error('Exports are not available in the online demo.');
  const res = await fetch(`/api${path}`, { headers: CLIENT_HEADERS, credentials: 'same-origin' });
  if (res.status === 401) { session.clear(); window.location.href = `${BASE}login`; }
  if (!res.ok) throw new Error('Export failed');
  return res.blob();
}

export async function api(path, { method = 'GET', body, params } = {}) {
  if (DEMO) {
    if (path === '/auth/login') return demoGet('/auth/login');
    if (method !== 'GET') throw Object.assign(new Error('Demo mode: changes are not saved. Run the full system to add or edit records.'), { status: 403 });
    return demoGet(path, params);
  }
  let url = `/api${path}`;
  if (params) {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    ).toString();
    if (qs) url += `?${qs}`;
  }
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...CLIENT_HEADERS,
      },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new Error('Cannot reach the server. Check your connection and that the Staffware API is running.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/auth/login') {
    session.clear();
    window.location.href = `${BASE}login`;
  }
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status, data });
  return data;
}
