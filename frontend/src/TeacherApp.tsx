import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { finishGoogleSignIn, getGoogleCallbackError, startGoogleSignIn, cleanGoogleCallbackUrl } from './lib/supabase-auth'
import './portal.css'
import './teacher.css'

type TeacherSection = 'overview' | 'classes' | 'timetable' | 'assessments' | 'attendance' | 'messages' | 'notifications'
type ApiRecord = Record<string, unknown>
interface TeacherUser {
  id: number
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  role: string
}
interface Assignment {
  classId: number
  className: string
  subjectId: number
  subjectCode: string
  subjectName: string
  academicYearId: number
  academicYear: string
  studentCount: number
}
interface Term {
  id: number
  name: string
  startsOn: string
  endsOn: string
  sequenceNo: number
  academicYearId: number
  academicYear: string
}
interface Assessment {
  id: number
  title: string
  assessmentType: string
  assessmentDate: string
  maxScore: number
  classId: number
  className: string
  subjectId: number
  subjectName: string
  termId: number
  termName: string
  markedCount: number
}
interface StudentRecord {
  studentId: number
  admissionNumber: string
  firstName: string
  lastName: string
  streamName?: string | null
  score?: number | string | null
  remarks?: string | null
  studentStatus?: string
}
interface ApiResult {
  success?: boolean
  message?: string
  token?: string
  assessmentId?: number
  user?: TeacherUser
  teacher?: ApiRecord
  summary?: ApiRecord
  upcoming?: ApiRecord[]
  assignments?: Assignment[]
  terms?: Term[]
  assessments?: Assessment[]
  timetable?: ApiRecord[]
  students?: StudentRecord[]
  assessment?: Assessment
  savedCount?: number
  messages?: ApiRecord[]
  notifications?: ApiRecord[]
}
const tokenKey = 'murama-teacher-token'
const sectionLabels: Record<TeacherSection, string> = {
  overview: 'Overview',
  classes: 'My classes',
  timetable: 'Timetable',
  assessments: 'Assessments & marks',
  attendance: 'Attendance register',
  messages: 'School messages',
  notifications: 'Notifications',
}
const apiUrl = (import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? '' : 'http://localhost:5000')).replace(/\/$/, '')
const assessmentTypes = ['TEST', 'QUIZ', 'ASSIGNMENT', 'MIDTERM', 'FINAL', 'PRACTICAL', 'OTHER']
const attendanceStatuses = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']

function localDate(): string {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'object') return '—'
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-RW', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
  }
  return String(value)
}
function label(value: string): string {
  return value.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase())
}
async function request<T extends ApiResult>(path: string, token?: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl + path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  const result = await response.json().catch(() => null) as T | null
  if (!response.ok || !result?.success) throw new Error(result?.message ?? `Request failed (${response.status})`)
  return result
}
function TeacherTable({ rows, emptyText }: { rows: ApiRecord[]; emptyText: string }) {
  const columns = useMemo(() => {
    const preferred = ['dayOfWeek', 'startsAt', 'endsAt', 'className', 'subjectName', 'room', 'termName', 'assessmentDate', 'assessmentType', 'title', 'maxScore', 'markedCount', 'admissionNumber', 'firstName', 'lastName', 'streamName', 'score', 'status']
    const all = [...new Set(rows.flatMap((row) => Object.keys(row)))].filter((key) => !['id', 'teacherId', 'userId', 'classId', 'subjectId', 'termId', 'academicYearId'].includes(key))
    return [...preferred.filter((key) => all.includes(key)), ...all.filter((key) => !preferred.includes(key))].slice(0, 8)
  }, [rows])
  if (!rows.length) return <div className="portal-empty"><strong>No records yet</strong><p>{emptyText}</p></div>
  return <div className="portal-table-wrap"><table className="portal-table"><thead><tr>{columns.map((key) => <th key={key}>{label(key)}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id ?? row.studentId ?? index)}>{columns.map((key) => <td key={key}>{displayValue(row[key])}</td>)}</tr>)}</tbody></table></div>
}

