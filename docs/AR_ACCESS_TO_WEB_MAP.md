# Accounts receivable: Access switchboard → web app

Source: Access form **SwitchAR** ("Accounts receivable"). In the web app open **Accounts receivable → Reports**: pick a report card (like Management reports) and only the filters that report needs appear. The letters below are the codes Access prints next to each button. A PDF copy of this table is `AR_ACCESS_TO_WEB_MAP.pdf`.

## Filters (letters on every Access button)

| Letter | Access filter | Web filter | API parameter |
|---|---|---|---|
| A | Customer | Builder | `customerId` |
| B | Job | Job (after choosing a builder) | `jobId` |
| C | Lot | Lot (after choosing a job) | `lotId` |
| D | Phase | Phase (after choosing a job) | `phaseId` |
| E | From | From | `from` |
| F | To | To | `to` |
| G | Pack type | Pack type | `packTypeId` |
| H | Date | Date | `date` |
| I | Division | Division | `division` |
| J | Invoice | Invoice | `invoiceId` |
| K | Plan | Plan (after choosing a job) | `planId` |
| L | Burden | Burden (percent, e.g. 15) | `burden` |
| M | T&M # | T&M order | `tmId` |

Only the filters a report uses are shown when you pick it.

## Data entry forms (Access: 4)

| Access button | Letters | Access object | Web location | Notes |
|---|---|---|---|---|
| Process billing | A H I | macro `ArProcessBilling` | Process billing tab | Lots come from a live query (Access copies them into a temp table first). |
| Process billing job | A B H I | macro `ArProcessBillingJob` | Process billing tab, choose a Job | Same lot rules as the macro; a "Packs paid (payroll)" column shows the payroll payment info the macro appends. |
| Manual invoice | – | form `ArInvoiceManual` | Invoices → Manual invoice | |
| Manual fix billing code | I J | `ArBillCodeFix` (manual form) | Fix billing code → Manual | Pick a division and invoice, then set stage/work per line. |

## Action buttons (Access: 3, plus the snapshot box)

| Access button | Letters | Access object | Web location | Notes |
|---|---|---|---|---|
| Post billing | A H I | macro `ArPostBilling` | Post billing tab → Post billing | |
| Clear billing snapshot | A I | macro `ArClearBillingSnapshot` | Post billing tab → Clear billing snapshot | In-page confirmation. |
| Fix billing code | I | macro `ArBillCodeFix` | Fix billing code tab | Preview first (nothing saved), then confirm and run all steps in one transaction. |
| *Customer snapshot in use* (box) | – | `SwitchARsubBillProcess` | Shown on Process billing and Post billing | Warns when another user is billing the same builder and division. |

## Reports (Access: 18)

| # | Access button | Letters | Access object | Where in the web app (Reports page card) | Choose first |
|---|---|---|---|---|---|
| 1 | Invoices by date/div | E F I | `ArInvoiceDateDiv` | Reports → Invoices → Invoices by date / division (opens the Invoices tab) | – |
| 2 | Inv summary by date/div | E F I | `ArInvoiceDateDivSumm` | Reports → Invoices → Invoice summary by date / division (opens Invoice totals) | – |
| 3 | Invoice | J | `ArInvoice` | Reports → Invoices → Invoice (opens Invoices; pick an invoice, then Print) | Invoice |
| 4 | Pre billing detail | A I | `ArTempBillDetail` | Reports → Pre-billing → Pre billing detail | Division |
| 5 | Pre billing summary | A I | `ArTempBillSumm` | Reports → Pre-billing → Pre billing summary | Division |
| 6 | Lot-pack to bill | A E F I | `ArLotPackToBill` (+ payroll pop-ups) | Reports → To bill and billing by lot → Lot-pack to bill | Division, From, To |
| 7 | Lot-pack by type to bill | A E F G I | `ArLotPackTypeToBill` | Reports → To bill and billing by lot → Lot-pack by type to bill | Division, From, To, Pack type |
| 8 | Lots by plan | A B K | `ArLotsByPlan` | Reports → To bill and billing by lot → Lots by plan | Job, Plan |
| 9 | Billing by super | H I | `ArBillingBySuper` | Reports → To bill and billing by lot → Billing by super | Date, Division |
| 10 | Total billing by lot | A B C | `ArLotBilling` | Reports → To bill and billing by lot → Total billing by lot | Lot |
| 11 | T&M (beside Total billing by lot) | A B C | `ArLotBillingTM#` | Reports → To bill and billing by lot → Total billing by lot (T&M) | Lot |
| 12 | W I P | A I L | `ArWip` | Reports → Work in progress → WIP | Division |
| 13 | Exp | A I L | `extArWip` (export of `rptArWip07WipExport`) | Reports → Work in progress → WIP export (on screen + CSV) | Division |
| 14 | W I P timed | A E F I (+ L) | `ArWipTimed` | Reports → Work in progress → WIP timed | Division, From, To |
| 15 | W I P lot | A B C L | `ArWipLot` | Reports → Work in progress → WIP lot | Lot |
| 16 | W I P T&M | A B M | `ArWipTM` | Reports → Work in progress → WIP T&M | T&M order |
| 17 | W I P job w/TM ID | A B I L | `ArWipTMJob` | Reports → Work in progress → WIP job w/TM ID | Division, Job |
| 18 | Sequence sheet billing data | A B D | `ArCmSequenceSheet` | Reports → Other → Sequence sheet billing data | Phase |

## Known differences from Access (deliberate)

- **Burden (L)** is a percent number in the web (15 means 15%); Access stores a fraction. W I P timed also takes Burden, because the Access query prompts for it.
- **Division by zero:** ratios show blank instead of a `#Div/0` error.
- **Fix billing code:** only lines with exactly one matching stage/work are fixed automatically; ambiguous lines are listed for the Manual fix (Access picks one arbitrarily).
- **Snapshot warning:** shown only when another user holds the snapshot.
- **Pop-up reports** (payroll detail/total under Lot-pack to bill) open inline under the row instead of a second window.
- **Lots without a plan** still appear in the lot reports (Access hides them with an inner join). The local data has none.
- Reports are checked against direct SQL on the sample database. The sample database has few rows for some reports (e.g. pre-billing snapshot, Fix billing code), so those show little or no data until real data is loaded.
