import LotBilling from './LotBilling'

export default function RptLotBillingTM({ params }) {
  return <LotBilling routeKey="lot-billing-tm" params={params} tm csvName="lot-billing-tm.csv" />
}
