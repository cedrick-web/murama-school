import { FormEvent, useEffect, useState } from 'react'

interface Student {
  id: number
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  admissionNumber: string
  dateOfBirth: string | null
  gender: 'MALE' | 'FEMALE' | 'OTHER' | null
  admissionDate: string | null
  status: 'ACTIVE' | 'INACTIVE' | 'GRADUATED' | 'TRANSFERRED'
  portalActive: number | boolean
  enrollmentId: number | null
  academicYearName: string | null
  className: string | null
  streamName: string | null
  enrollmentStatus: string | null
}

interface AcademicYear {
  id: number
  name: string
  isCurrent: number | boolean
}

interface AcademicTerm {
  id: number
  academicYearId: number
  name: string
}

interface SchoolClass {
  id: number
  name: string
}

interface SchoolStream {
  id: number
  classId: number
  className: string
  name: string
}

interface Enrollment {
  id: number
  studentId: number
  studentName: string
  admissionNumber: string
  academicYearId: number
  academicYearName: string
  termId: number | null
  termName: string | null
  classId: number
  className: string
  streamId: number | null
  streamName: string | null
  enrolledOn: string
  status: 'ACTIVE' | 'COMPLETED' | 'TRANSFERRED' | 'WITHDRAWN'
}

interface PeopleResponse {
  success?: boolean
  message?: string
  students?: Student[]
  years?: AcademicYear[]
  terms?: AcademicTerm[]
  classes?: SchoolClass[]
  streams?: SchoolStream[]
  enrollments?: Enrollment[]
}

type View = 'roster' | 'enrollments'
type StudentForm = {
  firstName: string
  lastName: string
  email: string
  phone: string
  admissionNumber: string
  dateOfBirth: string
  gender: '' | 'MALE' | 'FEMALE' | 'OTHER'
  admissionDate: string
  status: Student['status']
}
type EnrollmentForm = {
  studentId: string
  academicYearId: string
  termId: string
  classId: string
  streamId: string
  enrolledOn: string
}

const emptyStudent: StudentForm = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  admissionNumber: '',
  dateOfBirth: '',
  gender: '',
  admissionDate: '',
  status: 'ACTIVE',
}

function today(): string {
  const date = new Date()
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 10)
}

const emptyEnrollment: EnrollmentForm = {
  studentId: '',
  academicYearId: '',
  termId: '',
  classId: '',
  streamId: '',
  enrolledOn: today(),
}

async function request<T extends PeopleResponse>(
  token: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const apiUrl = (import.meta.env.VITE_API_URL ?? 'http://localhost:5000').replace(/\/$/, '')
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  })
  const body: PeopleResponse | null = await response.json().catch(() => null)
  if (!response.ok || !body?.success) {
    throw new Error(body?.message ?? `Request failed (${response.status})`)
  }
  return body as T
}

function dateValue(value: string | null): string {
  return value?.slice(0, 10) ?? ''
}

function active(value: boolean | number): boolean {
  return value === true || value === 1
}

