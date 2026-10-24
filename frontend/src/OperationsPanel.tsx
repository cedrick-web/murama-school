import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react'
import './operations.css'

type Tab = 'attendance' | 'gradebook' | 'timetable' | 'finance' | 'messages'
type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED'
type AssessmentType = 'TEST' | 'QUIZ' | 'ASSIGNMENT' | 'MIDTERM' | 'FINAL' | 'PRACTICAL' | 'OTHER'
type PaymentMethod = 'CASH' | 'BANK' | 'MOBILE_MONEY' | 'CARD' | 'OTHER'
type Role = 'ADMIN' | 'HEADTEACHER' | 'TEACHER' | 'STUDENT' | 'PARENT' | 'STAFF'

interface ApiBase { success?: boolean; message?: string }
interface Year { id: number; name: string; isCurrent: boolean | number }
interface Term { id: number; academicYearId: number; academicYearName: string; name: string; sequenceNo: number }
interface SchoolClass { id: number; name: string; streamCount?: number }
interface Stream { id: number; classId: number; className: string; name: string }
interface Subject { id: number; code: string; name: string }
interface Teacher { id: number; employeeNumber: string | null; firstName: string; lastName: string }
interface Student { id: number; admissionNumber: string; firstName: string; lastName: string; status: string; className: string | null; enrollmentStatus: string | null }
interface Options { classes: SchoolClass[]; streams: Stream[]; subjects: Subject[]; years: Year[]; terms: Term[]; teachers: Teacher[] }
interface AttendanceRow { studentId: number; admissionNumber: string; firstName: string; lastName: string; attendanceId: number | null; attendanceStatus: AttendanceStatus | null; note: string | null }
interface Assessment { id: number; termId: number; termName: string; academicYearId: number; academicYearName: string; classId: number; className: string; subjectId: number; subjectCode: string; subjectName: string; title: string; assessmentType: AssessmentType; maxScore: number | string; assessmentDate: string; markedCount: number }
interface MarkRow { studentId: number; admissionNumber: string; firstName: string; lastName: string; score: number | string | null; remarks: string | null }
interface ReportCard { studentId: number; admissionNumber: string; firstName: string; lastName: string; averageScore: number | string | null; classPosition: number | null; attendancePercentage: number | string | null; generatedAt: string | null }
interface TimetableEntry { id: number; classId: number; className: string; streamId: number | null; streamName: string | null; subjectCode: string; subjectName: string; teacherName: string | null; dayOfWeek: number; startsAt: string; endsAt: string; room: string | null; academicYearName: string; termName: string | null }
interface FeeStructure { id: number; academicYearId: number; academicYearName: string; classId: number | null; className: string | null; name: string; amount: number | string; dueDate: string | null; description: string | null; assignedCount: number }
interface FeeItem { id: number; studentId: number; admissionNumber: string; firstName: string; lastName: string; feeStructureId: number; feeName: string; academicYearName: string; amountDue: number | string; amountPaid: number | string; status: string; balance: number | string }
interface Payment { id: number; receiptNumber: string; admissionNumber: string; firstName: string; lastName: string; amount: number | string; paymentMethod: PaymentMethod; reference: string | null; paidAt: string }
interface MessageRecord { id: number; subject: string; body: string; sentAt: string; senderName: string; recipientCount: number; readCount: number | null }
interface Recipient { userId: number; firstName: string; lastName: string; email: string | null; role: Role; readAt: string | null }

const apiUrl = (import.meta.env.VITE_API_URL ?? 'http://localhost:5000').replace(/\/+$/, '')
async function api<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl + path, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), Authorization: 'Bearer ' + token, ...options.headers },
  })
  const body = await response.json().catch(() => null) as (ApiBase & Record<string, unknown>) | null
  if (!response.ok || !body || body.success !== true) throw new Error(body?.message ?? ('Request failed (' + response.status + ')'))
  return body as T
}
function enabled(value: boolean | number): boolean { return value === true || value === 1 }
function todayLocal(): string {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
function shortDate(value: string | null | undefined): string {
  if (!value) return 'Not recorded'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value.slice(0, 10) : new Intl.DateTimeFormat('en-RW', { dateStyle: 'medium' }).format(d)
}
function fmtAmount(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const n = Number(value)
  return Number.isFinite(n) ? new Intl.NumberFormat('en-RW', { maximumFractionDigits: 2 }).format(n) + ' RWF' : '—'
}
function fmtNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const n = Number(value)
  return Number.isFinite(n) ? n.toLocaleString('en-RW', { maximumFractionDigits: 2 }) : '—'
}
function messageOf(reason: unknown): string { return reason instanceof Error ? reason.message : 'The operation could not be completed.' }

function useOptions(token: string) {
  const [options, setOptions] = useState<Options | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setOptions(await api<Options>('/api/admin/operations/timetable/options', token)) }
    catch (reason) { setError(messageOf(reason)) }
    finally { setLoading(false) }
  }, [token])
  useEffect(() => { void load() }, [load])
  return { options, error, loading, reload: load }
}
function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="operations-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}
function State({ loading, error, empty, retry }: { loading?: boolean; error?: string; empty?: string; retry?: () => void }) {
  if (loading) return <div className="operations-state"><span className="operations-spinner" />Loading live school records…</div>
  if (error) return <div className="operations-state is-error" role="alert"><strong>The request failed.</strong><span>{error}</span>{retry && <button type="button" className="operations-button secondary" onClick={retry}>Retry</button>}</div>
  if (empty) return <div className="operations-state"><span className="operations-empty-icon">—</span><span>{empty}</span></div>
  return null
}

