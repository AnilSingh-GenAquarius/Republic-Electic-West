// Quick check of the AR routes added for the shared filter bar and billing snapshots. Run: node server/scripts/check_ar_filter_lookups.js
// Starts the router on a random port with a fake user and asserts the response shapes (needs the local StaffwareSample db).
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const express = require('express');
const assert = require('assert');

const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = { username: 'devtest', modules: ['AR'] }; next(); });
app.use('/api/ar', require('../src/modules/receivables'));
app.use((e, req, res, next) => res.status(e.status || 500).json({ error: e.message })); // eslint-disable-line no-unused-vars

const server = app.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}/api/ar`;
  const get = async (p) => { const r = await fetch(base + p); return { status: r.status, body: await r.json() }; };
  try {
    const all = (await get('/filter-lookups')).body;
    for (const k of ['customers', 'divisions', 'jobs', 'phases', 'lots', 'packTypes', 'plans', 'invoices', 'tmOrders']) assert(Array.isArray(all[k]), `${k} is an array`);
    assert(all.customers.length && all.divisions.length && all.packTypes.length, 'base lists filled');
    assert.strictEqual(all.phases.length + all.lots.length + all.plans.length + all.tmOrders.length, 0, 'child lists empty without a parent filter');
    assert(all.invoices.length <= 300 && /^#\d+ \d\d\/\d\d\/\d{4} .*\$[\d,]+\.\d\d$/.test(all.invoices[0].name), 'invoice label format: ' + all.invoices[0]?.name);
    const jobId = all.jobs[0].id;
    const one = (await get(`/filter-lookups?jobId=${jobId}`)).body;
    assert(one.phases.length || one.lots.length, 'phases/lots filled once a job is set');
    const c = (await get(`/filter-lookups?customerId=${all.customers[0].id}`)).body;
    assert(c.jobs.length <= all.jobs.length, 'jobs filtered by customer');
    const s = (await get('/snapshots')).body;
    assert(Array.isArray(s.rows) && s.me === 'devtest', 'snapshots shape');
    assert.strictEqual((await get('/fix-code/preview')).status, 400, 'preview needs a division');
    const pv = await get(`/fix-code/preview?division=${all.divisions[0].id}`);
    assert.strictEqual(pv.status, 200); assert.strictEqual(pv.body.steps.length, 4, 'four fix steps');
    console.log('AR lookups / snapshots / fix-code preview: OK');
  } catch (e) { console.error('FAILED:', e.message); process.exitCode = 1; } finally { server.close(); setTimeout(() => process.exit(), 200); }
});
