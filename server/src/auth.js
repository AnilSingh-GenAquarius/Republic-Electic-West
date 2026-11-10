const express = require('express');
const jwt = require('jsonwebtoken');
const { query } = require('./db');
const { PROD, loginLimiter } = require('./security');

// LoginUsers column -> module code used by the web app
const MODULE_COLUMNS = {
  AM: 'AlarmMonitoringAM',
  AR: 'BillingAR',
  CM: 'ContractsCM',
  CS: 'CustomerServiceCS',
  CX: 'CoxCableCX',
  DM: 'MaintenanceDM',
  ES: 'EstimatingES',
  FM: 'ForemanFM',
  IC: 'InventoryIC',
  JS: 'JobSetupJS',
  MG: 'ManagementMG',
  PM: 'PlanManagementPM',
  PO: 'PurchasingPO',
  PR: 'PayrollPR',
  SA: 'SalesSA',
  SC: 'SchedulingSC',
  SP: 'SchedulingPanelSP',
  TM: 'TimeMaterialTM',
};

const crypto = require('crypto');
const COOKIE = 'sw_session';
// Tokens ended by Log out are refused until they would have expired anyway.
const revoked = new Map(); // jti -> exp (seconds)
setInterval(() => { const now = Date.now() / 1000; for (const [k, exp] of revoked) if (exp < now) revoked.delete(k) }, 600000).unref();
const SESSION_HOURS = 10;
const router = express.Router();

const modulesOf = (user) => {
  const modules = Object.entries(MODULE_COLUMNS).filter(([, col]) => user[col]).map(([code]) => code);
  modules.push('PU'); // "Public" switchboard module has no flag — every user can open it
  return modules;
};

// The session token lives in an HttpOnly cookie: page scripts (and DevTools console / storage tabs)
// cannot read it, and the browser only sends it to this same site.
function setSessionCookie(res, token, remember) {
  const parts = [`${COOKIE}=${token}`, 'Path=/api', 'HttpOnly', 'SameSite=Strict'];
  if (PROD || process.env.COOKIE_SECURE === '1') parts.push('Secure');
  if (remember) parts.push(`Max-Age=${SESSION_HOURS * 3600}`);
  res.setHeader('Set-Cookie', parts.join('; '));
}
const clearSessionCookie = (res) =>
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${PROD || process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}`);

router.post('/login', async (req, res, next) => {
  try {
    const { username, password, remember } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password || username.length > 100 || password.length > 200) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    if (loginLimiter.blocked(req.ip, username)) {
      return res.status(429).json({ error: 'Too many failed attempts. Wait 15 minutes and try again.' });
    }

    // NOTE: LoginUsers stores plain-text passwords (legacy Access design, shared with the Access front end).
    const rows = await query('SELECT * FROM LoginUsers WHERE Username = @u AND Password = @p', { u: username, p: password });
    const user = rows[0];
    if (!user || !user.Active) {
      loginLimiter.fail(req.ip, username);
      return res.status(401).json({ error: 'Invalid username or password, or the login is inactive' });
    }
    loginLimiter.success(username);

    const modules = modulesOf(user);
    const token = jwt.sign({ username: user.Username, modules }, process.env.JWT_SECRET, { expiresIn: `${SESSION_HOURS}h`, algorithm: 'HS256', jwtid: crypto.randomBytes(12).toString('hex') });
    setSessionCookie(res, token, remember !== false);
    res.json({ user: { username: user.Username, modules } });
  } catch (e) {
    next(e);
  }
});

router.post('/logout', (req, res) => {
  try {
    const c = jwt.verify(req.cookies?.[COOKIE] || '', process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (c.jti) revoked.set(c.jti, c.exp);
  } catch { /* already invalid */ }
  clearSessionCookie(res);
  res.json({ ok: true });
});

// Re-check the login every 30 s so a deactivated user or removed module takes effect without waiting for the token to expire.
const live = new Map();
async function currentUser(username) {
  const hit = live.get(username);
  if (hit && Date.now() - hit.at < 30000) return hit.user;
  const rows = await query('SELECT * FROM LoginUsers WHERE Username = @u', { u: username });
  const u = rows[0] && rows[0].Active ? { username: rows[0].Username, modules: modulesOf(rows[0]) } : null;
  live.set(username, { at: Date.now(), user: u });
  return u;
}

async function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE];
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  let claims;
  try {
    claims = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (!claims.jti || revoked.has(claims.jti)) throw new Error('revoked');
  } catch {
    clearSessionCookie(res);
    return res.status(401).json({ error: 'Session expired, please log in again' });
  }
  try {
    const user = await currentUser(claims.username);
    if (!user) { clearSessionCookie(res); return res.status(401).json({ error: 'This login is no longer active' }); }
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
}

function requireModule(code) {
  return (req, res, next) =>
    req.user?.modules?.includes(code)
      ? next()
      : res.status(403).json({ error: `You do not have access to module ${code}` });
}

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

module.exports = { router, requireAuth, requireModule };
