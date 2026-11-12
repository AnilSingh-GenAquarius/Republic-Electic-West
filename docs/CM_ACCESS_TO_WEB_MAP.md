# Contract management: Access switchboard → web app

Source: Access form **SwitchCM** ("Contract management"). In the web app open **Contract management** in the left menu. Its tabs are **Overview, Contract Management, Contract values, Revised contract values** and **Reports**. The letters below are the codes Access prints next to each button: they show which filters the button uses. In the web app you pick a report and only the filters it needs appear.

## Filters (letters A–L; the Access form has no G or H)

| Letter | Access filter | Web filter | API parameter |
|---|---|---|---|
| A | JS customer | JS customer | `jsCustomerId` |
| B | JS job | JS job (after choosing a JS customer) | `jsJobId` |
| C | JS lot | JS lot (after choosing a JS job) | `lotId` |
| D | JS phase | JS phase (after choosing a JS job) | `phaseId` |
| E | From | From | `from` |
| F | To | To | `to` |
| I | PM customer | PM customer | `customerId` |
| J | PM job | PM job (after choosing a PM customer) | `jobId` |
| K | PM bid | PM bid (after choosing a PM job) | `contractId` |
| L | Division | Division | `division` |

## Data entry forms (Access: 3)

| Access button | Letters | Access object | Where in the web app | Notes |
|---|---|---|---|---|
| Contract values | I J K | form `CmContractVal` | Contract values tab | Plan and pack contract values with their stage/work breakdown. Shows the "check your math" warning when a breakdown does not add up to the pack or plan value (Access forms `CmContractValCheckPack` and `CmContractValCheckPlan`). Also has **Set contract values** and **Refresh**. |
| Contract management | – | form `CmContract` | Contract Management tab, then open a job | Contracts and addenda of the job, with diary notes and links to estimating bids. |
| Revised contract values | A B C | form `CmRevContract` | Revised contract values tab | Standard and revised contract values of one scheduled lot, its packs and their breakdown. |

## Action buttons (Access: 1)

| Access button | Letters | Access object | Where in the web app | Notes |
|---|---|---|---|---|
| Update lot contract values | I J K | macro `CmUpdateContractVal` | Contract values tab → Update lot contract values | Shows how many lots, packs and breakdown values will change, then asks to confirm. |

## Reports (Access: 20)

| # | Access button | Letters | Access object | Where in the web app (Reports tab) | Choose first |
|---|---|---|---|---|---|
| 1 | Job history log | I J | `CmJobHistoryLog` | Reports → Job history log | PM customer, PM job |
| 2 | Plans w/no contract val | L | `CmNoContractVal` | Reports → Plans w/no contract val | Division |
| 3 | Contract latest changes | L | `CmLatestChanges` | Reports → Contract latest changes | Division |
| 4 | Contract history | I J | `CmContractHistory` | Reports → Contract history | PM customer, PM job |
| 5 | Contract values by plan | I L | `CmContractValueBuilder` | Reports → Contract values by plan | PM customer, Division |
| 6 | Contract data by job | I J | `CmContractJob` | Reports → Contract data by job | PM customer, PM job |
| 7 | Contracts not executed | – | `CmContractNotExecuted` | Reports → Contracts not executed | nothing |
| 8 | Jobs with no contract | – | `CmNoContractJob` | Reports → Jobs with no contract | nothing |
| 9 | Bids with no contract | – | `CmNoContractBid` | Reports → Bids with no contract | nothing |
| 10 | To do - diary | E F | `CmToDoDiary` | Reports → To do - diary | From, To |
| 11 | Plan contract values by pack | I J K | `CmPlanContractVal` | Reports → Plan contract values by pack | PM customer, PM job, PM bid |
| 12 | Plan contract values by work | I J K | `CmPlanContractValWork` | Reports → Plan contract values by work | PM customer, PM job, PM bid |
| 13 | Option contract values | I J K | `CmOptionContractVal` | Reports → Option contract values | PM customer, PM job, PM bid |
| 14 | Option contract values II | I J K | `CmOptionContractVal2` | Reports → Option contract values II | PM customer, PM job, PM bid |
| 15 | Option contract values III | I J K | `CmOptionContractVal3` | Reports → Option contract values III | PM customer, PM job, PM bid |
| 16 | Sequence sheet - billing data | A B D | `CmSequenceSheet` | Reports → Sequence sheet - billing data | JS customer, JS job, JS phase |
| 17 | Packs not contracted $0.01 | I | `CmNotContracted` | Reports → Packs not contracted $0.01 | PM customer |
| 18 | New packs after trued up | L | `CmPacksAfterTruedUp` | Reports → New packs after trued up | Division |
| 19 | Options scheduled-lots | A B E F | `CmOptionSelect` | Reports → Options scheduled-lots | JS customer, JS job, From, To |
| 20 | Packs not trued up | E F L | `CmPacksNotTruedUp` | Reports → Packs not trued up | Division, From, To |

## Things to know

- **Same names as Access.** The web screens, report names and filter names are the Access ones, so staff can find each item by the name they know.
- **Contract latest changes** lists the contracts flagged "latest print" and clears those flags when it runs, as in Access. The web app asks to confirm first.
- **Options scheduled-lots** asks you to pick the options first, then lists the lots of the JS job that started between the dates.
- **Job history log** is an Estimating report in Access (button `EsJobLogReport`); the web app offers it here under Contract management.
- **Contracts not executed**, **Jobs with no contract** and **Bids with no contract** take no filters in Access, and none in the web app.
- The report layouts follow the Access queries. They were checked against direct SQL on the sample database; the sample data is thin for a few of them, so some reports show little or no data until real data is loaded.
