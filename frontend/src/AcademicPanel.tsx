import { FormEvent, useEffect, useState } from 'react'

interface AcademicYear {
  id: number
  name: string
  startsOn: string
  endsOn: string
  isCurrent: boolean | number
  termCount: number
}

interface AcademicTerm {
  id: number
  academicYearId: number
  academicYearName: string
  name: string
  startsOn: string
  endsOn: string
  sequenceNo: number
}

interface SchoolClass {
  id: number
  name: string
  description: string | null
  streamCount: number
}

interface SchoolStream {
  id: number
  classId: number
  className: string
  name: string
}

interface Subject {
  id: number
  code: string
  name: string
  description: string | null
}

interface AcademicResponse {
  success?: boolean
  message?: string
  years?: AcademicYear[]
  terms?: AcademicTerm[]
  classes?: SchoolClass[]
  streams?: SchoolStream[]
  subjects?: Subject[]
}

type CatalogSection = 'years' | 'classes' | 'subjects'
type YearForm = { name: string; startsOn: string; endsOn: string; isCurrent: boolean }
type TermForm = {
  academicYearId: string
  name: string
  startsOn: string
  endsOn: string
  sequenceNo: string
}
type ClassForm = { name: string; description: string }
type StreamForm = { classId: string; name: string }
type SubjectForm = { code: string; name: string; description: string }

const emptyYear: YearForm = { name: '', startsOn: '', endsOn: '', isCurrent: false }
const emptyTerm: TermForm = {
  academicYearId: '',
  name: '',
  startsOn: '',
  endsOn: '',
  sequenceNo: '1',
}
const emptyClass: ClassForm = { name: '', description: '' }
const emptyStream: StreamForm = { classId: '', name: '' }
const emptySubject: SubjectForm = { code: '', name: '', description: '' }

async function request<T extends AcademicResponse>(
  token: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${(import.meta.env.VITE_API_URL ?? 'http://localhost:5000').replace(/\/$/, '')}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  })
  const body: AcademicResponse | null = await response.json().catch(() => null)
  if (!response.ok || !body?.success) {
    throw new Error(body?.message ?? `Request failed (${response.status})`)
  }
  return body as T
}

function dateInput(value: string): string {
  return value.slice(0, 10)
}

function isCurrent(value: boolean | number): boolean {
  return value === true || value === 1
}

