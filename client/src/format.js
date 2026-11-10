// SQL datetimes come back as ISO strings; dates are stored at midnight so show the date part only.
export const fmtDate = (v) => {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d) ? '' : d.toLocaleDateString('en-US', { timeZone: 'UTC' });
};

// For <input type="date"> values.
export const toInputDate = (v) => (v ? String(v).slice(0, 10) : '');

export const fmtMoney = (v) =>
  v == null || v === '' ? '' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
