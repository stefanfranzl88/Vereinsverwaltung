import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/auth/context'
import { visibleNav } from '@/nav'
import { fullName } from '@/lib/format'
import { fetchInvoices, invoicesKey } from '@/features/invoices/api'

export function AppShell() {
  const { tenant, member, roleLabel, can, hasModule, signOut } = useAuth()
  const navigate = useNavigate()
  const items = visibleNav(can, hasModule)

  // Badge am Nav-Punkt "Rechnungen": offene Belege, die auf Prüfung warten.
  // Nur für die Kassenführung relevant – wer nicht freigeben darf, sieht kein Badge.
  const showBadge = hasModule('kassa') && can('invoice.approve')
  const { data: invoices = [] } = useQuery({
    queryKey: invoicesKey(tenant?.id ?? ''),
    queryFn: () => fetchInvoices(tenant!.id),
    enabled: Boolean(tenant?.id) && showBadge,
  })
  const openInvoices = invoices.filter((i) => i.status === 'offen').length

  const handleLogout = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  const brand = tenant?.name ?? 'Vereinsverwaltung'
  const linkClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : '')

  return (
    <>
      <header className="topbar">
        <div className="brand-mark">
          {tenant?.logo_url ? <img src={tenant.logo_url} alt="" /> : brand.slice(0, 2).toUpperCase()}
        </div>
        <div className="topbar-title">{brand}</div>
        <div className="user-chip">
          <span className="name">{member ? fullName(member) : 'Unbekannt'}</span>
          <span className="role">{roleLabel}</span>
        </div>
        <button className="logout" onClick={handleLogout}>
          Abmelden
        </button>
      </header>

      <div className="layout">
        <nav className="sidenav">
          {items.map((n) => (
            <NavLink key={n.id} to={n.path} end={n.path === '/'} className={linkClass}>
              <span className="ico">{n.ico}</span>
              {n.label}
              {n.id === 'rechnungen' && openInvoices > 0 && (
                <span className="badge">{openInvoices}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <main>
          <Outlet />
        </main>
      </div>

      <nav className="bottomnav">
        {items.map((n) => (
          <NavLink key={n.id} to={n.path} end={n.path === '/'} className={linkClass}>
            <span className="ico">{n.ico}</span>
            {n.label}
          </NavLink>
        ))}
      </nav>
    </>
  )
}
