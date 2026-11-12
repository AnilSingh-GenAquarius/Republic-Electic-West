import LotBilling from './LotBilling'

export default function RptLotBilling({ params }) {
  return <LotBilling routeKey="lot-billing" params={params} csvName="lot-billing.csv" />
}
