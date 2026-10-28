import { useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import {
  Activity,
  Bell,
  BookOpen,
  CalendarDays,
  GraduationCap,
  Images,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  MessageSquare,
  Settings,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import { canManageSchool, useAuth, type UserRole } from '@/lib/auth'
import { initials } from '@/lib/format'
import '../../admin.css'
import '../../admin-modern.css'
import '../../dashboard.css'
import '../../operations.css'

interface NavItem {
  to: string
  label: string
  icon: typeof LayoutDashboard
  roles?: UserRole[]
}

const overviewItems: NavItem[] = [
  { to: '/app/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['ADMIN', 'HEADTEACHER'] },
  { to: '/app/portal', label: 'My portal', icon: Bell },
]

const peopleItems: NavItem[] = [
  { to: '/app/students/roster', label: 'Students', icon: GraduationCap, roles: ['ADMIN', 'HEADTEACHER'] },
  { to: '/app/teachers', label: 'Teachers', icon: Users, roles: ['ADMIN', 'HEADTEACHER'] },
  { to: '/app/parents', label: 'Parents', icon: Users, roles: ['ADMIN', 'HEADTEACHER'] },
  { to: '/app/users', label: 'Accounts', icon: Users, roles: ['ADMIN', 'HEADTEACHER'] },
]

const schoolItems: NavItem[] = [
  { to: '/app/academics/years', label: 'Academics', icon: BookOpen, roles: ['ADMIN', 'HEADTEACHER'] },
  { to: '/app/operations/attendance', label: 'Operations', icon: Wallet, roles: ['ADMIN', 'HEADTEACHER'] },
  { to: '/app/announcements', label: 'Announcements', icon: Megaphone, roles: ['ADMIN', 'HEADTEACHER'] },
  { to: '/app/content', label: 'Public content', icon: Images, roles: ['ADMIN', 'HEADTEACHER'] },
  { to: '/app/activity', label: 'Audit log', icon: Activity, roles: ['ADMIN', 'HEADTEACHER'] },
  { to: '/app/settings', label: 'Settings', icon: Settings, roles: ['ADMIN', 'HEADTEACHER'] },
]

const teachingItems: NavItem[] = [
  { to: '/app/portal', label: 'Class register', icon: CalendarDays, roles: ['TEACHER'] },
]

function allowed(item: NavItem, role: UserRole): boolean {
  return !item.roles || item.roles.includes(role)
}

function NavGroup({ title, items, role, onNavigate }: { title: string; items: NavItem[]; role: UserRole; onNavigate: () => void }) {
  const visible = items.filter((item) => allowed(item, role))
  if (!visible.length) return null
  return (
    <div className="space-y-1">
      <p className="px-3 pt-4 text-[11px] font-semibold tracking-[0.16em] text-white/45">{title}</p>
      {visible.map((item) => {
        const Icon = item.icon
        return (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={({ isActive }) =>
              'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ' +
              (isActive ? 'bg-white text-primary' : 'text-white/80 hover:bg-white/10 hover:text-white')
            }
          >
            <Icon className="size-4" />
            {item.label}
          </NavLink>
        )
      })}
    </div>
  )
}

export function WorkspaceShell({ children }: { children?: ReactNode }) {
  const { user, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  if (!user) return null
  const name = [user.firstName, user.lastName].join(' ')
  const close = () => setOpen(false)

  return (
    <div className="min-h-screen bg-[#eef3ec] lg:grid lg:grid-cols-[280px_1fr]">
      <aside className={'fixed inset-y-0 left-0 z-50 w-[280px] overflow-y-auto bg-[#123524] p-4 text-white transition lg:static ' + (open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0')}>
        <div className="mb-6 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-accent text-sm font-bold text-accent-foreground">M</span>
            <span>
              <strong className="block text-sm">Murama School</strong>
              <small className="text-xs text-white/60">{canManageSchool(user.role) ? 'Administration' : 'Community portal'}</small>
            </span>
          </Link>
          <button type="button" className="rounded-lg p-2 lg:hidden" onClick={close} aria-label="Close navigation">
            <X className="size-5" />
          </button>
        </div>
        <NavGroup title="OVERVIEW" items={overviewItems} role={user.role} onNavigate={close} />
        <NavGroup title="PEOPLE" items={peopleItems} role={user.role} onNavigate={close} />
        <NavGroup title="SCHOOL" items={schoolItems} role={user.role} onNavigate={close} />
        <NavGroup title="TEACHING" items={teachingItems} role={user.role} onNavigate={close} />
        <div className="mt-6 space-y-1">
          <p className="px-3 pt-4 text-[11px] font-semibold tracking-[0.16em] text-white/45">ACCOUNT</p>
          <NavLink to="/app/account" onClick={close} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-white/80 hover:bg-white/10">
            <MessageSquare className="size-4" /> Password & profile
          </NavLink>
        </div>
        <div className="mt-8 rounded-2xl bg-white/8 p-3">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-full bg-white/15 text-xs font-bold">{initials(user.firstName, user.lastName)}</span>
            <span className="min-w-0">
              <strong className="block truncate text-sm">{name}</strong>
              <small className="text-xs text-white/60">{user.role}</small>
            </span>
            <button type="button" className="ml-auto rounded-lg p-2 hover:bg-white/10" onClick={signOut} aria-label="Sign out">
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>
      {open && <button type="button" className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={close} aria-label="Close navigation overlay" />}
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b bg-card/90 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-3">
            <button type="button" className="rounded-lg border p-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation">
              <Menu className="size-5" />
            </button>
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">École Secondaire de Murama</p>
              <p className="text-sm font-semibold">{canManageSchool(user.role) ? 'School operations workspace' : 'Personal school portal'}</p>
            </div>
          </div>
          <span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-secondary-foreground">{user.role}</span>
        </header>
        <div className="px-4 py-6 lg:px-8">
          {children ?? <Outlet />}
        </div>
      </div>
    </div>
  )
}
