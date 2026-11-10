require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const path = require('path');
const { router: authRouter, requireAuth, requireModule } = require('./auth');
const { checkSecret, securityHeaders, parseCookies, apiGuard, errorHandler } = require('./security');

checkSecret();

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY); // set when running behind IIS / a reverse proxy
app.use(securityHeaders);
app.use(parseCookies);
app.use('/api', apiGuard);
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, env: process.env.APP_ENV || 'DEMO' }));

app.use('/api/auth', authRouter);

// Shared (any logged-in user)
app.use('/api/common', requireAuth, require('./modules/common'));
app.use('/api/dashboard', requireAuth, require('./modules/dashboard'));

// Modules — each one is added here as it is built.
app.use('/api/js', requireAuth, requireModule('JS'), require('./modules/jobSetup'));
app.use('/api/am', requireAuth, requireModule('AM'), require('./modules/alarmMonitoring'));
app.use('/api/pr', requireAuth, requireModule('PR'), require('./modules/payroll'));
app.use('/api/sc', requireAuth, requireModule('SC'), require('./modules/scheduling'));
app.use('/api/tm', requireAuth, requireModule('TM'), require('./modules/timeMaterial'));
app.use('/api/ic', requireAuth, requireModule('IC'), require('./modules/inventory'));
app.use('/api/po', requireAuth, requireModule('PO'), require('./modules/purchasing'));
app.use('/api/ar', requireAuth, requireModule('AR'), require('./modules/receivables'));
app.use('/api/fm', requireAuth, requireModule('FM'), require('./modules/foreman'));
app.use('/api/mg', requireAuth, requireModule('MG'), require('./modules/management'));
app.use('/api/pm', requireAuth, requireModule('PM'), require('./modules/planManagement'));
app.use('/api/cs', requireAuth, requireModule('CS'), require('./modules/customerService'));
app.use('/api/sa', requireAuth, requireModule('SA'), require('./modules/sales'));
app.use('/api/es', requireAuth, requireModule('ES'), require('./modules/estimating'));
app.use('/api/cm', requireAuth, requireModule('CM'), require('./modules/contracts'));
app.use('/api/cx', requireAuth, requireModule('CX'), require('./modules/coxCable'));
app.use('/api/pu', requireAuth, requireModule('PU'), require('./modules/public'));
app.use('/api/dm', requireAuth, requireModule('DM'), require('./modules/maintenance'));

// Serve the built React app in production.
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
app.use(express.static(clientDist, { index: false, dotfiles: 'deny' }));
app.get(/^\/(?!api\/).*/, (req, res, next) =>
  res.sendFile(path.join(clientDist, 'index.html'), (err) => err && next())
);

// Unknown API routes get JSON 404 (never the SPA page); errors never leak SQL / stack details.
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Staffware API listening on http://localhost:${port}`));