export default function OperationsPanel({ token }: { token: string }) {
  const [tab, setTab] = useState<Tab>('attendance')
  const tabs: Array<{ id: Tab; title: string; sub: string; number: string }> = [
    { id: 'attendance', title: 'Attendance', sub: 'Daily registers', number: '01' },
    { id: 'gradebook', title: 'Gradebook', sub: 'Assessments & reports', number: '02' },
    { id: 'timetable', title: 'Timetable', sub: 'Periods & teacher slots', number: '03' },
    { id: 'finance', title: 'Fees & payments', sub: 'Balances & receipts', number: '04' },
    { id: 'messages', title: 'Messaging', sub: 'School communication', number: '05' },
  ]
  return <div className="operations-workspace">
    <section className="operations-banner"><div><span className="operations-eyebrow">LIVE SCHOOL OPERATIONS</span><h2>Run the school day.</h2><p>Record attendance, manage assessments, build the timetable, follow fee balances and send official messages using the existing MySQL-backed API.</p></div><span className="operations-live-pill"><i /> Connected workflows</span></section>
    <div className="operations-layout">
      <nav className="operations-tabs" aria-label="Operational modules">
        {tabs.map((item) => <button key={item.id} type="button" className={'operations-tab' + (tab === item.id ? ' is-active' : '')} aria-current={tab === item.id ? 'page' : undefined} onClick={() => setTab(item.id)}><span className="operations-tab-number">{item.number}</span><span><strong>{item.title}</strong><small>{item.sub}</small></span><span className="operations-tab-arrow">→</span></button>)}
        <p className="operations-safety-note">Saved changes are written to the school database. The backend validates records and permissions; unavailable data is never replaced with sample values.</p>
      </nav>
      <section className="operations-content">
        <header className="operations-content-heading"><div><span className="operations-eyebrow">SCHOOL MANAGEMENT</span><h3>{tabs.find((item) => item.id === tab)?.title}</h3><p>{tabs.find((item) => item.id === tab)?.sub}</p></div><span className="operations-secure-label">Administrator only</span></header>
        {tab === 'attendance' && <AttendanceModule token={token} />}
        {tab === 'gradebook' && <GradebookModule token={token} />}
        {tab === 'timetable' && <TimetableModule token={token} />}
        {tab === 'finance' && <FinanceModule token={token} />}
        {tab === 'messages' && <MessagesModule token={token} />}
      </section>
    </div>
  </div>
}

function AttendanceModule({ token }: { token: string }) {
  const { options, error: optionsError, loading: optionsLoading, reload } = useOptions(token)
  const [classId, setClassId] = useState('')
  const [termId, setTermId] = useState('')
  const [date, setDate] = useState(todayLocal)
  const [records, setRecords] = useState<AttendanceRow[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    if (!options) return
    if (!classId && options.classes[0]) setClassId(String(options.classes[0].id))
    if (!termId) {
      const year = options.years.find((item) => enabled(item.isCurrent))
      const term = options.terms.find((item) => item.academicYearId === year?.id) ?? options.terms[0]
      if (term) setTermId(String(term.id))
    }
  }, [options, classId, termId])
  const load = useCallback(async () => {
    if (!classId || !termId || !date) { setRecords([]); return }
    setLoading(true); setError('')
    try {
      const result = await api<{ records: AttendanceRow[] }>('/api/admin/operations/attendance?classId=' + classId + '&termId=' + termId + '&date=' + date, token)
      setRecords(result.records.map((row) => ({ ...row, attendanceStatus: row.attendanceStatus ?? null, note: row.note ?? '' })))
    } catch (reason) { setError(messageOf(reason)) } finally { setLoading(false) }
  }, [token, classId, termId, date])
  useEffect(() => { void load() }, [load])
  const marked = records.filter((row) => row.attendanceStatus !== null).length
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const markedRows = records.filter((row) => row.attendanceStatus !== null)
    if (!markedRows.length) { setError('Mark at least one student before saving the register.'); return }
    setSaving(true); setError(''); setNotice('')
    try {
      const result = await api<ApiBase & { saved: number }>('/api/admin/operations/attendance', token, { method: 'POST', body: JSON.stringify({ classId: Number(classId), termId: Number(termId), date, records: markedRows.map((row) => ({ studentId: row.studentId, status: row.attendanceStatus, note: row.note ?? '' })) }) })
      setNotice(String(result.saved) + ' attendance records saved.')
      await load()
    } catch (reason) { setError(messageOf(reason)) } finally { setSaving(false) }
  }
  return <div className="operations-module">
    {optionsLoading && <State loading />}
    {optionsError && <State error={optionsError} retry={() => void reload()} />}
    {options && <>
      <div className="operations-filters"><Field label="Class"><select value={classId} onChange={(e) => setClassId(e.target.value)}><option value="">Choose class</option>{options.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><Field label="Academic term"><select value={termId} onChange={(e) => setTermId(e.target.value)}><option value="">Choose term</option>{options.terms.map((term) => <option key={term.id} value={term.id}>{term.academicYearName} · {term.name}</option>)}</select></Field><Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field></div>
      <div className="operations-summary-row"><div><span>Date</span><strong>{shortDate(date)}</strong></div><div><span>Eligible students</span><strong>{records.length}</strong></div><div><span>Marked records</span><strong>{marked} / {records.length}</strong></div></div>
      {error && <p className="operations-inline-error" role="alert">{error}</p>}{notice && <p className="operations-inline-success" role="status">{notice}</p>}
      {loading && <State loading />}
      {!loading && !error && records.length === 0 && <State empty="No eligible student enrollments were returned for this class and term." />}
      {!loading && records.length > 0 && <form onSubmit={save}><div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>Student</th><th>Admission no.</th><th>Attendance</th><th>Note</th></tr></thead><tbody>{records.map((row) => <tr key={row.studentId}><td><strong>{row.firstName} {row.lastName}</strong></td><td>{row.admissionNumber}</td><td><select aria-label={'Attendance for ' + row.firstName + ' ' + row.lastName} value={row.attendanceStatus ?? ''} onChange={(e) => setRecords((current) => current.map((item) => item.studentId === row.studentId ? { ...item, attendanceStatus: e.target.value ? e.target.value as AttendanceStatus : null } : item))}><option value="">Not marked</option><option value="PRESENT">Present</option><option value="ABSENT">Absent</option><option value="LATE">Late</option><option value="EXCUSED">Excused</option></select></td><td><input maxLength={255} aria-label={'Note for ' + row.firstName + ' ' + row.lastName} placeholder="Optional note" value={row.note ?? ''} onChange={(e) => setRecords((current) => current.map((item) => item.studentId === row.studentId ? { ...item, note: e.target.value } : item))} /></td></tr>)}</tbody></table></div><div className="operations-form-footer"><span>Only marked students are submitted. Unmarked students remain unrecorded.</span><button className="operations-button primary" disabled={saving}>{saving ? 'Saving…' : 'Save attendance'}</button></div></form>}
    </>}
  </div>
}

