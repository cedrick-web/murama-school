import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { finishGoogleSignIn, getGoogleCallbackError, startGoogleSignIn, cleanGoogleCallbackUrl } from './lib/supabase-auth'
import './portal.css'
import { ApiError } from './lib/api'
import { clearSchoolSession, persistSchoolToken, readSchoolToken } from './lib/school-session'

type Role = 'ADMIN' | 'HEADTEACHER' | 'TEACHER' | 'STUDENT' | 'PARENT' | 'STAFF'
type PortalSection = 'overview' | 'results' | 'attendance' | 'timetable' | 'fees' | 'messages' | 'notifications'
type RecordValue = string | number | boolean | null | undefined
type RecordRow = Record<string, RecordValue | unknown>

interface PortalUser {
  id: number
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  role: Role
}
interface ApiEnvelope {
  success?: boolean
  message?: string
  token?: string
  user?: PortalUser
  student?: RecordRow
  children?: RecordRow[]
  results?: RecordRow[]
  attendance?: RecordRow[]
  timetable?: RecordRow[]
  feeItems?: RecordRow[]
  payments?: RecordRow[]
  summary?: RecordRow
  messages?: RecordRow[]
  notifications?: RecordRow[]
}

const apiUrl = (import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? '' : 'http://localhost:5000')).replace(/\/$/, '')
const sectionLabels: Record<PortalSection, string> = {
  overview: 'Overview',
  results: 'Results & report cards',
  attendance: 'Attendance',
  timetable: 'Timetable',
  fees: 'Fees & receipts',
  messages: 'Messages',
  notifications: 'Notifications',
}

async function apiRequest<T extends ApiEnvelope>(path: string, token?: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl + path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  const result = await response.json().catch(() => null) as T | null
  if (!response.ok || !result?.success) {
    throw new ApiError(result?.message ?? `Request failed (${response.status})`, response.status)
  }
  return result
}

function formatLabel(value: string): string {
  return value.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase())
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'object') return '—'
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-RW', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
  }
  return String(value)
}

function RecordTable({ rows, emptyText }: { rows: RecordRow[]; emptyText: string }) {
  const columns = useMemo(() => {
    const preferred = [
      'assessmentDate', 'subjectName', 'assessmentTitle', 'score', 'maxScore', 'termAverage',
      'attendanceDate', 'status', 'dayOfWeek', 'startsAt', 'endsAt', 'room', 'teacherName',
      'feeName', 'amountDue', 'amountPaid', 'receiptNumber', 'amount', 'paymentMethod', 'paidAt',
      'subject', 'title', 'body', 'senderName', 'createdAt', 'readAt',
    ]
    const all = [...new Set(rows.flatMap((row) => Object.keys(row)))]
      .filter((key) => !['id', 'studentId', 'assessmentId', 'termId'].includes(key))
    return [...preferred.filter((key) => all.includes(key)), ...all.filter((key) => !preferred.includes(key))]
      .slice(0, 8)
  }, [rows])

  if (!rows.length) return <div className="portal-empty"><span className="portal-empty-icon">✓</span><strong>Nothing to show yet</strong><p>{emptyText}</p></div>

  return <div className="portal-table-wrap"><table className="portal-table">
    <thead><tr>{columns.map((column) => <th key={column}>{formatLabel(column)}</th>)}</tr></thead>
    <tbody>{rows.map((row, index) => <tr key={String(row.id ?? row.receiptNumber ?? row.assessmentId ?? index)}>
      {columns.map((column) => <td key={column}>{formatValue(row[column])}</td>)}
    </tr>)}</tbody>
  </table></div>
}

function SummaryCards({ values }: { values: Array<{ label: string; value: string; detail?: string }> }) {
  return <div className="portal-summary-grid">{values.map((item) => <article className="portal-summary-card" key={item.label}>
    <span>{item.label}</span><strong>{item.value}</strong>{item.detail && <small>{item.detail}</small>}
  </article>)}</div>
}

