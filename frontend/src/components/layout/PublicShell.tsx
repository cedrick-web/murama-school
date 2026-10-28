import { useState, type ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'

export function PublicShell({
  schoolName,
  children,
}: {
  schoolName: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const links = [
    { to: '/', label: 'Home' },
    { to: '/news', label: 'News' },
    { to: '/events', label: 'Events' },
    { to: '/gallery', label: 'Gallery' },
    { to: '/contact', label: 'Contact' },
  ]

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b bg-card/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/" className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">M</span>
            <span>
              <strong className="block text-sm leading-tight">{schoolName}</strong>
              <small className="text-xs text-muted-foreground">Official school platform</small>
            </span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Public pages">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  'rounded-lg px-3 py-2 text-sm font-medium ' + (isActive ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')
                }
                end={link.to === '/'}
              >
                {link.label}
              </NavLink>
            ))}
            <Link to="/signin" className="ml-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
              Sign in
            </Link>
          </nav>
          <button type="button" className="rounded-lg border px-3 py-2 text-sm md:hidden" onClick={() => setOpen((value) => !value)}>
            Menu
          </button>
        </div>
        {open && (
          <nav className="grid gap-1 border-t px-4 py-3 md:hidden">
            {links.map((link) => (
              <NavLink key={link.to} to={link.to} onClick={() => setOpen(false)} className="rounded-lg px-3 py-2 text-sm">
                {link.label}
              </NavLink>
            ))}
            <Link to="/signin" onClick={() => setOpen(false)} className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">
              Sign in
            </Link>
          </nav>
        )}
      </header>
      <main>{children}</main>
      <footer className="border-t bg-card">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
          <p>{schoolName} · Official school information from the live school system.</p>
          <Link to="/signin" className="font-medium text-primary">Staff and family portal</Link>
        </div>
      </footer>
    </div>
  )
}