function GradebookModule({ token }: { token: string }) {
  const { options, error: optionsError, loading: optionsLoading, reload } = useOptions(token)
  const [assessments, setAssessments] = useState<Assessment[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [marks, setMarks] = useState<MarkRow[]>([])
  const [termId, setTermId] = useState('')
  const [classId, setClassId] = useState('')
  const [view, setView] = useState<'marks' | 'reports'>('marks')
  const [reports, setReports] = useState<ReportCard[]>([])
  const [form, setForm] = useState({ termId: '', classId: '', subjectId: '', title: '', assessmentType: 'TEST' as AssessmentType, maxScore: '100', assessmentDate: todayLocal })
  const [loading, setLoading] = useState(false)
  const [marksLoading, setMarksLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    if (!options) return
    const currentYear = options.years.find((year) => enabled(year.isCurrent))
    const currentTerm = options.terms.find((term) => term.academicYearId === currentYear?.id) ?? options.terms[0]
    setForm((old) => ({ ...old, termId: old.termId || String(currentTerm?.id ?? ''), classId: old.classId || String(options.classes[0]?.id ?? ''), subjectId: old.subjectId || String(options.subjects[0]?.id ?? '') }))
    if (!termId && currentTerm) setTermId(String(currentTerm.id))
    if (!classId && options.classes[0]) setClassId(String(options.classes[0].id))
  }, [options, termId, classId])
  const loadAssessments = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const params = new URLSearchParams()
      if (termId) params.set('termId', termId)
      if (classId) params.set('classId', classId)
      const result = await api<{ assessments: Assessment[] }>('/api/admin/operations/assessments' + (params.size ? '?' + params.toString() : ''), token)
      setAssessments(result.assessments)
      if (selectedId && !result.assessments.some((a) => String(a.id) === selectedId)) { setSelectedId(''); setMarks([]) }
    } catch (reason) { setError(messageOf(reason)) } finally { setLoading(false) }
  }, [token, termId, classId, selectedId])
  useEffect(() => { if (options) void loadAssessments() }, [options, loadAssessments])
  const loadMarks = useCallback(async () => {
    if (!selectedId) { setMarks([]); return }
    setMarksLoading(true); setError('')
    try {
      const result = await api<{ records: MarkRow[] }>('/api/admin/operations/assessments/' + selectedId + '/results', token)
      setMarks(result.records.map((row) => ({ ...row, score: row.score ?? '', remarks: row.remarks ?? '' })))
    } catch (reason) { setError(messageOf(reason)) } finally { setMarksLoading(false) }
  }, [token, selectedId])
  useEffect(() => { void loadMarks() }, [loadMarks])
  async function createAssessment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('')
    try {
      const result = await api<ApiBase & { assessmentId: number }>('/api/admin/operations/assessments', token, { method: 'POST', body: JSON.stringify({ ...form, termId: Number(form.termId), classId: Number(form.classId), subjectId: Number(form.subjectId), maxScore: Number(form.maxScore) }) })
      setNotice('Assessment created. Enter student results below.')
      setSelectedId(String(result.assessmentId))
      await loadAssessments()
    } catch (reason) { setError(messageOf(reason)) } finally { setSaving(false) }
  }
  async function saveMarks(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('')
    try {
      const result = await api<ApiBase & { saved: number }>('/api/admin/operations/assessments/' + selectedId + '/results', token, { method: 'POST', body: JSON.stringify({ records: marks.map((row) => ({ studentId: row.studentId, score: row.score === '' || row.score === null ? null : Number(row.score), remarks: row.remarks ?? '' })) }) })
      setNotice(String(result.saved) + ' student mark records processed.')
      await loadMarks(); await loadAssessments()
    } catch (reason) { setError(messageOf(reason)) } finally { setSaving(false) }
  }
  async function loadReports() {
    if (!termId || !classId) { setError('Choose a term and class first.'); return }
    setMarksLoading(true); setError('')
    try { const result = await api<{ reportCards: ReportCard[] }>('/api/admin/operations/report-cards?termId=' + termId + '&classId=' + classId, token); setReports(result.reportCards) }
    catch (reason) { setError(messageOf(reason)) } finally { setMarksLoading(false) }
  }
  async function generateReports() {
    if (!termId || !classId) { setError('Choose a term and class first.'); return }
    setGenerating(true); setError(''); setNotice('')
    try {
      const result = await api<ApiBase & { reportCards: ReportCard[] }>('/api/admin/operations/report-cards/generate', token, { method: 'POST', body: JSON.stringify({ termId: Number(termId), classId: Number(classId) }) })
      setReports(result.reportCards); setNotice(result.message ?? 'Report cards generated from recorded marks and attendance.')
    } catch (reason) { setError(messageOf(reason)) } finally { setGenerating(false) }
  }
  return <div className="operations-module">
    {optionsLoading && <State loading />}{optionsError && <State error={optionsError} retry={() => void reload()} />}
    {options && <>
      <div className="operations-view-switch"><button type="button" className={view === 'marks' ? 'is-active' : ''} onClick={() => setView('marks')}>Assessments & marks</button><button type="button" className={view === 'reports' ? 'is-active' : ''} onClick={() => { setView('reports'); void loadReports() }}>Report cards</button></div>
      {error && <p className="operations-inline-error" role="alert">{error}</p>}{notice && <p className="operations-inline-success" role="status">{notice}</p>}
      {view === 'marks' ? <>
        <form className="operations-form-grid" onSubmit={createAssessment}><div className="operations-form-heading"><div><h4>Create assessment</h4><p>Assessment scales and results are saved in the database.</p></div></div>
          <Field label="Term"><select required value={form.termId} onChange={(e) => setForm({ ...form, termId: e.target.value })}><option value="">Choose term</option>{options.terms.map((t) => <option key={t.id} value={t.id}>{t.academicYearName} · {t.name}</option>)}</select></Field>
          <Field label="Class"><select required value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}><option value="">Choose class</option>{options.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Subject"><select required value={form.subjectId} onChange={(e) => setForm({ ...form, subjectId: e.target.value })}><option value="">Choose subject</option>{options.subjects.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></Field>
          <Field label="Assessment title"><input required maxLength={150} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Mathematics test" /></Field>
          <Field label="Type"><select value={form.assessmentType} onChange={(e) => setForm({ ...form, assessmentType: e.target.value as AssessmentType })}>{(['TEST','QUIZ','ASSIGNMENT','MIDTERM','FINAL','PRACTICAL','OTHER'] as AssessmentType[]).map((type) => <option key={type}>{type}</option>)}</select></Field>
          <Field label="Maximum score"><input type="number" required min="0.01" max="1000000" step="0.01" value={form.maxScore} onChange={(e) => setForm({ ...form, maxScore: e.target.value })} /></Field>
          <Field label="Assessment date"><input type="date" required value={form.assessmentDate} onChange={(e) => setForm({ ...form, assessmentDate: e.target.value })} /></Field>
          <div className="operations-form-actions"><button className="operations-button primary" disabled={saving}>{saving ? 'Creating…' : 'Create assessment'}</button></div>
        </form>
        <section className="operations-section"><div className="operations-section-heading"><div><h4>Assessment register</h4><p>Choose an assessment to enter, update or remove marks.</p></div><button type="button" className="operations-button secondary" disabled={loading} onClick={() => void loadAssessments()}>Refresh</button></div>
          <div className="operations-filters compact"><Field label="Filter by term"><select value={termId} onChange={(e) => setTermId(e.target.value)}><option value="">All terms</option>{options.terms.map((t) => <option key={t.id} value={t.id}>{t.academicYearName} · {t.name}</option>)}</select></Field><Field label="Filter by class"><select value={classId} onChange={(e) => setClassId(e.target.value)}><option value="">All classes</option>{options.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field></div>
          <State loading={loading} error={!loading ? error : ''} empty={!loading && !error && assessments.length === 0 ? 'No assessments match these filters yet.' : undefined} />
          {assessments.length > 0 && <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>Assessment</th><th>Class / term</th><th>Max score</th><th>Date</th><th>Marks</th><th>Action</th></tr></thead><tbody>{assessments.map((a) => <tr key={a.id}><td><strong>{a.title}</strong><small>{a.subjectCode} · {a.subjectName}</small></td><td>{a.className}<small>{a.academicYearName} · {a.termName}</small></td><td>{fmtNumber(a.maxScore)}</td><td>{shortDate(a.assessmentDate)}</td><td>{a.markedCount}</td><td><button type="button" className="operations-button tiny" onClick={() => setSelectedId(String(a.id))}>{selectedId === String(a.id) ? 'Selected' : 'Enter marks'}</button></td></tr>)}</tbody></table></div>}
        </section>
        {selectedId && <section className="operations-section"><div className="operations-section-heading"><div><h4>Student marks</h4><p>Blank scores remove a saved result. The server enforces assessment maximum scores and current enrollment.</p></div><span className="operations-secure-label">Assessment #{selectedId}</span></div>
          <State loading={marksLoading} error={!marksLoading ? error : ''} empty={!marksLoading && !error && marks.length === 0 ? 'No active enrolled students were returned for this assessment.' : undefined} retry={() => void loadMarks()} />
          {!marksLoading && marks.length > 0 && <form onSubmit={saveMarks}><div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>Student</th><th>Admission no.</th><th>Score</th><th>Remarks</th></tr></thead><tbody>{marks.map((row) => <tr key={row.studentId}><td><strong>{row.firstName} {row.lastName}</strong></td><td>{row.admissionNumber}</td><td><input className="operations-score-input" type="number" min="0" step="0.01" max={Number(assessments.find((a) => String(a.id) === selectedId)?.maxScore ?? 1000000)} value={row.score ?? ''} aria-label={'Score for ' + row.firstName + ' ' + row.lastName} onChange={(e) => setMarks((current) => current.map((m) => m.studentId === row.studentId ? { ...m, score: e.target.value } : m))} /></td><td><input maxLength={255} value={row.remarks ?? ''} placeholder="Optional remarks" aria-label={'Remarks for ' + row.firstName + ' ' + row.lastName} onChange={(e) => setMarks((current) => current.map((m) => m.studentId === row.studentId ? { ...m, remarks: e.target.value } : m))} /></td></tr>)}</tbody></table></div><div className="operations-form-footer"><span>Scores are saved against the selected assessment.</span><button className="operations-button primary" disabled={saving}>{saving ? 'Saving marks…' : 'Save marks'}</button></div></form>}
        </section>}
      </> : <>
        <div className="operations-filters"><Field label="Term"><select value={termId} onChange={(e) => { setTermId(e.target.value); setReports([]) }}><option value="">Choose term</option>{options.terms.map((t) => <option key={t.id} value={t.id}>{t.academicYearName} · {t.name}</option>)}</select></Field><Field label="Class"><select value={classId} onChange={(e) => { setClassId(e.target.value); setReports([]) }}><option value="">Choose class</option>{options.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><div className="operations-filter-actions"><button type="button" className="operations-button secondary" disabled={marksLoading} onClick={() => void loadReports()}>Load reports</button><button type="button" className="operations-button primary" disabled={generating} onClick={() => void generateReports()}>{generating ? 'Generating…' : 'Generate reports'}</button></div></div>
        <p className="operations-hint">Average scores and attendance percentages come only from saved assessment results and attendance records.</p><State loading={marksLoading} error={!marksLoading ? error : ''} empty={!marksLoading && !error && reports.length === 0 ? 'No report cards loaded. Choose a term and class, then load or generate them.' : undefined} retry={() => void loadReports()} />
        {reports.length > 0 && <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>Student</th><th>Admission no.</th><th>Average</th><th>Position</th><th>Attendance</th><th>Generated</th></tr></thead><tbody>{reports.map((r) => <tr key={r.studentId}><td><strong>{r.firstName} {r.lastName}</strong></td><td>{r.admissionNumber}</td><td>{r.averageScore === null ? 'No recorded marks' : fmtNumber(r.averageScore) + '%'}</td><td>{r.classPosition ?? '—'}</td><td>{r.attendancePercentage === null ? 'Not recorded' : fmtNumber(r.attendancePercentage) + '%'}</td><td>{shortDate(r.generatedAt)}</td></tr>)}</tbody></table></div>}
      </>}
    </>}
  </div>
}

const weekdays = [{ id: 1, label: 'Monday' }, { id: 2, label: 'Tuesday' }, { id: 3, label: 'Wednesday' }, { id: 4, label: 'Thursday' }, { id: 5, label: 'Friday' }, { id: 6, label: 'Saturday' }, { id: 7, label: 'Sunday' }]
function TimetableModule({ token }: { token: string }) {
  const { options, error: optionsError, loading: optionsLoading, reload } = useOptions(token)
  const [entries, setEntries] = useState<TimetableEntry[]>([])
  const [yearFilter, setYearFilter] = useState('')
  const [classFilter, setClassFilter] = useState('')
  const [termFilter, setTermFilter] = useState('')
  const [form, setForm] = useState({ classId: '', streamId: '', subjectId: '', teacherId: '', dayOfWeek: '1', startsAt: '08:00', endsAt: '09:00', room: '', academicYearId: '', termId: '' })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    if (!options) return
    const year = options.years.find((item) => enabled(item.isCurrent)) ?? options.years[0]
    setForm((old) => ({ ...old, classId: old.classId || String(options.classes[0]?.id ?? ''), subjectId: old.subjectId || String(options.subjects[0]?.id ?? ''), academicYearId: old.academicYearId || String(year?.id ?? ''), termId: old.termId || String(options.terms[0]?.id ?? '') }))
    if (!yearFilter && year) setYearFilter(String(year.id))
  }, [options, yearFilter])
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const params = new URLSearchParams()
      if (yearFilter) params.set('academicYearId', yearFilter)
      if (classFilter) params.set('classId', classFilter)
      if (termFilter) params.set('termId', termFilter)
      const result = await api<{ entries: TimetableEntry[] }>('/api/admin/operations/timetable' + (params.size ? '?' + params.toString() : ''), token)
      setEntries(result.entries)
    } catch (reason) { setError(messageOf(reason)) } finally { setLoading(false) }
  }, [token, yearFilter, classFilter, termFilter])
  useEffect(() => { void load() }, [load])
  async function createEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('')
    try {
      const result = await api<ApiBase & { id: number }>('/api/admin/operations/timetable', token, { method: 'POST', body: JSON.stringify({ ...form, classId: Number(form.classId), streamId: form.streamId ? Number(form.streamId) : null, subjectId: Number(form.subjectId), teacherId: form.teacherId ? Number(form.teacherId) : null, dayOfWeek: Number(form.dayOfWeek), academicYearId: Number(form.academicYearId), termId: form.termId ? Number(form.termId) : null }) })
      setNotice(result.message ?? 'Timetable entry created.')
      await load()
    } catch (reason) { setError(messageOf(reason)) } finally { setSaving(false) }
  }
  async function removeEntry(entry: TimetableEntry) {
    if (!window.confirm('Delete ' + entry.className + ' · ' + entry.subjectName + ' · ' + (weekdays.find((d) => d.id === entry.dayOfWeek)?.label ?? '') + '?')) return
    setRemoving(entry.id); setError(''); setNotice('')
    try { const result = await api<ApiBase>('/api/admin/operations/timetable/' + entry.id, token, { method: 'DELETE' }); setNotice(result.message ?? 'Timetable entry deleted.'); await load() }
    catch (reason) { setError(messageOf(reason)) } finally { setRemoving(null) }
  }
  const streams = options?.streams.filter((stream) => String(stream.classId) === form.classId) ?? []
  return <div className="operations-module">
    {optionsLoading && <State loading />}{optionsError && <State error={optionsError} retry={() => void reload()} />}
    {options && <>
      {error && <p className="operations-inline-error" role="alert">{error}</p>}{notice && <p className="operations-inline-success" role="status">{notice}</p>}
      <form className="operations-form-grid" onSubmit={createEntry}><div className="operations-form-heading"><div><h4>Add timetable period</h4><p>Overlapping class, stream or teacher assignments are rejected by the backend.</p></div></div>
        <Field label="Academic year"><select required value={form.academicYearId} onChange={(e) => setForm({ ...form, academicYearId: e.target.value })}><option value="">Choose year</option>{options.years.map((year) => <option key={year.id} value={year.id}>{year.name}</option>)}</select></Field>
        <Field label="Term (optional)"><select value={form.termId} onChange={(e) => setForm({ ...form, termId: e.target.value })}><option value="">Whole academic year</option>{options.terms.filter((t) => !form.academicYearId || String(t.academicYearId) === form.academicYearId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
        <Field label="Class"><select required value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value, streamId: '' })}><option value="">Choose class</option>{options.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Stream (optional)"><select value={form.streamId} onChange={(e) => setForm({ ...form, streamId: e.target.value })}><option value="">Whole class</option>{streams.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Subject"><select required value={form.subjectId} onChange={(e) => setForm({ ...form, subjectId: e.target.value })}><option value="">Choose subject</option>{options.subjects.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></Field>
        <Field label="Teacher (optional)"><select value={form.teacherId} onChange={(e) => setForm({ ...form, teacherId: e.target.value })}><option value="">Unassigned</option>{options.teachers.map((t) => <option key={t.id} value={t.id}>{t.firstName} {t.lastName}{t.employeeNumber ? ' · ' + t.employeeNumber : ''}</option>)}</select></Field>
        <Field label="Day"><select value={form.dayOfWeek} onChange={(e) => setForm({ ...form, dayOfWeek: e.target.value })}>{weekdays.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</select></Field>
        <Field label="Start time"><input type="time" required value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></Field>
        <Field label="End time"><input type="time" required value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} /></Field>
        <Field label="Room / venue"><input maxLength={100} value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} /></Field>
        <div className="operations-form-actions"><button className="operations-button primary" disabled={saving}>{saving ? 'Saving…' : 'Add timetable period'}</button></div>
      </form>
      <section className="operations-section"><div className="operations-section-heading"><div><h4>Timetable entries</h4><p>Real periods persisted in MySQL.</p></div><button className="operations-button secondary" type="button" disabled={loading} onClick={() => void load()}>Refresh</button></div>
        <div className="operations-filters compact"><Field label="Year"><select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}><option value="">All years</option>{options.years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}</select></Field><Field label="Class"><select value={classFilter} onChange={(e) => setClassFilter(e.target.value)}><option value="">All classes</option>{options.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><Field label="Term"><select value={termFilter} onChange={(e) => setTermFilter(e.target.value)}><option value="">All terms</option>{options.terms.map((t) => <option key={t.id} value={t.id}>{t.academicYearName} · {t.name}</option>)}</select></Field></div>
        <State loading={loading} error={!loading ? error : ''} empty={!loading && !error && !entries.length ? 'No timetable entries match these filters.' : undefined} retry={() => void load()} />
        {!loading && entries.length > 0 && <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>Day / time</th><th>Class</th><th>Subject</th><th>Teacher</th><th>Room</th><th>Action</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td><strong>{weekdays.find((d) => d.id === entry.dayOfWeek)?.label ?? 'Day unavailable'}</strong><small>{String(entry.startsAt).slice(0, 5)}–{String(entry.endsAt).slice(0, 5)}</small></td><td>{entry.className}{entry.streamName && <small>{entry.streamName}</small>}<small>{entry.academicYearName}{entry.termName ? ' · ' + entry.termName : ''}</small></td><td><strong>{entry.subjectName}</strong><small>{entry.subjectCode}</small></td><td>{entry.teacherName ?? 'Unassigned'}</td><td>{entry.room ?? '—'}</td><td><button type="button" className="operations-button danger tiny" disabled={removing === entry.id} onClick={() => void removeEntry(entry)}>{removing === entry.id ? 'Removing…' : 'Delete'}</button></td></tr>)}</tbody></table></div>}
      </section>
    </>}
  </div>
}