export default function PortalApp() {
  const [token, setToken] = useState(() => readSchoolToken())
  const [user, setUser] = useState<PortalUser | null>(null)
  const [authChecking, setAuthChecking] = useState(Boolean(readSchoolToken()))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  const [section, setSection] = useState<PortalSection>(() => {
    const segment = window.location.pathname.split('/').filter(Boolean).pop()
    return segment && Object.hasOwn(sectionLabels, segment) ? segment as PortalSection : 'overview'
  })
  const [children, setChildren] = useState<RecordRow[]>([])
  const [selectedChildId, setSelectedChildId] = useState('')
  const [data, setData] = useState<ApiEnvelope | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const handleRouteChange = () => {
      const segment = window.location.pathname.split('/').filter(Boolean).pop()
      setSection(segment && Object.hasOwn(sectionLabels, segment) ? segment as PortalSection : 'overview')
    }
    window.addEventListener('popstate', handleRouteChange)
    return () => window.removeEventListener('popstate', handleRouteChange)
  }, [])

  const signOut = useCallback(() => {
    clearSchoolSession()
    setToken(null)
    setUser(null)
    setChildren([])
    setSelectedChildId('')
    setData(null)
    setAuthError('')
    setError('')
    setSection('overview')
    window.history.replaceState({}, '', '/portal')
  }, [])

  const routeForRole = useCallback((role: Role) => {
    if (role === 'STUDENT') return '/portal/student'
    if (role === 'PARENT') return '/portal/parent'
    return '/portal'
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const callbackError = getGoogleCallbackError()
    if (!code && !callbackError) return
    cleanGoogleCallbackUrl()
    if (!code) {
      setAuthError(callbackError ?? 'Google sign-in was cancelled.')
      setAuthChecking(false)
      return
    }
    setGoogleBusy(true)
    finishGoogleSignIn(code)
      .then((result) => {
        if (!['STUDENT', 'PARENT'].includes(result.user.role)) {
          throw new Error('This portal is for student and parent accounts. Use the administration portal for school staff.')
        }
        persistSchoolToken(result.token)
        setToken(result.token)
        setUser(result.user)
        window.history.replaceState({}, '', routeForRole(result.user.role))
      })
      .catch((reason: unknown) => setAuthError(reason instanceof Error ? reason.message : 'Unable to finish Google sign-in'))
      .finally(() => {
        setGoogleBusy(false)
        setAuthChecking(false)
      })
  }, [routeForRole])

  useEffect(() => {
    if (!token) {
      setAuthChecking(false)
      setUser(null)
      return
    }
    let active = true
    setAuthChecking(true)
    apiRequest<{ user: PortalUser }>('/api/auth/me', token)
      .then(({ user: currentUser }) => {
        if (!active) return
        if (!['STUDENT', 'PARENT'].includes(currentUser.role)) {
          signOut()
          setAuthError('This portal is available to student and parent accounts. School staff should use the administration portal.')
          return
        }
        setUser(currentUser)
        const desiredPath = routeForRole(currentUser.role)
        if (!window.location.pathname.startsWith(desiredPath)) window.history.replaceState({}, '', desiredPath)
      })
      .catch((reason: unknown) => {
        if (!active) return
        if (reason instanceof ApiError && reason.status === 401) {
          clearSchoolSession()
          setToken(null)
        }
        setUser(null)
        setAuthError(reason instanceof Error ? reason.message : 'Your session could not be verified')
      })
      .finally(() => { if (active) setAuthChecking(false) })
    return () => { active = false }
  }, [token, routeForRole, signOut])

  useEffect(() => {
    if (!token || user?.role !== 'PARENT') {
      setChildren([])
      setSelectedChildId('')
      return
    }
    let active = true
    apiRequest<{ children: RecordRow[] }>('/api/portal/parent/children', token)
      .then(({ children: linkedChildren }) => {
        if (!active) return
        setChildren(linkedChildren)
        setSelectedChildId((current) => linkedChildren.some((child) => String(child.studentId) === current)
          ? current
          : String(linkedChildren[0]?.studentId ?? ''))
      })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Unable to load linked students') })
    return () => { active = false }
  }, [token, user?.role])

  useEffect(() => {
    if (!token || !user || authChecking) return
    let active = true
    setLoading(true)
    setError('')
    const childBase = user.role === 'PARENT' && selectedChildId
      ? `/api/portal/parent/children/${encodeURIComponent(selectedChildId)}`
      : ''
    let path = ''
    if (section === 'overview') {
      path = user.role === 'PARENT' ? '/api/portal/parent/children' : '/api/portal/student/overview'
    } else if (section === 'messages' || section === 'notifications') {
      path = `/api/portal/${section}`
    } else if (user.role === 'PARENT') {
      path = childBase ? `${childBase}/${section}` : ''
    } else {
      path = `/api/portal/student/${section}`
    }

    if (!path) {
      setData(null)
      setLoading(false)
      return
    }

    apiRequest<ApiEnvelope>(path, token)
      .then((result) => { if (active) setData(result) })
      .catch((reason: unknown) => { if (active) { setData(null); setError(reason instanceof Error ? reason.message : 'Unable to load portal data') } })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [token, user, authChecking, section, selectedChildId, refreshKey])

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAuthBusy(true)
    setAuthError('')
    try {
      const result = await apiRequest<{ token: string; user?: PortalUser }>('/api/auth/login', undefined, {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password }),
      })
      if (!result.token) throw new Error('The server did not return a login token')
      const identity = result.user ?? (await apiRequest<{ user: PortalUser }>('/api/auth/me', result.token)).user
      if (!['STUDENT', 'PARENT'].includes(identity.role)) {
        throw new Error('This portal is for student and parent accounts. School staff should use the administration portal.')
      }
      persistSchoolToken(result.token)
      setPassword('')
      setToken(result.token)
      setUser(identity)
      window.history.replaceState({}, '', routeForRole(identity.role))
    } catch (reason) {
      setAuthError(reason instanceof Error ? reason.message : 'Unable to sign in')
    } finally {
      setAuthBusy(false)
    }
  }

  async function handleGoogleLogin() {
    setAuthError('')
    setGoogleBusy(true)
    try {
      await startGoogleSignIn()
    } catch (reason) {
      setAuthError(reason instanceof Error ? reason.message : 'Unable to start Google sign-in')
      setGoogleBusy(false)
    }
  }

  async function markRead(id: unknown) {
    if (!token || !id) return
    try {
      await apiRequest('/api/portal/notifications/' + encodeURIComponent(String(id)) + '/read', token, { method: 'PATCH' })
      setRefreshKey((value) => value + 1)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update notification')
    }
  }

  function navigate(next: PortalSection) {
    setSection(next)
    const path = user?.role === 'PARENT' ? '/portal/parent' : '/portal/student'
    window.history.pushState({}, '', next === 'overview' ? path : path + '/' + next)
    setError('')
  }

  const requestedPortalRole = window.location.pathname.startsWith('/portal/parent') ? 'PARENT' : window.location.pathname.startsWith('/portal/student') ? 'STUDENT' : null

  if (authChecking) return <main className="portal-loading"><div className="portal-spinner" /><p>Checking your secure school session…</p></main>

  if (!token || !user) return <main className="portal-auth-shell">
    <section className="portal-auth-card">
      <a className="portal-brand" href="/"><span className="portal-brand-mark">M</span><span><strong>MURAMA</strong><small>DIGITAL SCHOOL</small></span></a>
      <div className="portal-auth-intro"><span className="portal-eyebrow">{requestedPortalRole === 'PARENT' ? 'PARENT & GUARDIAN PORTAL' : requestedPortalRole === 'STUDENT' ? 'STUDENT LEARNING PORTAL' : 'STUDENT & FAMILY SERVICES'}</span><h1>{requestedPortalRole === 'PARENT' ? 'Stay close to your child’s school journey.' : requestedPortalRole === 'STUDENT' ? 'Your learning, in one place.' : 'Your school, connected.'}</h1><p>{requestedPortalRole === 'PARENT' ? 'Follow linked children’s results, attendance, timetables, fee balances and official school messages.' : requestedPortalRole === 'STUDENT' ? 'Check your published results, attendance, class timetable, fees and messages from the school.' : 'Access school progress, attendance, timetables, fees and official messages in one secure place.'}</p></div>
      {authError && <p className="portal-alert" role="alert">{authError}</p>}
      <form className="portal-login-form" onSubmit={handleLogin}>
        <label>Email address<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="you@example.com" /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={1} placeholder="Enter your password" /></label>
        <button type="submit" disabled={authBusy}>{authBusy ? 'Signing in…' : 'Sign in securely'}</button>
      </form>
      <div className="portal-auth-divider"><span>or</span></div>
      <button className="portal-google-button" type="button" onClick={() => void handleGoogleLogin()} disabled={googleBusy}>{googleBusy ? 'Connecting to Google…' : 'Continue with Google'}</button>
      <p className="portal-auth-note">Access is limited to active school student and parent accounts. If you need an account, contact the school administration.</p>
      <a className="portal-back-link" href="/">← Back to school website</a>
    </section>
  </main>

  const isParent = user.role === 'PARENT'
  const selectedChild = children.find((child) => String(child.studentId) === selectedChildId)
  const student = data?.student
  const overviewRows = student ? Object.entries(student).filter(([key, value]) => !['studentId', 'id'].includes(key) && value !== null && value !== '') : []
  const currentRows = section === 'results' ? data?.results ?? []
    : section === 'attendance' ? data?.attendance ?? []
    : section === 'timetable' ? data?.timetable ?? []
    : section === 'messages' ? data?.messages ?? []
    : section === 'notifications' ? data?.notifications ?? []
    : []

  return <div className="portal-app">
    <aside className="portal-sidebar">
      <a className="portal-brand" href="/"><span className="portal-brand-mark">M</span><span><strong>MURAMA</strong><small>DIGITAL SCHOOL</small></span></a>
      <div className="portal-side-label">YOUR SCHOOL</div>
      <nav className="portal-nav" aria-label="School portal navigation">
        {(Object.keys(sectionLabels) as PortalSection[]).map((item) => <button type="button" key={item} className={section === item ? 'is-active' : ''} onClick={() => navigate(item)}>
          <span className="portal-nav-symbol">{({ overview: '⌂', results: '▤', attendance: '✓', timetable: '◷', fees: '¤', messages: '✉', notifications: '♢' } as Record<PortalSection, string>)[item]}</span><span>{sectionLabels[item]}</span>
        </button>)}
      </nav>
      <div className="portal-sidebar-bottom"><div className="portal-user-avatar">{user.firstName.slice(0, 1)}{user.lastName.slice(0, 1)}</div><div className="portal-user-copy"><strong>{user.firstName} {user.lastName}</strong><small>{isParent ? 'Parent account' : 'Student account'}</small></div><button className="portal-signout" type="button" onClick={signOut} aria-label="Sign out" title="Sign out">↗</button></div>
    </aside>

    <main className="portal-main">
      <header className="portal-topbar"><div><span className="portal-topbar-kicker">ÉCOLE SECONDAIRE DE MURAMA</span><h1>{sectionLabels[section]}</h1></div><div className="portal-topbar-actions">{isParent && <label className="portal-child-select">Student <select value={selectedChildId} onChange={(event) => setSelectedChildId(event.target.value)}><option value="">Select linked student</option>{children.map((child) => <option key={String(child.studentId)} value={String(child.studentId)}>{formatValue(child.firstName)} {formatValue(child.lastName)}</option>)}</select></label>}<span className="portal-secure-badge"><span />Secure portal</span></div></header>
      <section className="portal-content">
        {error && <div className="portal-alert" role="alert"><span>{error}</span><button type="button" onClick={() => setRefreshKey((value) => value + 1)}>Retry</button></div>}
        <div className="portal-page-heading"><div><span className="portal-eyebrow">{isParent ? 'PARENT & GUARDIAN ACCESS' : 'STUDENT SELF-SERVICE'}</span><h2>{section === 'overview' ? (isParent ? 'Your linked students' : `Welcome back, ${user.firstName}`) : sectionLabels[section]}</h2><p>{section === 'overview' ? 'School information and academic records, retrieved securely from the school system.' : 'This information is loaded from your authorised school records.'}</p></div><button className="portal-refresh" type="button" disabled={loading} onClick={() => setRefreshKey((value) => value + 1)}>{loading ? 'Loading…' : '↻ Refresh'}</button></div>

        {loading && <div className="portal-loading-panel"><div className="portal-spinner" /><span>Loading your school records…</span></div>}

        {!loading && section === 'overview' && isParent && <div className="portal-children-grid">
          {children.map((child) => <button className={'portal-child-card ' + (String(child.studentId) === selectedChildId ? 'is-selected' : '')} type="button" key={String(child.studentId)} onClick={() => setSelectedChildId(String(child.studentId))}>
            <span className="portal-child-avatar">{String(child.firstName ?? 'S').slice(0, 1)}{String(child.lastName ?? '').slice(0, 1)}</span><span className="portal-child-info"><strong>{formatValue(child.firstName)} {formatValue(child.lastName)}</strong><small>Admission: {formatValue(child.admissionNumber)}</small><small>{formatValue(child.className)}{child.streamName ? ' · ' + formatValue(child.streamName) : ''}</small></span><span className="portal-child-arrow">→</span>
          </button>)}
          {!children.length && <div className="portal-empty"><strong>No linked student accounts</strong><p>The school must verify and link your parent account to a student before records appear here.</p></div>}
        </div>}

        {!loading && section === 'overview' && !isParent && student && <>
          <SummaryCards values={[
            { label: 'Admission number', value: formatValue(student.admissionNumber) },
            { label: 'Class', value: formatValue(student.className), detail: student.streamName ? 'Stream ' + formatValue(student.streamName) : 'Current enrollment' },
            { label: 'Academic year', value: formatValue(student.academicYear), detail: formatValue(student.termName) },
            { label: 'Account status', value: formatValue(student.status), detail: 'School record status' },
          ]} />
          <section className="portal-panel"><div className="portal-panel-heading"><div><h3>Student profile</h3><p>Details maintained by school administration</p></div></div><dl className="portal-profile-grid">{overviewRows.map(([key, value]) => <div key={key}><dt>{formatLabel(key)}</dt><dd>{formatValue(value)}</dd></div>)}</dl></section>
        </>}

        {!loading && section === 'overview' && isParent && selectedChild && <section className="portal-panel portal-selected-child"><div className="portal-panel-heading"><div><h3>{formatValue(selectedChild.firstName)} {formatValue(selectedChild.lastName)}</h3><p>Selected student · {formatValue(selectedChild.relationship)}</p></div><span className="portal-child-status">{formatValue(selectedChild.status)}</span></div><SummaryCards values={[{ label: 'Admission number', value: formatValue(selectedChild.admissionNumber) }, { label: 'Class', value: formatValue(selectedChild.className) }, { label: 'Stream', value: formatValue(selectedChild.streamName) }, { label: 'Academic year', value: formatValue(selectedChild.academicYear) }]} /><div className="portal-shortcuts">{(['results', 'attendance', 'timetable', 'fees'] as PortalSection[]).map((item) => <button type="button" key={item} onClick={() => navigate(item)}>{sectionLabels[item]} <span>→</span></button>)}</div></section>}

        {!loading && section === 'results' && <section className="portal-panel"><div className="portal-panel-heading"><div><h3>Published assessment results</h3><p>Only results included in a generated report card are shown.</p></div></div><RecordTable rows={currentRows} emptyText="Published assessment results will appear here after the school generates a report card." /></section>}
        {!loading && section === 'attendance' && <section className="portal-panel"><div className="portal-panel-heading"><div><h3>Attendance record</h3><p>Recent attendance entries recorded by the school.</p></div></div>{data?.summary && <SummaryCards values={[{ label: 'Recorded days', value: formatValue(data.summary.total) }, { label: 'Present', value: formatValue(data.summary.present) }, { label: 'Absent', value: formatValue(data.summary.absent) }, { label: 'Late', value: formatValue(data.summary.late) }]} />}<RecordTable rows={currentRows} emptyText="Attendance will appear when the school records the first register." /></section>}
        {!loading && section === 'timetable' && <section className="portal-panel"><div className="portal-panel-heading"><div><h3>Class timetable</h3><p>Lessons for your current active enrollment.</p></div></div><RecordTable rows={currentRows} emptyText="The school has not published timetable entries for your current enrollment." /></section>}
        {!loading && section === 'fees' && <section className="portal-panel"><div className="portal-panel-heading"><div><h3>Fees and payment receipts</h3><p>Balances and payment records maintained by school administration.</p></div></div>{data?.summary && <SummaryCards values={[{ label: 'Total due', value: formatValue(data.summary.totalDue) }, { label: 'Total paid', value: formatValue(data.summary.totalPaid) }, { label: 'Outstanding', value: formatValue(data.summary.outstanding) }]} />}<h4 className="portal-subheading">Fee items</h4><RecordTable rows={data?.feeItems ?? []} emptyText="No fee items are assigned to this student." /><h4 className="portal-subheading">Payment receipts</h4><RecordTable rows={data?.payments ?? []} emptyText="No recorded payments are available." /></section>}
        {!loading && section === 'messages' && <section className="portal-panel"><div className="portal-panel-heading"><div><h3>School messages</h3><p>Messages addressed to your school account.</p></div></div><RecordTable rows={currentRows} emptyText="No messages have been sent to this account." /></section>}
        {!loading && section === 'notifications' && <section className="portal-panel"><div className="portal-panel-heading"><div><h3>Notifications</h3><p>School-system updates for your account.</p></div></div>{!currentRows.length ? <div className="portal-empty"><strong>You are all caught up</strong><p>New account notifications will appear here.</p></div> : <div className="portal-notification-list">{currentRows.map((item) => <article className={'portal-notification ' + (item.readAt ? 'is-read' : 'is-unread')} key={String(item.id)}><span className="portal-notification-dot" /><div><strong>{formatValue(item.title)}</strong><p>{formatValue(item.body)}</p><small>{formatValue(item.createdAt)}</small></div>{!item.readAt && <button type="button" onClick={() => void markRead(item.id)}>Mark read</button>}</article>)}</div>}</section>}

        {!loading && !error && section === 'overview' && isParent && !selectedChild && children.length > 0 && <div className="portal-inline-note">Choose a linked student above to see their academic and school records.</div>}
        <footer className="portal-footer"><span>Murama Digital School</span><span>Your records are protected by school account permissions.</span><a href="/">School website</a></footer>
      </section>
    </main>
  </div>
}
