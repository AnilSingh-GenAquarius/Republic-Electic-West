const { query, withTransaction, nextId } = require('./db');

/** Keep only allowed columns from a request body; convert '' to null. */
function pick(body, columns) {
  const out = {};
  for (const c of columns) {
    if (body && Object.prototype.hasOwnProperty.call(body, c)) {
      out[c] = body[c] === '' ? null : body[c];
    }
  }
  return out;
}

/**
 * Insert a row into a Staffware table (no IDENTITY: allocates MAX+1).
 * Stamps DateEntered / UserEntered when the table has them.
 */
async function insertRow({ table, idCol, columns, audit = true }, body, username, tx) {
  const run = async (t) => {
    const data = pick(body, columns);
    const id = await nextId(t, table, idCol);
    data[idCol] = id;
    if (audit) {
      data.DateEntered = new Date();
      data.UserEntered = username;
    }
    const cols = Object.keys(data);
    const params = {};
    cols.forEach((c, i) => (params[`v${i}`] = data[c]));
    await query(
      `INSERT INTO [${table}] (${cols.map((c) => `[${c}]`).join(',')}) VALUES (${cols.map((_, i) => `@v${i}`).join(',')})`,
      params,
      t
    );
    return id;
  };
  return tx ? run(tx) : withTransaction(run);
}

async function updateRow({ table, idCol, columns }, id, body, tx) {
  const data = pick(body, columns);
  const cols = Object.keys(data);
  if (!cols.length) return 0;
  const params = { id };
  cols.forEach((c, i) => (params[`v${i}`] = data[c]));
  const rows = await query(
    `UPDATE [${table}] SET ${cols.map((c, i) => `[${c}]=@v${i}`).join(',')} WHERE [${idCol}]=@id; SELECT @@ROWCOUNT AS n`,
    params,
    tx
  );
  return rows[0].n;
}

async function deleteRow({ table, idCol }, id, tx) {
  const rows = await query(`DELETE FROM [${table}] WHERE [${idCol}]=@id; SELECT @@ROWCOUNT AS n`, { id }, tx);
  return rows[0].n;
}

/** Wrap an async route handler so errors reach the error middleware. */
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Parse ?page=&pageSize= with sane bounds. */
function paging(q) {
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(q.pageSize, 10) || 25));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

module.exports = { pick, insertRow, updateRow, deleteRow, h, paging };