function FinanceModule({ token }: { token: string }) {
  const { options, error: optionsError, loading: optionsLoading, reload } = useOptions(token)
  const [students, setStudents] = useState<Student[]>([])
  const [structures, setStructures] = useState<FeeStructure[]>([])
  const [items, setItems] = useState<FeeItem[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [summary, setSummary] = useState<Record<string, number | string | null>>({})
  const [paymentSummary, setPaymentSummary] = useState<Record<string, number | string | null>>({})
  const [view, setView] = useState<'structures' | 'balances' | 'payments'>('structures')
  const [structureForm, setStructureForm] = useState({ academicYearId: '', classId: '', name: '', amount: '', dueDate: '', description: '' })
  const [structureId, setStructureId] = useState('')
  const [studentIds, setStudentIds] = useState<number[]>([])
  const [paymentForm, setPaymentForm] = useState({ studentId: '', amount: '', paymentMethod: 'CASH' as PaymentMethod, reference: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const load = useCallback(async () => {
    setLoading(true); setError('')
    const results = await Promise.allSettled([
      api<{ summary: Record<string, number | string | null>; payments: Record<string, number | string | null> }>('/api/admin/operations/fees/overview', token),
      api<{ structures: FeeStructure[] }>('/api/admin/operations/fees/structures', token),
      api<{ items: FeeItem[] }>('/api/admin/operations/fees/items', token),
      api<{ payments: Payment[] }>('/api/admin/operations/fees/payments', token),
      api<{ students: Student[] }>('/api/admin/people/students', token),
    ])
    const failures: string[] = []
    if (results[0].status === 'fulfilled') { setSummary(results[0].value.summary); setPaymentSummary(results[0].value.payments) } else failures.push('fee totals')
    if (results[1].status === 'fulfilled') setStructures(results[1].value.structures); else failures.push('fee structures')
    if (results[2].status === 'fulfilled') setItems(results[2].value.items); else failures.push('balances')
    if (results[3].status === 'fulfilled') setPayments(results[3].value.payments); else failures.push('receipts')
    if (results[4].status === 'fulfilled') setStudents(results[4].value.students.filter((s) => s.status === 'ACTIVE')); else failures.push('student roster')
    if (failures.length) setError('Some sources are unavailable: ' + failures.join(', ') + '. Retry before relying on totals.')
    setLoading(false)
  }, [token])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!options) return
    const year = options.years.find((y) => enabled(y.isCurrent)) ?? options.years[0]
    setStructureForm((old) => ({ ...old, academicYearId: old.academicYearId || String(year?.id ?? '') }))
  }, [options])
  async function createStructure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('')
    try {
      const result = await api<ApiBase>('/api/admin/operations/fees/structures', token, { method: 'POST', body: JSON.stringify({ ...structureForm, academicYearId: Number(structureForm.academicYearId), classId: structureForm.classId ? Number(structureForm.classId) : null, amount: Number(structureForm.amount), dueDate: structureForm.dueDate || null }) })
      setNotice(result.message ?? 'Fee structure created.')
      setStructureForm((old) => ({ ...old, name: '', amount: '', dueDate: '', description: '' }))
      await load()
    } catch (reason) { setError(messageOf(reason)) } finally { setSaving(false) }
  }
  async function assignFees(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!structureId || !studentIds.length) { setError('Choose a fee structure and at least one student.'); return }
    setSaving(true); setError(''); setNotice('')
    try {
      const result = await api<ApiBase & { assigned: number; skipped: number }>('/api/admin/operations/fees/assign', token, { method: 'POST', body: JSON.stringify({ feeStructureId: Number(structureId), studentIds }) })
      setNotice(String(result.assigned) + ' balances created; ' + String(result.skipped) + ' existing assignments skipped.')
      setStudentIds([]); await load()
    } catch (reason) { setError(messageOf(reason)) } finally { setSaving(false) }
  }
  async function recordPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('')
    try {
      const result = await api<ApiBase & { payment: { receiptNumber: string; amount: number } }>('/api/admin/operations/fees/payments', token, { method: 'POST', body: JSON.stringify({ ...paymentForm, studentId: Number(paymentForm.studentId), amount: Number(paymentForm.amount) }) })
      setNotice('Receipt ' + result.payment.receiptNumber + ' recorded for ' + fmtAmount(result.payment.amount) + '.')
      setPaymentForm({ studentId: '', amount: '', paymentMethod: 'CASH', reference: '' })
      setView('payments'); await load()
    } catch (reason) { setError(messageOf(reason)) } finally { setSaving(false) }
  }
  const remaining = items.filter((item) => Number(item.balance) > 0)
  return <div className="operations-module">
    {optionsLoading && <State loading />}{optionsError && <State error={optionsError} retry={() => void reload()} />}
    {options && <>
      {error && <p className="operations-inline-error" role="alert">{error}</p>}{notice && <p className="operations-inline-success" role="status">{notice}</p>}
      <section className="operations-finance-metrics"><div><span>Total assigned</span><strong>{fmtAmount(summary.totalDue)}</strong><small>{fmtNumber(summary.itemCount)} assigned items</small></div><div><span>Payments recorded</span><strong>{fmtAmount(summary.totalPaid)}</strong><small>{fmtNumber(paymentSummary.paymentCount)} receipts</small></div><div><span>Outstanding</span><strong>{fmtAmount(summary.outstanding)}</strong><small>{remaining.length} items with a balance</small></div></section>
      <div className="operations-view-switch"><button type="button" className={view === 'structures' ? 'is-active' : ''} onClick={() => setView('structures')}>Fee structures</button><button type="button" className={view === 'balances' ? 'is-active' : ''} onClick={() => setView('balances')}>Student balances</button><button type="button" className={view === 'payments' ? 'is-active' : ''} onClick={() => setView('payments')}>Payment receipts</button></div>
      {view === 'structures' && <>
        <form className="operations-form-grid" onSubmit={createStructure}><div className="operations-form-heading"><div><h4>Create fee structure</h4><p>Creation defines a fee. It only creates student balances after assignment.</p></div></div>
          <Field label="Academic year"><select required value={structureForm.academicYearId} onChange={(e) => setStructureForm({ ...structureForm, academicYearId: e.target.value })}><option value="">Choose year</option>{options.years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}</select></Field>
          <Field label="Class (optional)"><select value={structureForm.classId} onChange={(e) => setStructureForm({ ...structureForm, classId: e.target.value })}><option value="">All classes</option>{options.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Fee name"><input required maxLength={150} value={structureForm.name} onChange={(e) => setStructureForm({ ...structureForm, name: e.target.value })} /></Field>
          <Field label="Amount (RWF)"><input required type="number" min="0.01" step="0.01" value={structureForm.amount} onChange={(e) => setStructureForm({ ...structureForm, amount: e.target.value })} /></Field>
          <Field label="Due date (optional)"><input type="date" value={structureForm.dueDate} onChange={(e) => setStructureForm({ ...structureForm, dueDate: e.target.value })} /></Field>
          <Field label="Description"><input maxLength={255} value={structureForm.description} onChange={(e) => setStructureForm({ ...structureForm, description: e.target.value })} /></Field>
          <div className="operations-form-actions"><button className="operations-button primary" disabled={saving}>{saving ? 'Saving…' : 'Create structure'}</button></div>
        </form>
        <section className="operations-section"><div className="operations-section-heading"><div><h4>Fee structures</h4><p>Existing database records. Balances appear after assignment.</p></div><button type="button" className="operations-button secondary" disabled={loading} onClick={() => void load()}>Refresh</button></div>
          <State loading={loading} empty={!loading && structures.length === 0 ? 'No fee structures exist yet.' : undefined} retry={() => void load()} />
          {!loading && structures.length > 0 && <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>Fee</th><th>Academic year / class</th><th>Amount</th><th>Due date</th><th>Assigned</th></tr></thead><tbody>{structures.map((s) => <tr key={s.id}><td><strong>{s.name}</strong>{s.description && <small>{s.description}</small>}</td><td>{s.academicYearName}<small>{s.className ?? 'All classes'}</small></td><td>{fmtAmount(s.amount)}</td><td>{shortDate(s.dueDate)}</td><td>{s.assignedCount}</td></tr>)}</tbody></table></div>}
        </section>
        <form className="operations-form-grid operations-assign-form" onSubmit={assignFees}><div className="operations-form-heading"><div><h4>Assign fee to students</h4><p>Existing fee assignments are skipped rather than duplicated.</p></div></div>
          <Field label="Fee structure"><select required value={structureId} onChange={(e) => setStructureId(e.target.value)}><option value="">Choose fee structure</option>{structures.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.academicYearName} · {fmtAmount(s.amount)}</option>)}</select></Field>
          <div className="operations-field operations-student-picker"><span>Select active students</span><div className="operations-picker-actions"><button type="button" onClick={() => setStudentIds(students.map((s) => s.id))}>Select all</button><button type="button" onClick={() => setStudentIds([])}>Clear</button><small>{studentIds.length} selected</small></div><div className="operations-student-check-list">{students.map((s) => <label key={s.id}><input type="checkbox" checked={studentIds.includes(s.id)} onChange={(e) => setStudentIds((old) => e.target.checked ? [...old, s.id] : old.filter((id) => id !== s.id))} /><span><strong>{s.firstName} {s.lastName}</strong><small>{s.admissionNumber} · {s.className ?? 'Class not recorded'}</small></span></label>)}</div>{students.length === 0 && <small>No active student records were returned.</small>}</div>
          <div className="operations-form-actions"><button className="operations-button primary" disabled={saving || !students.length}>{saving ? 'Assigning…' : 'Assign selected fees'}</button></div>
        </form>
      </>}
      {view === 'balances' && <>
        <div className="operations-section-heading"><div><h4>Student fee balances</h4><p>Amounts and statuses come from saved fee items.</p></div><button type="button" className="operations-button secondary" disabled={loading} onClick={() => void load()}>Refresh</button></div>
        <State loading={loading} empty={!loading && items.length === 0 ? 'No fee items have been assigned to students.' : undefined} retry={() => void load()} />
        {!loading && items.length > 0 && <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>Student</th><th>Fee / year</th><th>Due</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{item.firstName} {item.lastName}</strong><small>{item.admissionNumber}</small></td><td>{item.feeName}<small>{item.academicYearName}</small></td><td>{fmtAmount(item.amountDue)}</td><td>{fmtAmount(item.amountPaid)}</td><td><strong>{fmtAmount(item.balance)}</strong></td><td><span className={'operations-status status-' + item.status.toLowerCase()}>{item.status}</span></td></tr>)}</tbody></table></div>}
        <section className="operations-section"><div className="operations-section-heading"><div><h4>Record a payment</h4><p>Payment is allocated to the student's outstanding fee items and gets a unique receipt.</p></div></div><form className="operations-form-grid compact-form" onSubmit={recordPayment}>
          <Field label="Student"><select required value={paymentForm.studentId} onChange={(e) => setPaymentForm({ ...paymentForm, studentId: e.target.value })}><option value="">Choose student</option>{students.map((s) => <option key={s.id} value={s.id}>{s.firstName} {s.lastName} · {s.admissionNumber}</option>)}</select></Field>
          <Field label="Amount received (RWF)"><input required type="number" min="0.01" step="0.01" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} /></Field>
          <Field label="Payment method"><select value={paymentForm.paymentMethod} onChange={(e) => setPaymentForm({ ...paymentForm, paymentMethod: e.target.value as PaymentMethod })}>{(['CASH','BANK','MOBILE_MONEY','CARD','OTHER'] as PaymentMethod[]).map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}</select></Field>
          <Field label="Reference (optional)"><input maxLength={100} value={paymentForm.reference} onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })} /></Field>
          <div className="operations-form-actions"><button className="operations-button primary" disabled={saving}>{saving ? 'Recording…' : 'Record payment'}</button></div>
        </form></section>
      </>}
      {view === 'payments' && <>
        <div className="operations-section-heading"><div><h4>Payment receipts</h4><p>Receipt numbers and payment methods are read from recorded payments.</p></div><button className="operations-button secondary" disabled={loading} onClick={() => void load()}>Refresh</button></div>
        <State loading={loading} empty={!loading && payments.length === 0 ? 'No payment receipts have been recorded yet.' : undefined} retry={() => void load()} />
        {!loading && payments.length > 0 && <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>Receipt</th><th>Student</th><th>Amount</th><th>Method</th><th>Reference</th><th>Date</th></tr></thead><tbody>{payments.map((p) => <tr key={p.id}><td><strong>{p.receiptNumber}</strong></td><td>{p.firstName} {p.lastName}<small>{p.admissionNumber}</small></td><td>{fmtAmount(p.amount)}</td><td>{p.paymentMethod.replace('_', ' ')}</td><td>{p.reference ?? '—'}</td><td>{shortDate(p.paidAt)}</td></tr>)}</tbody></table></div>}
      </>}
    </>}
  </div>
}

