import { FormEvent, useCallback, useEffect, useState } from 'react'
import './staff-portal.css'

type Role = 'HEADTEACHER' | 'STAFF'
type Section = 'overview' | 'timetable' | 'classes' | 'messages' | 'notifications'
interface User {
  id: number
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  role: Role
}
interface ApiResponse {
  success?: boolean
  message?: string
  token?: string
  user?: User
  profile?: User & { employeeNumber?: string | null }
  permissions?: { canViewTeachingAssignments: boolean; canManageSchoolAdministration: boolean }
  teaching?: { assignedClasses: number; timetableEntries: number; assessmentsCreated: number; studentsInAssignedClasses: number }
  unreadMessages?: number
  unreadNotifications?: number
  entries?: Array<Record<string, unknown>>
  classes?: Array<Record<string, unknown>>
  messages?: Array<Record<string, unknown>>
  notifications?: Array<Record<string, unknown>>
}
const tokenKey = 'murama-staff-token'
const apiUrl = (import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? '' : 'http://localhost:5000')).replace(/\/$/, '')
const sections: Array<{ id: Section; title: string; icon: string }> = [
  { id: 'overview', title: 'Overview', icon: '⌂' },
  { id: 'timetable', title: 'My timetable', icon: '◷' },
  { id: 'classes', title: 'Teaching assignments', icon: '▤' },
  { id: 'messages', title: 'Messages', icon: '✉' },
  { id: 'notifications', title: 'Notifications', icon: '♢' },
]
async function request<T extends ApiResponse>(path: string, token?: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl + path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...options.headers,
    },
  })
  const result = await response.json().catch(() => null) as T | null
  if (!response.ok || !result?.success) throw new Error(result?.message ?? 'Request failed (' + response.status + ')')
  return result
}
function display(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'object') return '—'
  return String(value)
}
function dayName(value: unknown): string {
  const day = Number(value)
  return ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][day - 1] ?? 'Unscheduled'
}
function formatDate(value: unknown): string {
  if (!value) return '—'
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('en-RW', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}
export default function StaffPortalApp() {
  const [token, setToken] = useState(() => sessionStorage.getItem(tokenKey))
  const [user, setUser] = useState<User | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authLoading, setAuthLoading] = useState(Boolean(sessionStorage.getItem(tokenKey)))
  const [busy, setBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const [error, setError] = useState('')
  const [section, setSection] = useState<Section>('overview')
  const [overview, setOverview] = useState<ApiResponse | null>(null)
  const [entries, setEntries] = useState<Array<Record<string, unknown>>>([])
  const [classes, setClasses] = useState<Array<Record<string, unknown>>>([])
  const [messages, setMessages] = useState<Array<Record<string, unknown>>>([])
  const [notifications, setNotifications] = useState<Array<Record<string, unknown>>>([])
  const [loading, setLoading] = useState(false)
  const [refresh, setRefresh] = useState(0)

  const signOut = useCallback(() => {
    sessionStorage.removeItem(tokenKey)
    setToken(null)
    setUser(null)
    setOverview(null)
    setEntries([])
    setClasses([])
    setMessages([])
    setNotifications([])
    setAuthError('')
    setError('')
  }, [])

  useEffect(() => {
    if (!token) {
      setAuthLoading(false)
      setUser(null)
      return
    }
    let active = true
    setAuthLoading(true)
    request<{ user: User }>('/api/auth/me', token)
      .then(({ user: current }) => {
        if (!active) return
        if (!['HEADTEACHER', 'STAFF'].includes(current.role)) {
          throw new Error('This workspace is for teachers and school staff. Use the appropriate school portal for your account.')
        }
        setUser(current)
      })
      .catch((reason: unknown) => {
        if (!active) return
        sessionStorage.removeItem(tokenKey)
        setToken(null)
        setUser(null)
        setAuthError(reason instanceof Error ? reason.message : 'Unable to verify your session')
      })
      .finally(() => { if (active) setAuthLoading(false) })
    return () => { active = false }
  }, [token])

  useEffect(() => {
    if (!token || !user) return
    let active = true
    setLoading(true)
    setError('')
    const jobs: Promise<unknown>[] = [
      request<ApiResponse>('/api/staff/overview', token).then((r) => { if (active) setOverview(r) }),
    ]
    if (user.role === 'HEADTEACHER') {
      jobs.push(request<ApiResponse>('/api/staff/timetable', token).then((r) => { if (active) setEntries(r.entries ?? []) }))
      jobs.push(request<ApiResponse>('/api/staff/classes', token).then((r) => { if (active) setClasses(r.classes ?? []) }))
    }
    jobs.push(request<ApiResponse>('/api/portal/messages', token).then((r) => { if (active) setMessages(r.messages ?? []) }))
    jobs.push(request<ApiResponse>('/api/portal/notifications', token).then((r) => { if (active) setNotifications(r.notifications ?? []) }))
    Promise.all(jobs)
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Unable to load staff data') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [token, user, refresh])

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setAuthError('')
    try {
      const result = await request<{ token: string; user: User }>('/api/auth/login', undefined, {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password }),
      })
      if (!result.token || !result.user) throw new Error('The server did not return a valid school session')
      if (!['HEADTEACHER', 'STAFF'].includes(result.user.role)) {
        throw new Error('This workspace is for teachers and school staff. Use the appropriate school portal for your account.')
      }
      sessionStorage.setItem(tokenKey, result.token)
      setPassword('')
      setUser(result.user)
      setToken(result.token)
    } catch (reason) {
      setAuthError(reason instanceof Error ? reason.message : 'Unable to sign in')
    } finally {
      setBusy(false)
    }
  }

  const profile = overview?.profile
  const teaching = overview?.teaching
  const canTeach = user?.role === 'TEACHER' || user?.role === 'HEADTEACHER'

  if (authLoading) return <main className="staff-auth-screen"><div className="staff-spinner" /><p>Verifying your school account…</p></main>
  if (!token || !user) return <main className="staff-auth-screen"><section className="staff-login-card">
    <a className="staff-brand" href="/"><span className="staff-brand-mark">M</span><span><strong>MURAMA</strong><small>DIGITAL SCHOOL</small></span></a>
    <span className="staff-eyebrow">EDUCATOR & STAFF SERVICES</span><h1>Your school workspace.</h1>
    <p className="staff-muted">Access your teaching timetable, assigned classes and official school communications.</p>
    {authError && <div className="staff-alert" role="alert">{authError}</div>}
    <form onSubmit={login} className="staff-login-form">
      <label>School email<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
      <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in to workspace'}</button>
    </form>
    <a className="staff-back-link" href="/">← Back to school website</a>
  </section></main>

  const pageTitle = sections.find((item) => item.id === section)?.title ?? 'Overview'
  return <div className="staff-app">
    <aside className="staff-sidebar">
      <a className="staff-brand" href="/"><span className="staff-brand-mark">M</span><span><strong>MURAMA</strong><small>DIGITAL SCHOOL</small></span></a>
      <span className="staff-sidebar-label">STAFF WORKSPACE</span>
      <nav>{sections.filter((item) => canTeach || !['timetable', 'classes'].includes(item.id)).map((item) => <button key={item.id} className={section === item.id ? 'active' : ''} onClick={() => setSection(item.id)} type="button"><span>{item.icon}</span>{item.title}</button>)}</nav>
      <div className="staff-sidebar-user"><span className="staff-avatar">{user.firstName.slice(0,1)}{user.lastName.slice(0,1)}</span><span><strong>{user.firstName} {user.lastName}</strong><small>{user.role.replace('_', ' ')}</small></span><button type="button" onClick={signOut} title="Sign out" aria-label="Sign out">↗</button></div>
    </aside>
    <main className="staff-main">
      <header className="staff-topbar"><div><span className="staff-eyebrow">ÉCOLE SECONDAIRE DE MURAMA</span><h1>{pageTitle}</h1></div><div className="staff-top-actions"><span className="staff-role-pill">{user.role}</span><button type="button" onClick={() => setRefresh((n) => n + 1)} disabled={loading}>↻ Refresh</button></div></header>
      <section className="staff-content">
        {error && <div className="staff-alert" role="alert"><span>{error}</span><button type="button" onClick={() => setRefresh((n) => n + 1)}>Retry</button></div>}
        {loading && <div className="staff-loading-line"><span className="staff-spinner" /> Syncing school records…</div>}
        {section === 'overview' && <>
          <div className="staff-welcome"><div><span className="staff-eyebrow">YOUR SECURE WORKSPACE</span><h2>Welcome, {user.firstName}.</h2><p>Your school information is loaded from the authorised school system. Your access follows your current account role.</p></div><span className="staff-welcome-symbol">M</span></div>
          <div className="staff-metric-grid">
            <article><span>Assigned classes</span><strong>{canTeach ? display(teaching?.assignedClasses) : '—'}</strong><small>{canTeach ? 'Classes on your timetable' : 'Teaching access not assigned'}</small></article>
            <article><span>Timetable entries</span><strong>{canTeach ? display(teaching?.timetableEntries) : '—'}</strong><small>Scheduled teaching periods</small></article>
            <article><span>Active students</span><strong>{canTeach ? display(teaching?.studentsInAssignedClasses) : '—'}</strong><small>Across assigned class groups</small></article>
            <article><span>Unread messages</span><strong>{display(overview?.unreadMessages ?? 0)}</strong><small>School communication</small></article>
          </div>
          <div className="staff-panel"><div className="staff-panel-heading"><div><h3>Account information</h3><p>Current school identity and access assignment</p></div></div><dl className="staff-profile-grid"><div><dt>Name</dt><dd>{user.firstName} {user.lastName}</dd></div><div><dt>Email</dt><dd>{user.email ?? 'Not set'}</dd></div><div><dt>Role</dt><dd>{user.role}</dd></div><div><dt>Employee number</dt><dd>{display(profile?.employeeNumber)}</dd></div></dl></div>
          <div className="staff-panel"><div className="staff-panel-heading"><div><h3>Next steps</h3><p>Available modules for your current role</p></div></div><div className="staff-shortcuts">{(canTeach ? sections.filter((x) => ['timetable','classes','messages','notifications'].includes(x.id)) : sections.filter((x) => ['messages','notifications'].includes(x.id))).map((item) => <button key={item.id} type="button" onClick={() => setSection(item.id)}><span>{item.icon}</span><strong>{item.title}</strong><small>Open module →</small></button>)}</div></div>
        </>}
        {section === 'timetable' && <div className="staff-panel"><div className="staff-panel-heading"><div><h3>My timetable</h3><p>Only periods assigned to your linked teacher profile are shown.</p></div></div>{entries.length ? <div className="staff-table-wrap"><table><thead><tr><th>Day</th><th>Time</th><th>Class / stream</th><th>Subject</th><th>Room</th><th>Term</th></tr></thead><tbody>{entries.map((item) => <tr key={String(item.id)}><td>{dayName(item.dayOfWeek)}</td><td>{display(item.startsAt)}–{display(item.endsAt)}</td><td>{display(item.className)}{item.streamName ? ' / ' + display(item.streamName) : ''}</td><td><strong>{display(item.subjectName)}</strong><small>{display(item.subjectCode)}</small></td><td>{display(item.room)}</td><td>{display(item.termName ?? item.academicYearName)}</td></tr>)}</tbody></table></div> : <div className="staff-empty"><strong>No timetable entries found</strong><p>Your account may not yet be linked to a teacher profile, or the administration has not assigned periods.</p></div>}</div>}
        {section === 'classes' && <div className="staff-panel"><div className="staff-panel-heading"><div><h3>Teaching assignments</h3><p>Class groups linked to your timetable assignments.</p></div></div>{classes.length ? <div className="staff-table-wrap"><table><thead><tr><th>Class</th><th>Stream</th><th>Academic year</th><th>Active students</th><th>Periods</th></tr></thead><tbody>{classes.map((item, i) => <tr key={String(item.classId) + '-' + String(item.streamId ?? i)}><td><strong>{display(item.className)}</strong></td><td>{display(item.streamName)}</td><td>{display(item.academicYearName)}</td><td>{display(item.activeStudents)}</td><td>{display(item.timetableEntries)}</td></tr>)}</tbody></table></div> : <div className="staff-empty"><strong>No assigned classes yet</strong><p>Ask the school administrator to connect your teacher profile to the timetable.</p></div>}</div>}
        {section === 'messages' && <div className="staff-panel"><div className="staff-panel-heading"><div><h3>School messages</h3><p>Messages addressed to your authenticated account.</p></div></div>{messages.length ? <div className="staff-message-list">{messages.map((item) => <article key={String(item.id)}><div><strong>{display(item.subject)}</strong><small>From {display(item.senderName)} · {formatDate(item.sentAt)}</small></div><p>{display(item.body)}</p></article>)}</div> : <div className="staff-empty"><strong>No messages yet</strong><p>Official school messages addressed to you will appear here.</p></div>}</div>}
        {section === 'notifications' && <div className="staff-panel"><div className="staff-panel-heading"><div><h3>Notifications</h3><p>Updates linked to your account.</p></div></div>{notifications.length ? <div className="staff-message-list">{notifications.map((item) => <article key={String(item.id)}><div><strong>{display(item.title)}</strong><small>{display(item.type)} · {formatDate(item.createdAt)}</small></div><p>{display(item.body)}</p><span className={'staff-notification-state' + (item.readAt ? '' : ' unread')}>{item.readAt ? 'Read' : 'Unread'}</span></article>)}</div> : <div className="staff-empty"><strong>You are all caught up</strong><p>New school notifications will appear here.</p></div>}</div>}
      </section>
    </main>
  </div>
}
