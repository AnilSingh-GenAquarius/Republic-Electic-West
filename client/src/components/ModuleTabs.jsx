import { NavLink } from 'react-router-dom'

/** Sub-navigation inside a module. tabs = [{ to, label, end? }] */
export default function ModuleTabs({ tabs }) {
  return (
    <nav className="module-tabs">
      {tabs.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end} className="module-tab">{t.label}</NavLink>
      ))}
    </nav>
  )
}
