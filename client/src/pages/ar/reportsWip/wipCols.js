// column sets: [key, heading, type]
export const WIP_COLS = [
  ['LotBlock', 'Lot / block'], ['LaborEst', 'Labor est', 'money'], ['LaborPaid', 'Labor paid', 'money'], ['LaborPercent', 'Lbr %', 'pct'],
  ['MaterialEst', 'Material est', 'money'], ['MaterialPosted', 'Mat posted', 'money'], ['MaterialPercent', 'Mat %', 'pct'],
  ['ExtContractVal', 'Ext contract', 'money'], ['ExtContractValOpt', 'Ext contract opt', 'money'], ['Invoiced', 'Invoiced', 'money'], ['InvoicedOpt', 'Invoiced opt', 'money'],
  ['BillingPercent', 'Bill %', 'pct'], ['Balance', 'Balance', 'money'], ['ProfitEst', 'Profit est', 'money'], ['GEpct', 'GE%', 'pct'], ['ProfitActual', 'Profit actual', 'money'], ['GApct', 'GA%', 'pct'],
]
export const TMJOB_COLS = [WIP_COLS[0], ['TMpresent', 'TM'], ...WIP_COLS.slice(1)]
export const TIMED_COLS = [
  ['LotBlock', 'Lot / block / plan'], ['StartDate', 'Start date', 'date'],
  ['LaborEstStd', 'Labor std', 'money'], ['LaborEst', 'Labor total est', 'money'], ['LaborPaid', 'Labor actual', 'money'], ['LaborPercent', 'Lbr %', 'pct'],
  ['MaterialEstStd', 'Material std', 'money'], ['MaterialEst', 'Material total est', 'money'], ['MaterialPosted', 'Material actual', 'money'], ['MaterialPercent', 'Mat %', 'pct'],
  ['StdContractVal', 'Contract std', 'money'], ['ExtContractVal', 'Contract total est', 'money'], ['Invoiced', 'Billing', 'money'], ['BillingPercent', 'Bill %', 'pct'], ['Balance', 'Balance', 'money'],
  ['ProfitStd', 'Profit std', 'money'], ['GSpct', 'GS%', 'pct'], ['ProfitEst', 'Profit est', 'money'], ['GEpct', 'GE%', 'pct'], ['ProfitActual', 'Profit actual', 'money'], ['GApct', 'GA%', 'pct'],
]
const csvOf = (cols) => cols.map(([k, l]) => [k, l])
export const WIP_CSV = csvOf([['CustName', 'Customer'], ['JobName', 'Job'], ['LotID', 'Lot ID'], ...WIP_COLS])
export const TMJOB_CSV = csvOf([['CustName', 'Customer'], ['JobName', 'Job'], ['LotID', 'Lot ID'], ...TMJOB_COLS])
export const TIMED_CSV = csvOf([['CustName', 'Customer'], ['JobName', 'Job'], ...TIMED_COLS])
// rptArWip07WipExport column names (percent columns come as fractions)
export const EXPORT_COLS = [
  ['CustName', 'CustName'], ['JobName', 'JobName'], ['LotBlock', 'LotBlock'], ['LaborEst', 'LaborEst', 'money'], ['LaborPaid', 'LaborPaid', 'money'], ['LaborPercent', 'LaborPercent', 'pct'],
  ['MaterialEst', 'MaterialEst', 'money'], ['MaterialPosted', 'MaterialPosted', 'money'], ['MaterialPercent', 'MaterialPercent', 'pct'], ['ExtContractVal', 'ExtContractVal', 'money'],
  ['ExtContractValOpt', 'ExtContractValOpt', 'money'], ['Invoiced', 'Invoiced', 'money'], ['InvoicedOpt', 'InvoicedOpt', 'money'], ['BillingPercent', 'BillingPercent', 'pct'],
  ['Balance', 'Balance', 'money'], ['ProfitEst', 'ProfitEst', 'money'], ['GE%', 'GE%', 'pct'], ['ProfitActual', 'ProfitActual', 'money'], ['GA%', 'GA%', 'pct'],
]
