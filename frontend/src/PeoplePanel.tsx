import { FormEvent, useEffect, useState } from 'react'
import './people-management.css'

interface ApiResult {
  success?: boolean
  message?: string
  teachers?: TeacherRecord[]
  parents?: ParentRecord[]
  assignments?: TeacherAssignment[]
  classes?: OptionRecord[]
  subjects?: OptionRecord[]
  years?: OptionRecord[]
  teacher?: TeacherRecord
  parent?: ParentRecord
}
interface TeacherRecord {
  id: number
  userId: number
  firstName: string
  lastName: string
  email: string
  phone: string | null
  employeeNumber: string | null
  qualification: string | null
  department: string | null
  portalActive: boolean | number
  assignmentsCount: number
}
interface ParentRecord {
  id: number
  userId: number
  firstName: string
  lastName: string
  email: string
  phone: string | null
  occupation: string | null
  address: string | null
  portalActive: boolean | number
  linkedStudents: number
}
interface TeacherAssignment {
  id: number
  teacherId: number
  teacherName: string
  employeeNumber: string | null
  classId: number
  className: string
  subjectId: number
  subjectCode: string
  subjectName: string
  academicYearId: number
  academicYear: string
}
interface OptionRecord {
  id: number
  name: string
  code?: string
  isCurrent?: boolean | number
}

const apiUrl = (import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? '' : 'http://localhost:5000')).replace(/\/$/, '')
async function request<T extends ApiResult>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl + path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  })
  const result = await response.json().catch(() => null) as T | null
  if (!response.ok || !result?.success) throw new Error(result?.message ?? `Request failed (${response.status})`)
  return result
}
const emptyTeacher = { firstName: '', lastName: '', email: '', phone: '', employeeNumber: '', qualification: '', department: '' }
const emptyParent = { firstName: '', lastName: '', email: '', phone: '', occupation: '', address: '' }

