import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { canManageSchool, useAuth, type UserRole } from '@/lib/auth'
import { WorkspaceShell } from '@/components/layout/WorkspaceShell'

export function RequireAuth() {
  const { status, user } = useAuth()
  const location = useLocation()
  if (status === 'checking') return <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Checking your session…</div>
  if (status !== 'ready' || !user) return <Navigate to="/signin" replace state={{ from: location.pathname }} />
  return (
    <WorkspaceShell>
      <Outlet />
    </WorkspaceShell>
  )
}

export function RequireManager() {
  const { user } = useAuth()
  if (!canManageSchool(user?.role)) return <Navigate to="/app/portal" replace />
  return <Outlet />
}

export function RequireRoles({ roles }: { roles: UserRole[] }) {
  const { user } = useAuth()
  if (!user || !roles.includes(user.role)) return <Navigate to="/app/portal" replace />
  return <Outlet />
}
