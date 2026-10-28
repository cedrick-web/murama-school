import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import AcademicPanel from '@/AcademicPanel'
import StudentsPanel from '@/StudentsPanel'
import OperationsPanel from '@/OperationsPanel'
import DashboardPanel from '@/DashboardPanel'

const dashboardRoutes = {
  users: '/app/users',
  academics: '/app/academics/years',
  students: '/app/students/roster',
  operations: '/app/operations/attendance',
  settings: '/app/settings',
  announcements: '/app/announcements',
  activity: '/app/activity',
} as const

export function DashboardPage() {
  const { token, user } = useAuth()
  const navigate = useNavigate()
  if (!token || !user) return null
  return (
    <DashboardPanel
      token={token}
      userName={[user.firstName, user.lastName].join(' ')}
      onNavigate={(section) => navigate(dashboardRoutes[section])}
    />
  )
}

export function StudentsPage() {
  const { token } = useAuth()
  if (!token) return null
  return <StudentsPanel token={token} />
}

export function AcademicsPage() {
  const { token } = useAuth()
  if (!token) return null
  return <AcademicPanel token={token} />
}

export function OperationsPage() {
  const { token } = useAuth()
  if (!token) return null
  return <OperationsPanel token={token} />
}