export default function AcademicPanel({ token }: { token: string }) {
  const [section, setSection] = useState<CatalogSection>('years')
  const [years, setYears] = useState<AcademicYear[]>([])
  const [terms, setTerms] = useState<AcademicTerm[]>([])
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [streams, setStreams] = useState<SchoolStream[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [editingYear, setEditingYear] = useState<number | null>(null)
  const [editingTerm, setEditingTerm] = useState<number | null>(null)
  const [editingClass, setEditingClass] = useState<number | null>(null)
  const [editingStream, setEditingStream] = useState<number | null>(null)
  const [editingSubject, setEditingSubject] = useState<number | null>(null)
  const [yearForm, setYearForm] = useState<YearForm>(emptyYear)
  const [termForm, setTermForm] = useState<TermForm>(emptyTerm)
  const [classForm, setClassForm] = useState<ClassForm>(emptyClass)
  const [streamForm, setStreamForm] = useState<StreamForm>(emptyStream)
  const [subjectForm, setSubjectForm] = useState<SubjectForm>(emptySubject)

  async function loadCatalogs() {
    const [yearResult, termResult, classResult, streamResult, subjectResult] = await Promise.all([
      request<{ years: AcademicYear[] }>(token, '/api/admin/academics/years'),
      request<{ terms: AcademicTerm[] }>(token, '/api/admin/academics/terms'),
      request<{ classes: SchoolClass[] }>(token, '/api/admin/academics/classes'),
      request<{ streams: SchoolStream[] }>(token, '/api/admin/academics/streams'),
      request<{ subjects: Subject[] }>(token, '/api/admin/academics/subjects'),
    ])
    setYears(yearResult.years)
    setTerms(termResult.terms)
    setClasses(classResult.classes)
    setStreams(streamResult.streams)
    setSubjects(subjectResult.subjects)
  }

  useEffect(() => {
    let active = true
    setLoading(true)
    request<{ years: AcademicYear[] }>(token, '/api/admin/academics/years')
      .then(({ years: result }) => {
        if (active) setYears(result)
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Unable to load academic records')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [token])

  async function refresh() {
    setError('')
    try {
      await loadCatalogs()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to refresh academic records')
    }
  }

  async function submit(
    event: FormEvent<HTMLFormElement>,
    path: string,
    editingId: number | null,
    payload: object,
    clear: () => void,
  ) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const result = await request(token, editingId === null ? path : `${path}/${editingId}`, {
        method: editingId === null ? 'POST' : 'PATCH',
        body: JSON.stringify(payload),
      })
      clear()
      await loadCatalogs()
      setMessage(result.message ?? 'Academic record saved')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save academic record')
    } finally {
      setSaving(false)
    }
  }

  async function remove(path: string, id: number, label: string) {
    if (!window.confirm(`Delete ${label}? Records already using it may prevent deletion.`)) return
    setError('')
    setMessage('')
    try {
      const result = await request(token, `${path}/${id}`, { method: 'DELETE' })
      await loadCatalogs()
      setMessage(result.message ?? `${label} deleted`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Unable to delete ${label}`)
    }
  }

  function cancelEditors() {
    setEditingYear(null)
    setEditingTerm(null)
    setEditingClass(null)
    setEditingStream(null)
    setEditingSubject(null)
    setYearForm(emptyYear)
    setTermForm(emptyTerm)
    setClassForm(emptyClass)
    setStreamForm(emptyStream)
    setSubjectForm(emptySubject)
    setError('')
  }

  return (
    <section aria-labelledby="academic-heading">
      <div className="admin-page-heading">
        <div>
          <p className="admin-eyebrow">ACADEMIC SETUP</p>
          <h1 id="academic-heading">Academic structure</h1>
          <p className="admin-muted">Set up school years, terms, classes, streams, and subjects.</p>
        </div>
      </div>

      <nav className="admin-section-nav academic-nav" aria-label="Academic records">
        {([
          ['years', 'Years & terms'],
          ['classes', 'Classes & streams'],
          ['subjects', 'Subjects'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={section === value ? 'is-selected' : ''}
            aria-current={section === value ? 'page' : undefined}
            onClick={() => {
              setSection(value)
              void refresh()
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      {error && <p className="admin-alert" role="alert">{error}</p>}
      {message && <p className="admin-success" role="status">{message}</p>}
      {loading && <p className="admin-muted" aria-live="polite">Loading academic setup…</p>}

      {!loading && section === 'years' && (
        <>
          <form
            className="admin-form-card academic-form"
            onSubmit={(event) => void submit(
              event,
              '/api/admin/academics/years',
              editingYear,
              yearForm,
              () => {
                setEditingYear(null)
                setYearForm(emptyYear)
              },
            )}
          >
            <div className="admin-form-title">
              <div>
                <h2>{editingYear ? 'Edit academic year' : 'Add academic year'}</h2>
                <p>Year dates must be valid, with the start date on or before the end date.</p>
              </div>
              {editingYear !== null && (
                <button className="admin-quiet-button" type="button" onClick={cancelEditors}>Cancel</button>
              )}
            </div>
            <label>
              Year name
              <input required maxLength={30} value={yearForm.name} onChange={(event) => setYearForm({ ...yearForm, name: event.target.value })} placeholder="2026–2027" />
            </label>
            <label>
              Starts on
              <input required type="date" value={yearForm.startsOn} onChange={(event) => setYearForm({ ...yearForm, startsOn: event.target.value })} />
            </label>
            <label>
              Ends on
              <input required type="date" value={yearForm.endsOn} onChange={(event) => setYearForm({ ...yearForm, endsOn: event.target.value })} />
            </label>
            <label className="admin-checkbox-label">
              <input type="checkbox" checked={yearForm.isCurrent} onChange={(event) => setYearForm({ ...yearForm, isCurrent: event.target.checked })} />
              Make current academic year
            </label>
            <div className="admin-form-actions">
              <button className="admin-primary-button" disabled={saving} type="submit">{saving ? 'Saving…' : editingYear ? 'Save changes' : 'Add year'}</button>
            </div>
          </form>

          <section className="admin-table-card admin-list-card">
            <div className="admin-table-heading"><div><h2>Academic years</h2><p>{years.length} year{years.length === 1 ? '' : 's'} configured</p></div></div>
            <div className="admin-record-list">
              {years.length === 0 && <p className="admin-empty">No academic years configured yet.</p>}
              {years.map((year) => (
                <article className="admin-record-row" key={year.id}>
                  <div className="admin-record-main">
                    <div className="admin-record-title">
                      <h3>{year.name}</h3>
                      {isCurrent(year.isCurrent) && <span className="admin-status is-active">Current</span>}
                    </div>
                    <p>{dateInput(year.startsOn)} to {dateInput(year.endsOn)} · {year.termCount} term{Number(year.termCount) === 1 ? '' : 's'}</p>
                  </div>
                  <div className="admin-row-actions">
                    <button
                      className="admin-quiet-button"
                      type="button"
                      onClick={() => {
                        cancelEditors()
                        setEditingYear(year.id)
                        setYearForm({ name: year.name, startsOn: dateInput(year.startsOn), endsOn: dateInput(year.endsOn), isCurrent: isCurrent(year.isCurrent) })
                      }}
                    >Edit</button>
                    <button className="admin-quiet-button danger-button" type="button" onClick={() => void remove('/api/admin/academics/years', year.id, `academic year “${year.name}”`)}>Delete</button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <form
            className="admin-form-card academic-form admin-secondary-form"
            onSubmit={(event) => void submit(
              event,
              '/api/admin/academics/terms',
              editingTerm,
              { ...termForm, academicYearId: Number(termForm.academicYearId), sequenceNo: Number(termForm.sequenceNo) },
              () => {
                setEditingTerm(null)
                setTermForm(emptyTerm)
              },
            )}
          >
            <div className="admin-form-title">
              <div>
                <h2>{editingTerm ? 'Edit term' : 'Add term'}</h2>
                <p>Term dates must fall within the selected academic year.</p>
              </div>
              {editingTerm !== null && (
                <button className="admin-quiet-button" type="button" onClick={cancelEditors}>Cancel</button>
              )}
            </div>
            <label>
              Academic year
              <select required value={termForm.academicYearId} onChange={(event) => setTermForm({ ...termForm, academicYearId: event.target.value })}>
                <option value="">Select a year</option>
                {years.map((year) => <option key={year.id} value={year.id}>{year.name}</option>)}
              </select>
            </label>
            <label>
              Term name
              <input required maxLength={50} value={termForm.name} onChange={(event) => setTermForm({ ...termForm, name: event.target.value })} placeholder="Term 1" />
            </label>
            <label>
              Sequence
              <input required type="number" min={1} max={12} value={termForm.sequenceNo} onChange={(event) => setTermForm({ ...termForm, sequenceNo: event.target.value })} />
            </label>
            <label>
              Starts on
              <input required type="date" value={termForm.startsOn} onChange={(event) => setTermForm({ ...termForm, startsOn: event.target.value })} />
            </label>
            <label>
              Ends on
              <input required type="date" value={termForm.endsOn} onChange={(event) => setTermForm({ ...termForm, endsOn: event.target.value })} />
            </label>
            <div className="admin-form-actions">
              <button className="admin-primary-button" disabled={saving || years.length === 0} type="submit">{saving ? 'Saving…' : editingTerm ? 'Save changes' : 'Add term'}</button>
            </div>
          </form>

          <section className="admin-table-card admin-list-card">
            <div className="admin-table-heading"><div><h2>Terms</h2><p>School periods within each academic year</p></div></div>
            <div className="admin-record-list">
              {terms.length === 0 && <p className="admin-empty">No terms configured yet.</p>}
              {terms.map((term) => (
                <article className="admin-record-row" key={term.id}>
                  <div className="admin-record-main">
                    <div className="admin-record-title"><h3>{term.name}</h3><span className="admin-audience">{term.academicYearName} · sequence {term.sequenceNo}</span></div>
                    <p>{dateInput(term.startsOn)} to {dateInput(term.endsOn)}</p>
                  </div>
                  <div className="admin-row-actions">
                    <button
                      className="admin-quiet-button"
                      type="button"
                      onClick={() => {
                        cancelEditors()
                        setEditingTerm(term.id)
                        setTermForm({ academicYearId: String(term.academicYearId), name: term.name, startsOn: dateInput(term.startsOn), endsOn: dateInput(term.endsOn), sequenceNo: String(term.sequenceNo) })
                      }}
                    >Edit</button>
                    <button className="admin-quiet-button danger-button" type="button" onClick={() => void remove('/api/admin/academics/terms', term.id, `term “${term.name}”`)}>Delete</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </>
      )}

      {!loading && section === 'classes' && (
        <>
          <div className="academic-two-column">
            <form
              className="admin-form-card academic-form"
              onSubmit={(event) => void submit(event, '/api/admin/academics/classes', editingClass, classForm, () => {
                setEditingClass(null)
                setClassForm(emptyClass)
              })}
            >
              <div className="admin-form-title">
                <div><h2>{editingClass ? 'Edit class' : 'Add class'}</h2><p>Examples: Senior 1, Senior 2, or Senior 3.</p></div>
                {editingClass !== null && <button className="admin-quiet-button" type="button" onClick={cancelEditors}>Cancel</button>}
              </div>
              <label>Class name<input required maxLength={100} value={classForm.name} onChange={(event) => setClassForm({ ...classForm, name: event.target.value })} /></label>
              <label>Description<textarea rows={3} maxLength={255} value={classForm.description} onChange={(event) => setClassForm({ ...classForm, description: event.target.value })} /></label>
              <div className="admin-form-actions"><button className="admin-primary-button" disabled={saving} type="submit">{saving ? 'Saving…' : editingClass ? 'Save changes' : 'Add class'}</button></div>
            </form>

            <form
              className="admin-form-card academic-form"
              onSubmit={(event) => void submit(event, '/api/admin/academics/streams', editingStream, { ...streamForm, classId: Number(streamForm.classId) }, () => {
                setEditingStream(null)
                setStreamForm(emptyStream)
              })}
            >
              <div className="admin-form-title">
                <div><h2>{editingStream ? 'Edit stream' : 'Add stream'}</h2><p>Streams are attached to one class.</p></div>
                {editingStream !== null && <button className="admin-quiet-button" type="button" onClick={cancelEditors}>Cancel</button>}
              </div>
              <label>Class<select required value={streamForm.classId} onChange={(event) => setStreamForm({ ...streamForm, classId: event.target.value })}><option value="">Select a class</option>{classes.map((schoolClass) => <option key={schoolClass.id} value={schoolClass.id}>{schoolClass.name}</option>)}</select></label>
              <label>Stream name<input required maxLength={50} value={streamForm.name} onChange={(event) => setStreamForm({ ...streamForm, name: event.target.value })} placeholder="A" /></label>
              <div className="admin-form-actions"><button className="admin-primary-button" disabled={saving || classes.length === 0} type="submit">{saving ? 'Saving…' : editingStream ? 'Save changes' : 'Add stream'}</button></div>
            </form>
          </div>

          <section className="admin-table-card admin-list-card">
            <div className="admin-table-heading"><div><h2>Classes</h2><p>{classes.length} class{classes.length === 1 ? '' : 'es'} configured</p></div></div>
            <div className="admin-record-list">
              {classes.length === 0 && <p className="admin-empty">No classes configured yet.</p>}
              {classes.map((schoolClass) => (
                <article className="admin-record-row" key={schoolClass.id}>
                  <div className="admin-record-main"><h3>{schoolClass.name}</h3><p>{schoolClass.description || 'No description'} · {schoolClass.streamCount} stream{Number(schoolClass.streamCount) === 1 ? '' : 's'}</p></div>
                  <div className="admin-row-actions">
                    <button className="admin-quiet-button" type="button" onClick={() => { cancelEditors(); setEditingClass(schoolClass.id); setClassForm({ name: schoolClass.name, description: schoolClass.description ?? '' }) }}>Edit</button>
                    <button className="admin-quiet-button danger-button" type="button" onClick={() => void remove('/api/admin/academics/classes', schoolClass.id, `class “${schoolClass.name}”`)}>Delete</button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="admin-table-card admin-list-card">
            <div className="admin-table-heading"><div><h2>Streams</h2><p>Class groupings</p></div></div>
            <div className="admin-record-list">
              {streams.length === 0 && <p className="admin-empty">No streams configured yet.</p>}
              {streams.map((stream) => (
                <article className="admin-record-row" key={stream.id}>
                  <div className="admin-record-main"><h3>{stream.className} · {stream.name}</h3></div>
                  <div className="admin-row-actions">
                    <button className="admin-quiet-button" type="button" onClick={() => { cancelEditors(); setEditingStream(stream.id); setStreamForm({ classId: String(stream.classId), name: stream.name }) }}>Edit</button>
                    <button className="admin-quiet-button danger-button" type="button" onClick={() => void remove('/api/admin/academics/streams', stream.id, `stream “${stream.name}”`)}>Delete</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </>
      )}

      {!loading && section === 'subjects' && (
        <>
          <form
            className="admin-form-card academic-form"
            onSubmit={(event) => void submit(event, '/api/admin/academics/subjects', editingSubject, subjectForm, () => {
              setEditingSubject(null)
              setSubjectForm(emptySubject)
            })}
          >
            <div className="admin-form-title">
              <div><h2>{editingSubject ? 'Edit subject' : 'Add subject'}</h2><p>Use a short unique code, for example MATH or BIO.</p></div>
              {editingSubject !== null && <button className="admin-quiet-button" type="button" onClick={cancelEditors}>Cancel</button>}
            </div>
            <label>Subject code<input required maxLength={30} value={subjectForm.code} onChange={(event) => setSubjectForm({ ...subjectForm, code: event.target.value.toUpperCase() })} /></label>
            <label>Subject name<input required maxLength={150} value={subjectForm.name} onChange={(event) => setSubjectForm({ ...subjectForm, name: event.target.value })} /></label>
            <label>Description<textarea rows={3} maxLength={255} value={subjectForm.description} onChange={(event) => setSubjectForm({ ...subjectForm, description: event.target.value })} /></label>
            <div className="admin-form-actions"><button className="admin-primary-button" disabled={saving} type="submit">{saving ? 'Saving…' : editingSubject ? 'Save changes' : 'Add subject'}</button></div>
          </form>
          <section className="admin-table-card admin-list-card">
            <div className="admin-table-heading"><div><h2>Subjects</h2><p>{subjects.length} subject{subjects.length === 1 ? '' : 's'} configured</p></div></div>
            <div className="admin-record-list">
              {subjects.length === 0 && <p className="admin-empty">No subjects configured yet.</p>}
              {subjects.map((subject) => (
                <article className="admin-record-row" key={subject.id}>
                  <div className="admin-record-main"><div className="admin-record-title"><span className="admin-code-badge">{subject.code}</span><h3>{subject.name}</h3></div>{subject.description && <p>{subject.description}</p>}</div>
                  <div className="admin-row-actions">
                    <button className="admin-quiet-button" type="button" onClick={() => { cancelEditors(); setEditingSubject(subject.id); setSubjectForm({ code: subject.code, name: subject.name, description: subject.description ?? '' }) }}>Edit</button>
                    <button className="admin-quiet-button danger-button" type="button" onClick={() => void remove('/api/admin/academics/subjects', subject.id, `subject “${subject.name}”`)}>Delete</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </section>
  )
}
