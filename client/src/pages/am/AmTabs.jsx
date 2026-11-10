import ModuleTabs from '../../components/ModuleTabs'

export default function AmTabs() {
  return (
    <ModuleTabs tabs={[
      { to: '/am', label: 'Overview', end: true },
      { to: '/am/accounts', label: 'Accounts' },
      { to: '/am/renewals', label: 'Renewals' },
      { to: '/am/reports', label: 'Reports' },
      { to: '/am/audit', label: 'Audit' },
    ]} />
  )
}