function MessagesModule({ token }: { token: string }) {
  const [messages, setMessages] = useState<MessageRecord[]>([])
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [form, setForm] = useState({ subject: '', body: '', audience: 'ALL' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const result = await api<{ messages: MessageRecord[] }>('/api/admin/operations/messages', token)
      setMessages(result.messages)
    } catch (reason) { setError(messageOf(reason)) } finally { setLoading(false) }
  }, [token])
  useEffect(() => { void load() }, [load])
  const loadRecipients = useCallback(async () => {
    if (!selectedId) { setRecipients([]); return }
    try {
      const result = await api<{ recipients: Recipient[] }>('/api/admin/operations/messages/' + selectedId + '/recipients', token)
      setRecipients(result.recipients)
    } catch (reason) { setError(messageOf(reason)) }
  }, [token, selectedId])
  useEffect(() => { void loadRecipients() }, [loadRecipients])
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('')
    try {
      const result = await api<ApiBase & { message: { id: number; recipientCount: number; subject: string }; messageText?: string }>('/api/admin/operations/messages', token, { method: 'POST', body: JSON.stringify(form) })
      setNotice((result.messageText ?? 'Message sent.') + ' ' + result.message.recipientCount + ' recipients.')
      setForm({ subject: '', body: '', audience: 'ALL' }); setSelectedId(String(result.message.id)); await load()
    } catch (reason) { setError(messageOf(reason)) } finally { setSaving(false) }
  }
  return <div className="operations-module">
    {error && <p className="operations-inline-error" role="alert">{error}</p>}{notice && <p className="operations-inline-success" role="status">{notice}</p>}
    <form className="operations-form-grid" onSubmit={send}><div className="operations-form-heading"><div><h4>Compose school message</h4><p>A send writes the message, recipients, notifications and audit record in one transaction.</p></div></div>
      <Field label="Audience"><select value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}><option value="ALL">All active accounts</option>{(['ADMIN','HEADTEACHER','TEACHER','STUDENT','PARENT','STAFF'] as Role[]).map((role) => <option key={role} value={role}>{role}</option>)}</select></Field>
      <Field label="Subject"><input required maxLength={200} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></Field>
      <Field label="Message"><textarea required rows={5} maxLength={20000} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Write the official message…" /></Field>
      <div className="operations-form-actions"><button className="operations-button primary" disabled={saving}>{saving ? 'Sending…' : 'Send school message'}</button></div>
    </form>
    <section className="operations-section"><div className="operations-section-heading"><div><h4>Sent messages</h4><p>Recipient totals and read status are based on saved recipient records.</p></div><button type="button" className="operations-button secondary" disabled={loading} onClick={() => void load()}>Refresh</button></div>
      <State loading={loading} empty={!loading && !messages.length ? 'No school messages have been sent yet.' : undefined} retry={() => void load()} />
      {!loading && messages.length > 0 && <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>Message</th><th>Sent by</th><th>Recipients</th><th>Read</th><th>Date</th><th>Action</th></tr></thead><tbody>{messages.map((m) => <tr key={m.id}><td><strong>{m.subject}</strong><small>{m.body.length > 100 ? m.body.slice(0, 100) + '…' : m.body}</small></td><td>{m.senderName}</td><td>{m.recipientCount}</td><td>{m.readCount ?? 0}</td><td>{shortDate(m.sentAt)}</td><td><button className="operations-button tiny" type="button" onClick={() => setSelectedId(String(m.id))}>{selectedId === String(m.id) ? 'Selected' : 'Recipients'}</button></td></tr>)}</tbody></table></div>}
    </section>
    {selectedId && <section className="operations-section"><div className="operations-section-heading"><div><h4>Recipients for message #{selectedId}</h4><p>Read state reflects saved read_at timestamps.</p></div><button className="operations-button secondary" type="button" onClick={() => void loadRecipients()}>Refresh recipients</button></div>
      <State empty={!recipients.length ? 'No recipient records were returned.' : undefined} />
      {recipients.length > 0 && <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>Recipient</th><th>Email</th><th>Role</th><th>Read status</th></tr></thead><tbody>{recipients.map((r) => <tr key={r.userId}><td>{r.firstName} {r.lastName}</td><td>{r.email ?? '—'}</td><td>{r.role}</td><td><span className={'operations-status ' + (r.readAt ? 'status-paid' : 'status-unpaid')}>{r.readAt ? 'Read' : 'Unread'}</span>{r.readAt && <small>{shortDate(r.readAt)}</small>}</td></tr>)}</tbody></table></div>}
    </section>}
  </div>
}