export default function PeoplePanel({ token }: { token: string }) {
  const [tab, setTab] = useState<'teachers' | 'parents' | 'assignments'>('teachers')
  const [teachers, setTeachers] = useState<TeacherRecord[]>([])
  const [parents, setParents] = useState<ParentRecord[]>([])
  const [assignments, setAssignments] = useState<TeacherAssignment[]>([])
  const [classes, setClasses] = useState<OptionRecord[]>([])
  const [subjects, setSubjects] = useState<OptionRecord[]>([])
  const [years, setYears] = useState<OptionRecord[]>([])
  const [teacherForm, setTeacherForm] = useState(emptyTeacher)
  const [parentForm, setParentForm] = useState(emptyParent)
  const [assignmentForm, setAssignmentForm] = useState({ teacherId: '', classId: '', subjectId: '', academicYearId: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [removingId, setRemovingId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const [teacherResult, parentResult, assignmentResult, classResult, subjectResult, yearResult] = await Promise.all([
        request<{ teachers: TeacherRecord[] }>('/api/admin/people/teachers', token),
        request<{ parents: ParentRecord[] }>('/api/admin/people/parents', token),
        request<{ assignments: TeacherAssignment[] }>('/api/admin/people/teacher-assignments', token),
        request<{ classes: OptionRecord[] }>('/api/admin/academics/classes', token),
        request<{ subjects: OptionRecord[] }>('/api/admin/academics/subjects', token),
        request<{ years: OptionRecord[] }>('/api/admin/academics/years', token),
      ])
      setTeachers(teacherResult.teachers)
      setParents(parentResult.parents)
      setAssignments(assignmentResult.assignments)
      setClasses(classResult.classes)
      setSubjects(subjectResult.subjects)
      setYears(yearResult.years)
      setAssignmentForm((current) => ({
        ...current,
        teacherId: current.teacherId || String(teacherResult.teachers[0]?.id ?? ''),
        classId: current.classId || String(classResult.classes[0]?.id ?? ''),
        subjectId: current.subjectId || String(subjectResult.subjects[0]?.id ?? ''),
        academicYearId: current.academicYearId || String(yearResult.years.find((year) => year.isCurrent === true || year.isCurrent === 1)?.id ?? yearResult.years[0]?.id ?? ''),
      }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load people and teaching assignments')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadData() }, [token])

  async function createTeacher(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true); setError(''); setMessage('')
    try {
      const result = await request('/api/admin/people/teachers', token, { method: 'POST', body: JSON.stringify(teacherForm) })
      setTeacherForm(emptyTeacher)
      setMessage(result.message ?? 'Teacher record created. Create an invitation from Users & access.')
      await loadData()
      window.dispatchEvent(new Event('murama:admin-data-changed'))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to create teacher')
    } finally { setSaving(false) }
  }

  async function createParent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true); setError(''); setMessage('')
    try {
      const result = await request('/api/admin/people/parents', token, { method: 'POST', body: JSON.stringify(parentForm) })
      setParentForm(emptyParent)
      setMessage(result.message ?? 'Parent record created. Create an invitation and link a student from Users & access.')
      await loadData()
      window.dispatchEvent(new Event('murama:admin-data-changed'))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to create parent')
    } finally { setSaving(false) }
  }

  async function createAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!assignmentForm.teacherId || !assignmentForm.classId || !assignmentForm.subjectId || !assignmentForm.academicYearId) {
      setError('Choose a teacher, class, subject and academic year.')
      return
    }
    setSaving(true); setError(''); setMessage('')
    try {
      const result = await request('/api/admin/people/teacher-assignments', token, {
        method: 'POST',
        body: JSON.stringify({
          teacherId: Number(assignmentForm.teacherId),
          classId: Number(assignmentForm.classId),
          subjectId: Number(assignmentForm.subjectId),
          academicYearId: Number(assignmentForm.academicYearId),
        }),
      })
      setMessage(result.message ?? 'Teaching assignment created.')
      await loadData()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to create teaching assignment')
    } finally { setSaving(false) }
  }

  async function removeAssignment(assignment: TeacherAssignment) {
    if (!window.confirm(`Remove ${assignment.teacherName} from ${assignment.subjectName} · ${assignment.className} · ${assignment.academicYear}?`)) return
    setRemovingId(assignment.id); setError(''); setMessage('')
    try {
      const result = await request('/api/admin/people/teacher-assignments/' + assignment.id, token, { method: 'DELETE' })
      setMessage(result.message ?? 'Teaching assignment removed.')
      await loadData()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to remove teaching assignment')
    } finally { setRemovingId(null) }
  }

  return <div className="people-admin">
    <div className="admin-page-heading"><div><p className="admin-eyebrow">SCHOOL PEOPLE</p><h2>Parents, teachers & assignments</h2><p className="admin-muted">Create school records first, then invite accounts. Teacher assignments control which classes and students a teacher can access.</p></div><div className="admin-user-count"><strong>{teachers.length + parents.length}</strong><span>people</span></div></div>
    <div className="people-admin-tabs" role="tablist" aria-label="People management sections">
      <button type="button" role="tab" aria-selected={tab === 'teachers'} className={tab === 'teachers' ? 'is-active' : ''} onClick={() => { setTab('teachers'); setError(''); setMessage('') }}>Teacher accounts <span>{teachers.length}</span></button>
      <button type="button" role="tab" aria-selected={tab === 'parents'} className={tab === 'parents' ? 'is-active' : ''} onClick={() => { setTab('parents'); setError(''); setMessage('') }}>Parent accounts <span>{parents.length}</span></button>
      <button type="button" role="tab" aria-selected={tab === 'assignments'} className={tab === 'assignments' ? 'is-active' : ''} onClick={() => { setTab('assignments'); setError(''); setMessage('') }}>Teaching assignments <span>{assignments.length}</span></button>
    </div>
    {error && <p className="admin-alert" role="alert">{error}</p>}
    {message && <p className="people-success" role="status">{message}</p>}
    {loading && <p className="admin-muted">Loading school records…</p>}

    {!loading && tab === 'teachers' && <>
      <section className="admin-table-card"><div className="admin-table-heading"><div><h2>Create teacher record</h2><p>Teacher accounts begin inactive and must be invited after their teaching assignments are configured.</p></div></div>
        <form className="people-form-grid" onSubmit={createTeacher}>
          <label>First name<input value={teacherForm.firstName} onChange={(e) => setTeacherForm({ ...teacherForm, firstName: e.target.value })} maxLength={100} required /></label>
          <label>Last name<input value={teacherForm.lastName} onChange={(e) => setTeacherForm({ ...teacherForm, lastName: e.target.value })} maxLength={100} required /></label>
          <label>Email<input type="email" value={teacherForm.email} onChange={(e) => setTeacherForm({ ...teacherForm, email: e.target.value })} maxLength={190} required /></label>
          <label>Phone<input value={teacherForm.phone} onChange={(e) => setTeacherForm({ ...teacherForm, phone: e.target.value })} maxLength={30} /></label>
          <label>Employee number<input value={teacherForm.employeeNumber} onChange={(e) => setTeacherForm({ ...teacherForm, employeeNumber: e.target.value })} maxLength={50} /></label>
          <label>Qualification<input value={teacherForm.qualification} onChange={(e) => setTeacherForm({ ...teacherForm, qualification: e.target.value })} maxLength={255} /></label>
          <label>Department<input value={teacherForm.department} onChange={(e) => setTeacherForm({ ...teacherForm, department: e.target.value })} maxLength={150} /></label>
          <button className="admin-quiet-button people-submit" type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create teacher'}</button>
        </form>
      </section>
      <section className="admin-table-card"><div className="admin-table-heading"><div><h2>Teacher directory</h2><p>Portal access is granted through a separate invitation.</p></div><span className="admin-muted">{teachers.length} records</span></div><div className="admin-table-scroll"><table><thead><tr><th>Name</th><th>Contact</th><th>Employee / department</th><th>Assignments</th><th>Portal</th></tr></thead><tbody>
        {teachers.map((teacher) => <tr key={teacher.id}><td><strong>{teacher.firstName} {teacher.lastName}</strong></td><td><span>{teacher.email}</span>{teacher.phone && <small className="admin-cell-secondary">{teacher.phone}</small>}</td><td><span>{teacher.employeeNumber ?? '—'}</span><small className="admin-cell-secondary">{teacher.department ?? teacher.qualification ?? '—'}</small></td><td>{teacher.assignmentsCount}</td><td><span className={'admin-status ' + (teacher.portalActive ? 'is-active' : 'is-inactive')}>{teacher.portalActive ? 'Active' : 'Invitation required'}</span></td></tr>)}
        {teachers.length === 0 && <tr><td colSpan={5} className="admin-empty">No teacher records yet.</td></tr>}
      </tbody></table></div></section>
    </>}

    {!loading && tab === 'parents' && <>
      <section className="admin-table-card"><div className="admin-table-heading"><div><h2>Create parent or guardian</h2><p>The parent is linked to a student only through the secure invitation acceptance flow.</p></div></div>
        <form className="people-form-grid" onSubmit={createParent}>
          <label>First name<input value={parentForm.firstName} onChange={(e) => setParentForm({ ...parentForm, firstName: e.target.value })} maxLength={100} required /></label>
          <label>Last name<input value={parentForm.lastName} onChange={(e) => setParentForm({ ...parentForm, lastName: e.target.value })} maxLength={100} required /></label>
          <label>Email<input type="email" value={parentForm.email} onChange={(e) => setParentForm({ ...parentForm, email: e.target.value })} maxLength={190} required /></label>
          <label>Phone<input value={parentForm.phone} onChange={(e) => setParentForm({ ...parentForm, phone: e.target.value })} maxLength={30} /></label>
          <label>Occupation<input value={parentForm.occupation} onChange={(e) => setParentForm({ ...parentForm, occupation: e.target.value })} maxLength={150} /></label>
          <label>Address<input value={parentForm.address} onChange={(e) => setParentForm({ ...parentForm, address: e.target.value })} maxLength={255} /></label>
          <button className="admin-quiet-button people-submit" type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create parent'}</button>
        </form>
      </section>
      <section className="admin-table-card"><div className="admin-table-heading"><div><h2>Parent directory</h2><p>Use Users & access to issue an invitation and link a verified student.</p></div><span className="admin-muted">{parents.length} records</span></div><div className="admin-table-scroll"><table><thead><tr><th>Name</th><th>Contact</th><th>Occupation</th><th>Linked students</th><th>Portal</th></tr></thead><tbody>
        {parents.map((parent) => <tr key={parent.id}><td><strong>{parent.firstName} {parent.lastName}</strong></td><td><span>{parent.email}</span>{parent.phone && <small className="admin-cell-secondary">{parent.phone}</small>}</td><td>{parent.occupation ?? '—'}</td><td>{parent.linkedStudents}</td><td><span className={'admin-status ' + (parent.portalActive ? 'is-active' : 'is-inactive')}>{parent.portalActive ? 'Active' : 'Invitation required'}</span></td></tr>)}
        {parents.length === 0 && <tr><td colSpan={5} className="admin-empty">No parent records yet.</td></tr>}
      </tbody></table></div></section>
    </>}

    {!loading && tab === 'assignments' && <>
      <section className="admin-table-card"><div className="admin-table-heading"><div><h2>Assign teacher to class and subject</h2><p>Assignments are enforced by the teacher API and determine visible classes, rosters, marks and attendance.</p></div></div>
        <form className="people-form-grid assignment-form-grid" onSubmit={createAssignment}>
          <label>Teacher<select value={assignmentForm.teacherId} onChange={(e) => setAssignmentForm({ ...assignmentForm, teacherId: e.target.value })} required><option value="">Choose teacher</option>{teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.firstName} {teacher.lastName} · {teacher.employeeNumber ?? teacher.email}</option>)}</select></label>
          <label>Class<select value={assignmentForm.classId} onChange={(e) => setAssignmentForm({ ...assignmentForm, classId: e.target.value })} required><option value="">Choose class</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Subject<select value={assignmentForm.subjectId} onChange={(e) => setAssignmentForm({ ...assignmentForm, subjectId: e.target.value })} required><option value="">Choose subject</option>{subjects.map((item) => <option key={item.id} value={item.id}>{item.code ? item.code + ' · ' : ''}{item.name}</option>)}</select></label>
          <label>Academic year<select value={assignmentForm.academicYearId} onChange={(e) => setAssignmentForm({ ...assignmentForm, academicYearId: e.target.value })} required><option value="">Choose year</option>{years.map((item) => <option key={item.id} value={item.id}>{item.name}{item.isCurrent ? ' · Current' : ''}</option>)}</select></label>
          <button className="admin-quiet-button people-submit" type="submit" disabled={saving || !teachers.length || !classes.length || !subjects.length || !years.length}>{saving ? 'Saving…' : 'Create assignment'}</button>
        </form>
      </section>
      <section className="admin-table-card"><div className="admin-table-heading"><div><h2>Teaching assignment register</h2><p>Remove assignments when a teacher changes class or subject. Existing marks and attendance remain in school records.</p></div><span className="admin-muted">{assignments.length} assignments</span></div><div className="admin-table-scroll"><table><thead><tr><th>Teacher</th><th>Class</th><th>Subject</th><th>Academic year</th><th>Action</th></tr></thead><tbody>
        {assignments.map((assignment) => <tr key={assignment.id}><td><strong>{assignment.teacherName}</strong><small className="admin-cell-secondary">{assignment.employeeNumber ?? '—'}</small></td><td>{assignment.className}</td><td>{assignment.subjectCode} · {assignment.subjectName}</td><td>{assignment.academicYear}</td><td><button className="admin-quiet-button" type="button" disabled={removingId === assignment.id} onClick={() => void removeAssignment(assignment)}>{removingId === assignment.id ? 'Removing…' : 'Remove'}</button></td></tr>)}
        {assignments.length === 0 && <tr><td colSpan={5} className="admin-empty">No teaching assignments configured yet.</td></tr>}
      </tbody></table></div></section>
    </>}
  </div>
}