export default function TeacherApp() {
  const [token, setToken] = useState(() => sessionStorage.getItem(tokenKey))
  const [user, setUser] = useState<TeacherUser | null>(null)
  const [authChecking, setAuthChecking] = useState(Boolean(sessionStorage.getItem(tokenKey)))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [busy, setBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  const [section, setSection] = useState<TeacherSection>(() => {
    const segment = window.location.pathname.split('/').filter(Boolean).pop()
    return segment && Object.hasOwn(sectionLabels, segment) ? segment as TeacherSection : 'overview'
  })
  const [teacher, setTeacher] = useState<ApiRecord | null>(null)
  const [summary, setSummary] = useState<ApiRecord>({})
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [terms, setTerms] = useState<Term[]>([])
  const [assessments, setAssessments] = useState<Assessment[]>([])
  const [timetable, setTimetable] = useState<ApiRecord[]>([])
  const [upcoming, setUpcoming] = useState<ApiRecord[]>([])
  const [students, setStudents] = useState<StudentRecord[]>([])
  const [messages, setMessages] = useState<ApiRecord[]>([])
  const [notifications, setNotifications] = useState<ApiRecord[]>([])
  const [selectedClassId, setSelectedClassId] = useState('')
  const [selectedAssessmentId, setSelectedAssessmentId] = useState('')
  const [selectedTermId, setSelectedTermId] = useState('')
  const [assessmentStudents, setAssessmentStudents] = useState<StudentRecord[]>([])
  const [assessmentDetail, setAssessmentDetail] = useState<Assessment | null>(null)
  const [scores, setScores] = useState<Record<number, string>>({})
  const [remarks, setRemarks] = useState<Record<number, string>>({})
  const [attendanceDate, setAttendanceDate] = useState(localDate())
  const [attendanceValues, setAttendanceValues] = useState<Record<number, string>>({})
  const [attendanceNotes, setAttendanceNotes] = useState<Record<number, string>>({})
  const [newAssessment, setNewAssessment] = useState({ title: '', classId: '', subjectId: '', termId: '', assessmentType: 'TEST', assessmentDate: localDate(), maxScore: '100' })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  const signOut = useCallback(() => {
    sessionStorage.removeItem(tokenKey)
    setToken(null)
    setUser(null)
    setTeacher(null)
    setError('')
    setNotice('')
    window.history.replaceState({}, '', '/teacher')
  }, [])

  const redirectForRole = useCallback((role: string) => {
    if (role === 'TEACHER') return '/teacher'
    return '/admin'
  }, [])

  useEffect(() => {
    const handleRouteChange = () => {
      const segment = window.location.pathname.split('/').filter(Boolean).pop()
      setSection(segment && Object.hasOwn(sectionLabels, segment) ? segment as TeacherSection : 'overview')
    }
    window.addEventListener('popstate', handleRouteChange)
    return () => window.removeEventListener('popstate', handleRouteChange)
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const callbackError = getGoogleCallbackError()
    if (!code && !callbackError) return
    cleanGoogleCallbackUrl()
    if (!code) {
      setAuthError(callbackError ?? 'Google sign-in was cancelled')
      setAuthChecking(false)
      return
    }
    setGoogleBusy(true)
    finishGoogleSignIn(code)
      .then((result) => {
        if (result.user.role !== 'TEACHER') throw new Error('This workspace is for teacher accounts. Use the portal assigned to your school role.')
        sessionStorage.setItem(tokenKey, result.token)
        setToken(result.token)
        setUser(result.user)
        window.history.replaceState({}, '', redirectForRole(result.user.role))
      })
      .catch((reason: unknown) => setAuthError(reason instanceof Error ? reason.message : 'Unable to finish Google sign-in'))
      .finally(() => { setGoogleBusy(false); setAuthChecking(false) })
  }, [redirectForRole])

  useEffect(() => {
    if (!token) { setAuthChecking(false); setUser(null); return }
    let active = true
    setAuthChecking(true)
    request<{ user: TeacherUser }>('/api/auth/me', token)
      .then(({ user: current }) => {
        if (!active) return
        if (current.role !== 'TEACHER') {
          signOut()
          setAuthError('This workspace is available to teacher accounts only.')
          return
        }
        setUser(current)
        if (!window.location.pathname.startsWith('/teacher')) window.history.replaceState({}, '', '/teacher')
      })
      .catch((reason: unknown) => {
        if (!active) return
        sessionStorage.removeItem(tokenKey)
        setToken(null)
        setUser(null)
        setAuthError(reason instanceof Error ? reason.message : 'Your session could not be verified')
      })
      .finally(() => { if (active) setAuthChecking(false) })
    return () => { active = false }
  }, [token, redirectForRole, signOut])

  useEffect(() => {
    if (!token || !user || authChecking) return
    let active = true
    setLoading(true)
    setError('')
    Promise.all([
      request<{ teacher: ApiRecord; summary: ApiRecord; upcoming: ApiRecord[] }>('/api/teacher/overview', token),
      request<{ assignments: Assignment[] }>('/api/teacher/classes', token),
      request<{ terms: Term[] }>('/api/teacher/terms', token),
      request<{ assessments: Assessment[] }>('/api/teacher/assessments', token),
      request<{ timetable: ApiRecord[] }>('/api/teacher/timetable', token),
    ]).then(([overview, classes, termResult, assessmentResult, timetableResult]) => {
      if (!active) return
      setTeacher(overview.teacher)
      setSummary(overview.summary ?? {})
      setUpcoming(overview.upcoming ?? [])
      setAssignments(classes.assignments ?? [])
      setTerms(termResult.terms ?? [])
      setAssessments(assessmentResult.assessments ?? [])
      setTimetable(timetableResult.timetable ?? [])
      setSelectedClassId((current) => current || String(classes.assignments?.[0]?.classId ?? ''))
      setSelectedTermId((current) => current || String(termResult.terms?.[0]?.id ?? ''))
      setNewAssessment((current) => ({
        ...current,
        classId: current.classId || String(classes.assignments?.[0]?.classId ?? ''),
        subjectId: current.subjectId || String(classes.assignments?.[0]?.subjectId ?? ''),
        termId: current.termId || String(termResult.terms?.[0]?.id ?? ''),
      }))
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Unable to load teacher workspace')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [token, user, authChecking, refreshKey])

  useEffect(() => {
    if (!token || !user || authChecking || (section !== 'classes' && section !== 'attendance')) return
    if (!selectedClassId) { setStudents([]); return }
    let active = true
    request<{ students: StudentRecord[] }>(`/api/teacher/classes/${encodeURIComponent(selectedClassId)}/students`, token)
      .then(({ students: result }) => {
        if (!active) return
        setStudents(result)
        setAttendanceValues((current) => {
          const next = { ...current }
          for (const student of result) if (!next[student.studentId]) next[student.studentId] = 'PRESENT'
          return next
        })
      })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Unable to load class roster') })
    return () => { active = false }
  }, [token, user, authChecking, section, selectedClassId, refreshKey])

  useEffect(() => {
    if (!token || !user || authChecking || section !== 'assessments' || !selectedAssessmentId) {
      setAssessmentStudents([])
      setAssessmentDetail(null)
      return
    }
    let active = true
    request<{ students: StudentRecord[]; assessment: Assessment }>(`/api/teacher/assessments/${encodeURIComponent(selectedAssessmentId)}/results`, token)
      .then((result) => {
        if (!active) return
        setAssessmentStudents(result.students)
        setAssessmentDetail(result.assessment)
        setScores(Object.fromEntries(result.students.map((student) => [student.studentId, student.score === null || student.score === undefined ? '' : String(student.score)])))
        setRemarks(Object.fromEntries(result.students.map((student) => [student.studentId, student.remarks ?? ''])))
      })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Unable to load assessment results') })
    return () => { active = false }
  }, [token, user, authChecking, section, selectedAssessmentId, refreshKey])

  useEffect(() => {
    if (!token || !user || authChecking || (section !== 'messages' && section !== 'notifications')) return
    let active = true
    const path = section === 'messages' ? '/api/portal/messages' : '/api/portal/notifications'
    request<ApiResult>(path, token)
      .then((result) => {
        if (!active) return
        if (section === 'messages') setMessages(result.messages ?? [])
        else setNotifications(result.notifications ?? [])
      })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Unable to load messages') })
    return () => { active = false }
  }, [token, user, authChecking, section, refreshKey])

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setAuthError('')
    try {
      const result = await request<{ token: string; user?: TeacherUser }>('/api/auth/login', undefined, { method: 'POST', body: JSON.stringify({ email: email.trim(), password }) })
      if (!result.token) throw new Error('The server did not return a login token')
      const identity = result.user ?? (await request<{ user: TeacherUser }>('/api/auth/me', result.token)).user
      if (identity.role !== 'TEACHER') throw new Error('This workspace is for teacher accounts only.')
      sessionStorage.setItem(tokenKey, result.token)
      setPassword('')
      setToken(result.token)
      setUser(identity)
      window.history.replaceState({}, '', '/teacher')
    } catch (reason) {
      setAuthError(reason instanceof Error ? reason.message : 'Unable to sign in')
    } finally { setBusy(false) }
  }

  async function handleGoogleLogin() {
    setAuthError('')
    setGoogleBusy(true)
    try { await startGoogleSignIn() }
    catch (reason) { setAuthError(reason instanceof Error ? reason.message : 'Unable to start Google sign-in'); setGoogleBusy(false) }
  }

  function navigate(next: TeacherSection) {
    setSection(next)
    window.history.pushState({}, '', next === 'overview' ? '/teacher' : '/teacher/' + next)
    setError('')
    setNotice('')
  }

  async function createAssessment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token) return
    setSaving(true); setError(''); setNotice('')
    try {
      const result = await request<{ assessmentId: number }>('/api/teacher/assessments', token, {
        method: 'POST',
        body: JSON.stringify({ ...newAssessment, classId: Number(newAssessment.classId), subjectId: Number(newAssessment.subjectId), termId: Number(newAssessment.termId), maxScore: Number(newAssessment.maxScore) }),
      })
      setNotice('Assessment created. You can now enter marks.')
      setSelectedAssessmentId(String(result.assessmentId))
      setSection('assessments')
      window.history.pushState({}, '', '/teacher/assessments')
      setRefreshKey((value) => value + 1)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to create assessment') }
    finally { setSaving(false) }
  }

  async function saveResults(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token || !selectedAssessmentId || !assessmentDetail) return
    const results = assessmentStudents.filter((student) => scores[student.studentId] !== undefined && scores[student.studentId].trim() !== '').map((student) => ({
      studentId: student.studentId,
      score: Number(scores[student.studentId]),
      remarks: remarks[student.studentId] ?? '',
    }))
    if (!results.length) { setError('Enter at least one mark before saving.'); return }
    setSaving(true); setError(''); setNotice('')
    try {
      const result = await request<{ savedCount: number }>(`/api/teacher/assessments/${selectedAssessmentId}/results`, token, { method: 'POST', body: JSON.stringify({ results }) })
      setNotice(`Saved marks for ${result.savedCount} student(s).`)
      setRefreshKey((value) => value + 1)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save marks') }
    finally { setSaving(false) }
  }

  async function saveAttendance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token || !selectedClassId || !selectedTermId || !students.length) {
      setError('Choose a class and term with an active student roster.')
      return
    }
    setSaving(true); setError(''); setNotice('')
    try {
      const result = await request<{ savedCount: number }>('/api/teacher/attendance', token, {
        method: 'POST',
        body: JSON.stringify({
          classId: Number(selectedClassId),
          termId: Number(selectedTermId),
          attendanceDate,
          records: students.map((student) => ({ studentId: student.studentId, status: attendanceValues[student.studentId] ?? 'PRESENT', note: attendanceNotes[student.studentId] ?? '' })),
        }),
      })
      setNotice(`Saved attendance for ${result.savedCount} student(s).`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save attendance') }
    finally { setSaving(false) }
  }

  async function markNotificationRead(id: unknown) {
    if (!token || !id) return
    try {
      await request('/api/portal/notifications/' + encodeURIComponent(String(id)) + '/read', token, { method: 'PATCH' })
      setRefreshKey((value) => value + 1)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to update notification') }
  }

  if (authChecking) return <main className="portal-loading"><div className="portal-spinner" /><p>Checking your secure teacher session…</p></main>
  if (!token || !user) return <main className="portal-auth-shell"><section className="portal-auth-card">
    <a className="portal-brand" href="/"><span className="portal-brand-mark">M</span><span><strong>MURAMA</strong><small>DIGITAL SCHOOL</small></span></a>
    <div className="portal-auth-intro"><span className="portal-eyebrow">TEACHER WORKSPACE</span><h1>Teach. Track. Support.</h1><p>Manage your assigned classes, record attendance, create assessments and submit marks securely.</p></div>
    {authError && <p className="portal-alert" role="alert">{authError}</p>}
    <form className="portal-login-form" onSubmit={handleLogin}><label>Email address<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="teacher@example.com" /></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label><button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in securely'}</button></form>
    <div className="portal-auth-divider"><span>or</span></div><button className="portal-google-button" type="button" onClick={() => void handleGoogleLogin()} disabled={googleBusy}>{googleBusy ? 'Connecting to Google…' : 'Continue with Google'}</button>
    <p className="portal-auth-note">Access is limited to active teacher accounts linked to school teaching assignments.</p><a className="portal-back-link" href="/">← Back to school website</a>
  </section></main>

  const displayName = user.firstName + ' ' + user.lastName
  const classAssignments = assignments.filter((item) => item.classId === Number(selectedClassId))
  const availableSubjects = assignments.filter((item) => item.classId === Number(newAssessment.classId))
  const selectedAssignment = assignments.find((item) => item.classId === Number(selectedClassId))
  const rosterRows = students.map((student) => ({ ...student, fullName: student.firstName + ' ' + student.lastName })) as unknown as ApiRecord[]
  const teacherAssessmentRows = assessments.map((assessment) => ({ ...assessment, markedCount: assessment.markedCount + ' marked' } as unknown as ApiRecord))

  return <div className="portal-app">
    <aside className="portal-sidebar"><a className="portal-brand" href="/"><span className="portal-brand-mark">M</span><span><strong>MURAMA</strong><small>DIGITAL SCHOOL</small></span></a>
      <div className="portal-side-label">TEACHING</div><nav className="portal-nav" aria-label="Teacher navigation">
        {(Object.keys(sectionLabels) as TeacherSection[]).map((item) => <button type="button" key={item} className={section === item ? 'is-active' : ''} onClick={() => navigate(item)}><span className="portal-nav-symbol">{({ overview: '⌂', classes: '▦', timetable: '◷', assessments: '▤', attendance: '✓', messages: '✉', notifications: '♢' } as Record<TeacherSection, string>)[item]}</span><span>{sectionLabels[item]}</span></button>)}
      </nav>
      <div className="portal-sidebar-bottom"><div className="portal-user-avatar">{user.firstName.slice(0, 1)}{user.lastName.slice(0, 1)}</div><div className="portal-user-copy"><strong>{displayName}</strong><small>Teacher account</small></div><button className="portal-signout" type="button" onClick={signOut} aria-label="Sign out">↗</button></div>
    </aside>
    <main className="portal-main"><header className="portal-topbar"><div><span className="portal-topbar-kicker">ÉCOLE SECONDAIRE DE MURAMA</span><h1>{sectionLabels[section]}</h1></div><div className="portal-topbar-actions"><span className="portal-secure-badge"><span />Teacher workspace</span><button className="portal-refresh" type="button" disabled={loading} onClick={() => setRefreshKey((value) => value + 1)}>{loading ? 'Loading…' : '↻ Refresh'}</button></div></header>
      <section className="portal-content">
        {error && <div className="portal-alert" role="alert"><span>{error}</span><button type="button" onClick={() => setRefreshKey((value) => value + 1)}>Retry</button></div>}
        {notice && <p className="teacher-notice" role="status">{notice}</p>}
        <div className="portal-page-heading"><div><span className="portal-eyebrow">TEACHER SELF-SERVICE</span><h2>{section === 'overview' ? 'Welcome back, ' + user.firstName : sectionLabels[section]}</h2><p>Only classes, subjects and students linked to your teaching assignments are available here.</p></div></div>
        {loading && <div className="portal-loading-panel"><div className="portal-spinner" /><span>Loading your teaching records…</span></div>}

        {!loading && section === 'overview' && <><div className="portal-summary-grid"><article className="portal-summary-card"><span>Assigned classes</span><strong>{displayValue(summary.assignedClasses ?? 0)}</strong><small>Current academic year</small></article><article className="portal-summary-card"><span>Assigned subjects</span><strong>{displayValue(summary.assignedSubjects ?? 0)}</strong><small>Based on school assignments</small></article><article className="portal-summary-card"><span>Assessments</span><strong>{assessments.length}</strong><small>Current academic year</small></article><article className="portal-summary-card"><span>Teacher ID</span><strong>{displayValue(teacher?.employeeNumber)}</strong><small>{displayValue(teacher?.department)}</small></article></div><section className="portal-panel"><div className="portal-panel-heading"><div><h3>Upcoming timetable</h3><p>Your next scheduled lessons</p></div><button className="portal-refresh" type="button" onClick={() => navigate('timetable')}>View timetable →</button></div><TeacherTable rows={upcoming} emptyText="No timetable entries are assigned to you for the current academic year." /></section></>}

        {!loading && section === 'classes' && <section className="portal-panel"><div className="portal-panel-heading"><div><h3>Your assigned classes and subjects</h3><p>Student lists are restricted to your active teaching assignments.</p></div></div><div className="teacher-class-grid">{assignments.map((assignment) => <button type="button" key={assignment.classId + '-' + assignment.subjectId} className={'teacher-class-card ' + (selectedClassId === String(assignment.classId) ? 'is-selected' : '')} onClick={() => setSelectedClassId(String(assignment.classId))}><span className="teacher-class-mark">{assignment.className.slice(0, 1)}</span><span className="teacher-class-copy"><strong>{assignment.className}</strong><small>{assignment.subjectCode} · {assignment.subjectName}</small><small>{assignment.studentCount} active student(s)</small></span><span>→</span></button>)}</div><div className="teacher-roster-heading"><div><h3>Class roster</h3><p>Current academic year · {selectedAssignment?.className ?? 'Select an assigned class'}</p></div><select value={selectedClassId} onChange={(event) => setSelectedClassId(event.target.value)} aria-label="Choose class">{assignments.filter((item,index,all)=>all.findIndex(x=>x.classId===item.classId)===index).map((item) => <option key={item.classId} value={item.classId}>{item.className}</option>)}</select></div><TeacherTable rows={rosterRows} emptyText="No active students are enrolled in this assigned class." /></section>}

        {!loading && section === 'timetable' && <section className="portal-panel"><div className="portal-panel-heading"><div><h3>My teaching timetable</h3><p>Lessons linked to your teacher record in the current academic year.</p></div></div><TeacherTable rows={timetable} emptyText="The school has not assigned timetable entries to your teacher account." /></section>}

        {!loading && section === 'assessments' && <><section className="portal-panel"><div className="portal-panel-heading"><div><h3>Create an assessment</h3><p>Only your assigned class/subject combinations are accepted by the server.</p></div></div><form className="teacher-form-grid" onSubmit={createAssessment}><label>Assessment title<input value={newAssessment.title} onChange={(event) => setNewAssessment((current) => ({ ...current, title: event.target.value }))} maxLength={150} required placeholder="e.g. Term 2 Mathematics Test" /></label><label>Class<select value={newAssessment.classId} onChange={(event) => { const classId = event.target.value; const assignment = assignments.find((item) => item.classId === Number(classId)); setNewAssessment((current) => ({ ...current, classId, subjectId: String(assignment?.subjectId ?? '') })) }} required><option value="">Choose class</option>{assignments.filter((item,index,all)=>all.findIndex(x=>x.classId===item.classId)===index).map((item) => <option key={item.classId} value={item.classId}>{item.className}</option>)}</select></label><label>Subject<select value={newAssessment.subjectId} onChange={(event) => setNewAssessment((current) => ({ ...current, subjectId: event.target.value }))} required><option value="">Choose subject</option>{availableSubjects.map((item) => <option key={item.subjectId} value={item.subjectId}>{item.subjectCode} · {item.subjectName}</option>)}</select></label><label>Term<select value={newAssessment.termId} onChange={(event) => setNewAssessment((current) => ({ ...current, termId: event.target.value }))} required><option value="">Choose term</option>{terms.map((term) => <option key={term.id} value={term.id}>{term.name}</option>)}</select></label><label>Assessment type<select value={newAssessment.assessmentType} onChange={(event) => setNewAssessment((current) => ({ ...current, assessmentType: event.target.value }))}>{assessmentTypes.map((type) => <option key={type} value={type}>{label(type)}</option>)}</select></label><label>Assessment date<input type="date" value={newAssessment.assessmentDate} onChange={(event) => setNewAssessment((current) => ({ ...current, assessmentDate: event.target.value }))} required /></label><label>Maximum score<input type="number" min="1" max="1000" step="0.25" value={newAssessment.maxScore} onChange={(event) => setNewAssessment((current) => ({ ...current, maxScore: event.target.value }))} required /></label><button className="teacher-primary-button" type="submit" disabled={saving || !assignments.length || !terms.length}>{saving ? 'Creating…' : 'Create assessment'}</button></form></section><section className="portal-panel"><div className="portal-panel-heading"><div><h3>Assessments and marks</h3><p>Choose an assessment to enter or update student results.</p></div></div><div className="teacher-assessment-select"><label>Select assessment<select value={selectedAssessmentId} onChange={(event) => setSelectedAssessmentId(event.target.value)}><option value="">Choose assessment</option>{assessments.map((item) => <option key={item.id} value={item.id}>{item.className} · {item.subjectName} · {item.title}</option>)}</select></label></div><TeacherTable rows={teacherAssessmentRows} emptyText="Create your first assessment for an assigned class and subject." />{selectedAssessmentId && assessmentDetail && <form className="teacher-marks-form" onSubmit={saveResults}><div className="teacher-roster-heading"><div><h3>{assessmentDetail.title}</h3><p>{assessmentDetail.className} · {assessmentDetail.subjectName} · Maximum {assessmentDetail.maxScore}</p></div><button className="teacher-primary-button" type="submit" disabled={saving}>{saving ? 'Saving marks…' : 'Save marks'}</button></div><div className="teacher-marks-list">{assessmentStudents.map((student) => <div className="teacher-mark-row" key={student.studentId}><div className="teacher-mark-student"><strong>{student.firstName} {student.lastName}</strong><small>{student.admissionNumber}</small></div><label>Score<input type="number" min="0" max={assessmentDetail.maxScore} step="0.25" value={scores[student.studentId] ?? ''} onChange={(event) => setScores((current) => ({ ...current, [student.studentId]: event.target.value }))} placeholder="Not marked" /></label><label>Teacher comment<input value={remarks[student.studentId] ?? ''} onChange={(event) => setRemarks((current) => ({ ...current, [student.studentId]: event.target.value }))} maxLength={255} placeholder="Optional feedback" /></label></div>)}</div></form>}</section></>}

        {!loading && section === 'attendance' && <section className="portal-panel"><div className="portal-panel-heading"><div><h3>Take attendance</h3><p>Only students actively enrolled in your assigned class can be marked.</p></div></div><div className="teacher-attendance-controls"><label>Class<select value={selectedClassId} onChange={(event) => setSelectedClassId(event.target.value)} required><option value="">Choose class</option>{assignments.filter((item,index,all)=>all.findIndex(x=>x.classId===item.classId)===index).map((item) => <option key={item.classId} value={item.classId}>{item.className}</option>)}</select></label><label>Term<select value={selectedTermId} onChange={(event) => setSelectedTermId(event.target.value)} required><option value="">Choose term</option>{terms.map((term) => <option key={term.id} value={term.id}>{term.name}</option>)}</select></label><label>Date<input type="date" value={attendanceDate} onChange={(event) => setAttendanceDate(event.target.value)} required /></label></div><form onSubmit={saveAttendance}><div className="teacher-attendance-list">{students.map((student) => <div className="teacher-attendance-row" key={student.studentId}><div><strong>{student.firstName} {student.lastName}</strong><small>{student.admissionNumber}{student.streamName ? ' · ' + student.streamName : ''}</small></div><label>Status<select value={attendanceValues[student.studentId] ?? 'PRESENT'} onChange={(event) => setAttendanceValues((current) => ({ ...current, [student.studentId]: event.target.value }))}>{attendanceStatuses.map((status) => <option key={status} value={status}>{label(status)}</option>)}</select></label><label>Note<input value={attendanceNotes[student.studentId] ?? ''} onChange={(event) => setAttendanceNotes((current) => ({ ...current, [student.studentId]: event.target.value }))} maxLength={255} placeholder="Optional note" /></label></div>)}</div><button className="teacher-primary-button" type="submit" disabled={saving || !students.length || !selectedTermId}>{saving ? 'Saving attendance…' : 'Save attendance register'}</button></form>{!students.length && <div className="portal-empty"><strong>No student roster loaded</strong><p>Choose one of your assigned classes that has active student enrollments.</p></div>}</section>}

        {!loading && section === 'messages' && <section className="portal-panel"><div className="portal-panel-heading"><div><h3>School messages</h3><p>Messages addressed to your teacher account.</p></div></div><TeacherTable rows={messages} emptyText="No messages have been sent to this account." /></section>}
        {!loading && section === 'notifications' && <section className="portal-panel"><div className="portal-panel-heading"><div><h3>Notifications</h3><p>School-system updates for your account.</p></div></div>{!notifications.length ? <div className="portal-empty"><strong>You are all caught up</strong><p>New account notifications will appear here.</p></div> : <div className="portal-notification-list">{notifications.map((item) => <article className={'portal-notification ' + (item.readAt ? 'is-read' : 'is-unread')} key={String(item.id)}><span className="portal-notification-dot" /><div><strong>{displayValue(item.title)}</strong><p>{displayValue(item.body)}</p><small>{displayValue(item.createdAt)}</small></div>{!item.readAt && <button type="button" onClick={() => void markNotificationRead(item.id)}>Mark read</button>}</article>)}</div>}</section>}
        <footer className="portal-footer"><span>Murama Digital School · Teacher workspace</span><span>Student access is restricted by your teaching assignments.</span><a href="/">School website</a></footer>
      </section>
    </main>
  </div>
}
