// Security middleware: response headers, same-origin / anti-CSRF guard, login rate limiting,
// cookie parsing and safe error responses. No extra dependencies.
const crypto = require('crypto');

const PROD = /^prod/i.test(process.env.APP_ENV || '');
const CLIENT_HEADER = 'x-staffware-client'; // every request from the web app carries this header

// Extra allowed browser origins (comma separated), e.g. "https://staffware.rew.com". Same-origin is always allowed.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

function checkSecret() {
  const s = process.env.JWT_SECRET || '';
  if (s.length < 32 || /change|secret|example|default/i.test(s)) {
    const msg = 'JWT_SECRET in server/.env must be a random value of at least 32 characters.';
    if (PROD) throw new Error(msg);
    console.warn(`WARNING: ${msg} (allowed in ${process.env.APP_ENV || 'DEMO'} mode only)`);
  }
}

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
    "font-src 'self' data:", "connect-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
  ].join('; '));
  if (PROD) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
  }
  next();
}

function parseCookies(req, res, next) {
  req.cookies = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try { req.cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* bad cookie */ }
    }
  }
  next();
}

// API calls must come from the web app itself: same origin + the app's custom header.
// Browsers cannot add a custom header cross-site without CORS (which is not enabled), so this blocks
// CSRF and stops other web sites from using a logged-in user's session. Pasting an /api URL into
// the address bar is refused too.
function apiGuard(req, res, next) {
  if (req.path === '/health') return next();
  const origin = req.headers.origin;
  if (origin) {
    const self = `${req.protocol}://${req.headers.host}`;
    let ok = origin === self || ALLOWED_ORIGINS.includes(origin);
    if (!ok && !PROD) { try { ok = ['localhost', '127.0.0.1'].includes(new URL(origin).hostname); } catch { /* bad origin */ } }
    if (!ok) return res.status(403).json({ error: 'Request refused' });
  }
  if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Request refused' });
  if (req.headers[CLIENT_HEADER] !== '1') return res.status(403).json({ error: 'Request refused' });
  next();
}

// Login throttling: max 10 failures per username and 30 per IP in 15 minutes.
const WINDOW = 15 * 60 * 1000;
const fails = new Map();
const key = (k) => { const now = Date.now(); let e = fails.get(k); if (!e || now - e.start > WINDOW) { e = { start: now, n: 0 }; fails.set(k, e) } return e };
const loginLimiter = {
  blocked(ip, user) {
    return key(`ip:${ip}`).n >= 30 || key(`u:${String(user).toLowerCase()}`).n >= 10;
  },
  fail(ip, user) { key(`ip:${ip}`).n++; key(`u:${String(user).toLowerCase()}`).n++; },
  success(user) { fails.delete(`u:${String(user).toLowerCase()}`); },
};
setInterval(() => { const now = Date.now(); for (const [k, e] of fails) if (now - e.start > WINDOW) fails.delete(k) }, WINDOW).unref();

// Never send SQL / driver / stack details to the browser. 4xx messages written by our own code are kept.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = err.status || err.statusCode || 500;
  if (err.type === 'entity.parse.failed') status = 400;
  if (status >= 500) {
    const ref = crypto.randomBytes(4).toString('hex');
    console.error(`[${ref}] ${req.method} ${req.originalUrl}`, err);
    return res.status(status).json({ error: `Something went wrong on the server (ref ${ref}).` });
  }
  res.status(status).json({ error: err.expose === false ? 'Request refused' : err.message || 'Request refused', ...(err.needsConfirm ? { needsConfirm: true } : {}) });
}

module.exports = { PROD, CLIENT_HEADER, checkSecret, securityHeaders, parseCookies, apiGuard, loginLimiter, errorHandler };
