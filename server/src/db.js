const sql = require('mssql/msnodesqlv8');

let poolPromise;

function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool({
      connectionString: process.env.DB_CONNECTION,
      options: { trustedConnection: true },
    }).connect();
  }
  return poolPromise;
}

/**
 * Run a parameterised query. params = { name: value } or { name: [sql.Type, value] }.
 */
async function query(text, params = {}, tx) {
  const run = async () => {
    const req = tx ? new sql.Request(tx) : (await getPool()).request();
    for (const [name, v] of Object.entries(params)) {
      if (Array.isArray(v)) req.input(name, v[0], v[1]);
      else req.input(name, v === undefined ? null : v);
    }
    const result = await req.query(text);
    return result.recordset;
  };
  if (!tx) return run();
  // A transaction is one connection: queries on it must run one at a time. Queue them so code that
  // uses Promise.all inside a transaction can't overlap requests (which fails and can leave locks).
  const p = (tx._swQueue || Promise.resolve()).then(run, run);
  tx._swQueue = p.catch(() => {});
  return p;
}

/** Run fn(tx) inside a transaction. */
async function withTransaction(fn) {
  const tx = new sql.Transaction(await getPool());
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const out = await fn(tx);
    await tx.commit();
    return out;
  } catch (e) {
    await tx._swQueue; // let any queued query finish before rolling back
    await tx.rollback().catch(() => {});
    throw e;
  }
}

/**
 * Staffware tables have no IDENTITY columns; the Access app used MAX+1.
 * Call inside a SERIALIZABLE transaction so concurrent inserts don't collide.
 */
async function nextId(tx, table, idCol) {
  const rows = await query(
    `SELECT ISNULL(MAX([${idCol}]),0)+1 AS id FROM [${table}] WITH (UPDLOCK, HOLDLOCK)`,
    {},
    tx
  );
  return rows[0].id;
}

module.exports = { sql, getPool, query, withTransaction, nextId };