export default function StudentsPanel({ token }: { token: string }) {
  const [view, setView] = useState<View>('roster')
  const [students, setStudents] = useState<Student[]>([])
  const [years, setYears] = useState<AcademicYear[]>([])
  const [terms, setTerms] = useState<AcademicTerm[]>([])
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [streams, setStreams] = useState<SchoolStream[]>([])
  const [enrollments, setEnrollments] = useState<Enrollment[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingStudentId, setEditingStudentId] = useState<number | null>(null)
  const [studentForm, setStudentForm] = useState<StudentForm>(emptyStudent)
  const [enrollmentForm, setEnrollmentForm] = useState<EnrollmentForm>(emptyEnrollment)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function loadData() {
    const [studentResult, yearResult, termResult, classResult, streamResult, enrollmentResult] = await Promise.all([
      request<{ students: Student[] }>(token, '/api/admin/people/students'),
      request<{ years: AcademicYear[] }>(token, '/api/admin/academics/years'),
      request<{ terms: AcademicTerm[] }>(token, '/api/admin/academics/terms'),
      request<{ classes: SchoolClass[] }>(token, '/api/admin/academics/classes'),
      request<{ streams: SchoolStream[] }>(token, '/api/admin/academics/streams'),
      request<{ enrollments: Enrollment[] }>(token, '/api/admin/people/enrollments'),
    ])
    setStudents(studentResult.students)
    setYears(yearResult.years)
    setTerms(termResult.terms)
    setClasses(classResult.classes)
    setStreams(streamResult.streams)
    setEnrollments(enrollmentResult.enrollments)
    const currentYear = yearResult.years.find((year) => active(year.isCurrent))
    if (currentYear) {
      setEnrollmentForm((current) => current.academicYearId
        ? current
        : { ...current, academicYearId: String(currentYear.id) })
    }
  }

  useEffect(() => {
    let mounted = true
    request<{ students: Student[] }>(token, '/api/admin/people/students')
      .then(({ students: result }) => {
        if (mounted) setStudents(result)
      })
      .catch((reason: unknown) => {
        if (mounted) setError(reason instanceof Error ? reason.message : 'Unable to load student records')
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [token])

  async function refresh() {
    setError('')
    try {
      await loadData()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to refresh student records')
    }
  }

  function cancelStudentEdit() {
    setEditingStudentId(null)
    setStudentForm(emptyStudent)
    setError('')
  }

  async function saveStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const path = editingStudentId === null
        ? '/api/admin/people/students'
        : `/api/admin/people/students/${editingStudentId}`
      const result = await request(token, path, {
        method: editingStudentId === null ? 'POST' : 'PATCH',
        body: JSON.stringify(studentForm),
      })
      setEditingStudentId(null)
      setStudentForm(emptyStudent)
      await refresh()
      setMessage(result.message ?? 'Student record saved')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save student')
    } finally {
      setSaving(false)
    }
  }

  async function saveEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const result = await request(token, '/api/admin/people/enrollments', {
        method: 'POST',
        body: JSON.stringify({
          ...enrollmentForm,
          studentId: Number(enrollmentForm.studentId),
          academicYearId: Number(enrollmentForm.academicYearId),
          termId: enrollmentForm.termId ? Number(enrollmentForm.termId) : null,
          classId: Number(enrollmentForm.classId),
          streamId: enrollmentForm.streamId ? Number(enrollmentForm.streamId) : null,
          status: 'ACTIVE',
        }),
      })
      setEnrollmentForm((current) => ({
        ...emptyEnrollment,
        academicYearId: current.academicYearId,
      }))
      await refresh()
      setMessage(result.message ?? 'Student enrollment created')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to enroll student')
    } finally {
      setSaving(false)
    }
  }

  async function changeEnrollmentStatus(enrollment: Enrollment, status: Enrollment['status']) {
    if (status === enrollment.status) return
    setError('')
    setMessage('')
    try {
      await request(token, `/api/admin/people/enrollments/${enrollment.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
      await refresh()
      setMessage('Enrollment status updated')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update enrollment')
    }
  }

  function editStudent(student: Student) {
    setEditingStudentId(student.id)
    setStudentForm({
      firstName: student.firstName,
      lastName: student.lastName,
      email: student.email ?? '',
      phone: student.phone ?? '',
      admissionNumber: student.admissionNumber,
      dateOfBirth: dateValue(student.dateOfBirth),
      gender: student.gender ?? '',
      admissionDate: dateValue(student.admissionDate),
      status: student.status,
    })
    setError('')
    setMessage('')
  }

  const selectedClassId = Number(enrollmentForm.classId)
  const availableTerms = terms.filter((term) => term.academicYearId === Number(enrollmentForm.academicYearId))
  const availableStreams = streams.filter((stream) => stream.classId === selectedClassId)

  return (
    <section aria-labelledby="students-heading">
      <div className="admin-page-heading">
        <div>
          <p className="admin-eyebrow">STUDENT ADMINISTRATION</p>
          <h1 id="students-heading">Students & enrollment</h1>
          <p className="admin-muted">Maintain the roster and enroll students into their academic groups.</p>
        </div>
        <div className="admin-user-count" aria-label={`${students.length} students`}>
          <strong>{students.length}</strong><span>students</span>
        </div>
      </div>

      <nav className="admin-section-nav academic-nav" aria-label="Student records">
        {([
          ['roster', 'Student roster'],
          ['enrollments', 'Enrollments'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={view === value ? 'is-selected' : ''}
            aria-current={view === value ? 'page' : undefined}
            onClick={() => {
              setView(value)
              setError('')
              setMessage('')
              void refresh()
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      {error && <p className="admin-alert" role="alert">{error}</p>}
      {message && <p className="admin-success" role="status">{message}</p>}
      {loading && <p className="admin-muted" aria-live="polite">Loading student records…</p>}

      {!loading && view === 'roster' && (
        <>
          <p className="admin-info" role="note">
            New student portal access is disabled until secure email invitations are configured. Student records remain available to administrators.
          </p>
          <form className="admin-form-card academic-form student-form" onSubmit={(event) => void saveStudent(event)}>
            <div className="admin-form-title">
              <div>
                <h2>{editingStudentId ? 'Edit student record' : 'Add student'}</h2>
                <p>Admission number must be unique. Portal access will not be enabled by this form.</p>
              </div>
              {editingStudentId !== null && <button className="admin-quiet-button" type="button" onClick={cancelStudentEdit}>Cancel</button>}
            </div>
            <label>First name<input required maxLength={100} value={studentForm.firstName} onChange={(event) => setStudentForm({ ...studentForm, firstName: event.target.value })} /></label>
            <label>Last name<input required maxLength={100} value={studentForm.lastName} onChange={(event) => setStudentForm({ ...studentForm, lastName: event.target.value })} /></label>
            <label>Admission number<input required maxLength={50} value={studentForm.admissionNumber} onChange={(event) => setStudentForm({ ...studentForm, admissionNumber: event.target.value })} /></label>
            <label>Email address<input type="email" maxLength={190} value={studentForm.email} onChange={(event) => setStudentForm({ ...studentForm, email: event.target.value })} /></label>
            <label>Phone number<input maxLength={30} value={studentForm.phone} onChange={(event) => setStudentForm({ ...studentForm, phone: event.target.value })} /></label>
            <label>Date of birth<input type="date" value={studentForm.dateOfBirth} onChange={(event) => setStudentForm({ ...studentForm, dateOfBirth: event.target.value })} /></label>
            <label>Gender
              <select value={studentForm.gender} onChange={(event) => setStudentForm({ ...studentForm, gender: event.target.value as StudentForm['gender'] })}>
                <option value="">Not specified</option><option value="FEMALE">Female</option><option value="MALE">Male</option><option value="OTHER">Other</option>
              </select>
            </label>
            <label>Admission date<input type="date" value={studentForm.admissionDate} onChange={(event) => setStudentForm({ ...studentForm, admissionDate: event.target.value })} /></label>
            <label>Student status
              <select value={studentForm.status} onChange={(event) => setStudentForm({ ...studentForm, status: event.target.value as StudentForm['status'] })}>
                <option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="GRADUATED">Graduated</option><option value="TRANSFERRED">Transferred</option>
              </select>
            </label>
            <div className="admin-form-actions"><button className="admin-primary-button" disabled={saving} type="submit">{saving ? 'Saving…' : editingStudentId ? 'Save changes' : 'Add student'}</button></div>
          </form>

          <section className="admin-table-card admin-list-card">
            <div className="admin-table-heading"><div><h2>Student roster</h2><p>Portal access is handled separately from school records.</p></div></div>
            <div className="admin-record-list">
              {students.length === 0 && <p className="admin-empty">No student records yet.</p>}
              {students.map((student) => (
                <article className="admin-record-row student-record" key={student.id}>
                  <div className="admin-record-main">
                    <div className="admin-record-title"><h3>{student.firstName} {student.lastName}</h3><span className="admin-code-badge">{student.admissionNumber}</span></div>
                    <p>
                      {student.email || 'No email'}
                      {student.phone ? ` · ${student.phone}` : ''}
                      {student.className ? ` · ${student.className}${student.streamName ? ` ${student.streamName}` : ''}` : ''}
                    </p>
                    <div className="admin-student-meta">
                      <span className={`admin-status ${student.status === 'ACTIVE' ? 'is-active' : 'is-inactive'}`}>{student.status.toLowerCase()}</span>
                      <span className="admin-cell-secondary">{active(student.portalActive) ? 'Portal enabled' : 'Invitation required'}</span>
                    </div>
                  </div>
                  <button className="admin-quiet-button" type="button" onClick={() => editStudent(student)}>Edit</button>
                </article>
              ))}
            </div>
          </section>
        </>
      )}

      {!loading && view === 'enrollments' && (
        <>
          <form className="admin-form-card academic-form" onSubmit={(event) => void saveEnrollment(event)}>
            <div className="admin-form-title">
              <div><h2>Enroll a student</h2><p>Choose a year, class, and optional term and stream.</p></div>
            </div>
            <label>Student<select required value={enrollmentForm.studentId} onChange={(event) => setEnrollmentForm({ ...enrollmentForm, studentId: event.target.value })}><option value="">Select a student</option>{students.map((student) => <option key={student.id} value={student.id}>{student.admissionNumber} · {student.firstName} {student.lastName}</option>)}</select></label>
            <label>Academic year<select required value={enrollmentForm.academicYearId} onChange={(event) => setEnrollmentForm({ ...enrollmentForm, academicYearId: event.target.value, termId: '' })}><option value="">Select a year</option>{years.map((year) => <option key={year.id} value={year.id}>{year.name}{active(year.isCurrent) ? ' · current' : ''}</option>)}</select></label>
            <label>Term (optional)<select value={enrollmentForm.termId} onChange={(event) => setEnrollmentForm({ ...enrollmentForm, termId: event.target.value })}><option value="">Whole academic year</option>{availableTerms.map((term) => <option key={term.id} value={term.id}>{term.name}</option>)}</select></label>
            <label>Class<select required value={enrollmentForm.classId} onChange={(event) => setEnrollmentForm({ ...enrollmentForm, classId: event.target.value, streamId: '' })}><option value="">Select a class</option>{classes.map((schoolClass) => <option key={schoolClass.id} value={schoolClass.id}>{schoolClass.name}</option>)}</select></label>
            <label>Stream (optional)<select value={enrollmentForm.streamId} onChange={(event) => setEnrollmentForm({ ...enrollmentForm, streamId: event.target.value })}><option value="">No stream</option>{availableStreams.map((stream) => <option key={stream.id} value={stream.id}>{stream.name}</option>)}</select></label>
            <label>Enrollment date<input required type="date" value={enrollmentForm.enrolledOn} onChange={(event) => setEnrollmentForm({ ...enrollmentForm, enrolledOn: event.target.value })} /></label>
            <div className="admin-form-actions"><button className="admin-primary-button" disabled={saving || students.length === 0 || years.length === 0 || classes.length === 0} type="submit">{saving ? 'Saving…' : 'Create enrollment'}</button></div>
          </form>

          <section className="admin-table-card admin-list-card">
            <div className="admin-table-heading"><div><h2>Enrollments</h2><p>Enrollment history is retained; update status instead of deleting records.</p></div></div>
            <div className="admin-record-list">
              {enrollments.length === 0 && <p className="admin-empty">No enrollments yet.</p>}
              {enrollments.map((enrollment) => (
                <article className="admin-record-row student-record" key={enrollment.id}>
                  <div className="admin-record-main">
                    <div className="admin-record-title"><h3>{enrollment.studentName}</h3><span className="admin-code-badge">{enrollment.admissionNumber}</span></div>
                    <p>{enrollment.academicYearName}{enrollment.termName ? ` · ${enrollment.termName}` : ''} · {enrollment.className}{enrollment.streamName ? ` ${enrollment.streamName}` : ''} · enrolled {dateValue(enrollment.enrolledOn)}</p>
                  </div>
                  <label className="admin-inline-status">
                    <span className="sr-only">Enrollment status for {enrollment.studentName}</span>
                    <select value={enrollment.status} onChange={(event) => void changeEnrollmentStatus(enrollment, event.target.value as Enrollment['status'])}>
                      <option value="ACTIVE">Active</option><option value="COMPLETED">Completed</option><option value="TRANSFERRED">Transferred</option><option value="WITHDRAWN">Withdrawn</option>
                    </select>
                  </label>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </section>
  )
}
