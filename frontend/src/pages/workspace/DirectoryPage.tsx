import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

type DirectoryType = 'teachers' | 'parents'

interface Person {
  id: number
  userId: number
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  isActive: boolean | number
}

interface Teacher extends Person {
  employeeNumber: string | null
  qualification: string | null
  department: string | null
}

interface ParentChild {
  studentId: number
  admissionNumber: string
  firstName: string
  lastName: string
  relationship: string
  isPrimary: boolean | number
}

interface Parent extends Person {
  occupation: string | null
  address: string | null
  children: ParentChild[]
}

interface Student {
  id: number
  admissionNumber: string
  firstName: string
  lastName: string
}

const emptyPerson = {
  id: 0,
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  password: '',
  employeeNumber: '',
  qualification: '',
  department: '',
  occupation: '',
  address: '',
}

function DirectoryPage({ initialType = 'teachers' }: { initialType?: DirectoryType }) {
  const { token } = useAuth()
  const [type, setType] = useState<DirectoryType>(initialType)
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [parents, setParents] = useState<Parent[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [form, setForm] = useState(emptyPerson)
  const [selectedParentId, setSelectedParentId] = useState('')
  const [childForm, setChildForm] = useState({ studentId: '', relationship: '', isPrimary: false })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [teacherResult, parentResult, studentResult] = await Promise.all([
        api<{ teachers: Teacher[] }>('/api/admin/people/teachers', { token }),
        api<{ parents: Parent[] }>('/api/admin/people/parents', { token }),
        api<{ students: Student[] }>('/api/admin/people/students', { token }),
      ])
      setTeachers(teacherResult.teachers)
      setParents(parentResult.parents)
      setStudents(studentResult.students)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load the school directory')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { void load() }, [load])

  function editTeacher(person: Teacher) {
    setForm({
      ...emptyPerson,
      id: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      email: person.email ?? '',
      phone: person.phone ?? '',
      employeeNumber: person.employeeNumber ?? '',
      qualification: person.qualification ?? '',
      department: person.department ?? '',
    })
    setMessage('')
  }

  function editParent(person: Parent) {
    setForm({
      ...emptyPerson,
      id: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      email: person.email ?? '',
      phone: person.phone ?? '',
      occupation: person.occupation ?? '',
      address: person.address ?? '',
    })
    setMessage('')
  }

  async function savePerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    const body = type === 'teachers'
      ? {
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          phone: form.phone,
          employeeNumber: form.employeeNumber,
          qualification: form.qualification,
          department: form.department,
          ...(form.id ? {} : { password: form.password }),
        }
      : {
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          phone: form.phone,
          occupation: form.occupation,
          address: form.address,
          ...(form.id ? {} : { password: form.password }),
        }
    try {
      const path = `/api/admin/people/${type}${form.id ? `/${form.id}` : ''}`
      const result = await api<{ message: string }>(path, {
        method: form.id ? 'PATCH' : 'POST',
        token,
        body: JSON.stringify(body),
      })
      setMessage(result.message)
      setForm(emptyPerson)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save this school account')
    } finally {
      setBusy(false)
    }
  }

  async function linkChild(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await api<{ message: string }>(`/api/admin/people/parents/${selectedParentId}/children`, {
        method: 'POST',
        token,
        body: JSON.stringify(childForm),
      })
      setMessage(result.message)
      setChildForm({ studentId: '', relationship: '', isPrimary: false })
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to link the parent and student')
    } finally {
      setBusy(false)
    }
  }

  function changeType(next: DirectoryType) {
    setType(next)
    setForm(emptyPerson)
    setMessage('')
    setError('')
  }

  const currentParent = parents.find((parent) => String(parent.id) === selectedParentId)

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">PEOPLE</p>
          <h1 className="mt-1 text-2xl font-semibold">School directory</h1>
          <p className="mt-1 text-sm text-muted-foreground">Create and maintain teacher and parent accounts and family links.</p>
        </div>
        <div className="flex gap-2">
          <Button variant={type === 'teachers' ? 'default' : 'outline'} onClick={() => changeType('teachers')}>Teachers</Button>
          <Button variant={type === 'parents' ? 'default' : 'outline'} onClick={() => changeType('parents')}>Parents</Button>
        </div>
      </header>

      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-destructive" role="alert">{error}</p>}
      {message && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800" role="status">{message}</p>}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
        <Card>
          <CardHeader><CardTitle>{type === 'teachers' ? 'Teachers' : 'Parents'} ({type === 'teachers' ? teachers.length : parents.length})</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {loading && <p className="text-sm text-muted-foreground">Loading directory…</p>}
            {!loading && type === 'teachers' && teachers.length === 0 && <p className="text-sm text-muted-foreground">No teacher accounts are recorded.</p>}
            {!loading && type === 'parents' && parents.length === 0 && <p className="text-sm text-muted-foreground">No parent accounts are recorded.</p>}
            {type === 'teachers' && teachers.map((teacher) => (
              <article key={teacher.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
                <div>
                  <p className="font-semibold">{teacher.firstName} {teacher.lastName}</p>
                  <p className="text-sm text-muted-foreground">{teacher.email || 'No email'}{teacher.department ? ` · ${teacher.department}` : ''}</p>
                  <p className="text-xs text-muted-foreground">{teacher.employeeNumber || 'No employee number'} · {teacher.isActive ? 'Active' : 'Inactive'}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => editTeacher(teacher)}>Edit</Button>
              </article>
            ))}
            {type === 'parents' && parents.map((parent) => (
              <article key={parent.id} className="rounded-xl border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">{parent.firstName} {parent.lastName}</p>
                    <p className="text-sm text-muted-foreground">{parent.email || 'No email'}{parent.phone ? ` · ${parent.phone}` : ''}</p>
                    <p className="text-xs text-muted-foreground">{parent.children.length} linked student{parent.children.length === 1 ? '' : 's'} · {parent.isActive ? 'Active' : 'Inactive'}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => editParent(parent)}>Edit</Button>
                    <Button size="sm" variant={selectedParentId === String(parent.id) ? 'secondary' : 'outline'} onClick={() => setSelectedParentId(String(parent.id))}>Link student</Button>
                  </div>
                </div>
                {parent.children.length > 0 && (
                  <ul className="mt-3 space-y-1 border-t pt-3 text-sm text-muted-foreground">
                    {parent.children.map((child) => (
                      <li key={child.studentId}>{child.firstName} {child.lastName} · {child.admissionNumber} · {child.relationship}{child.isPrimary ? ' · primary contact' : ''}</li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>{form.id ? 'Update' : 'Add'} {type === 'teachers' ? 'teacher' : 'parent'}</CardTitle></CardHeader>
            <CardContent>
              <form className="grid gap-3" onSubmit={(event) => void savePerson(event)}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input required maxLength={100} placeholder="First name" value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} />
                  <Input required maxLength={100} placeholder="Last name" value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} />
                </div>
                <Input required type="email" maxLength={190} placeholder="School email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
                <Input maxLength={30} placeholder="Phone (optional)" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
                {!form.id && <Input required type="password" minLength={10} maxLength={128} autoComplete="new-password" placeholder="Temporary password (10+ characters)" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />}
                {type === 'teachers' ? (
                  <>
                    <Input maxLength={50} placeholder="Employee number" value={form.employeeNumber} onChange={(event) => setForm({ ...form, employeeNumber: event.target.value })} />
                    <Input maxLength={255} placeholder="Qualification" value={form.qualification} onChange={(event) => setForm({ ...form, qualification: event.target.value })} />
                    <Input maxLength={150} placeholder="Department" value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} />
                  </>
                ) : (
                  <>
                    <Input maxLength={150} placeholder="Occupation" value={form.occupation} onChange={(event) => setForm({ ...form, occupation: event.target.value })} />
                    <Input maxLength={255} placeholder="Address" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} />
                  </>
                )}
                <div className="flex gap-2">
                  <Button type="submit" disabled={busy}>{busy ? 'Saving…' : form.id ? 'Save changes' : 'Create account'}</Button>
                  {form.id > 0 && <Button type="button" variant="outline" onClick={() => setForm(emptyPerson)}>Cancel</Button>}
                </div>
                {!form.id && <p className="text-xs text-muted-foreground">The account is created with the {type === 'teachers' ? 'TEACHER' : 'PARENT'} role. The password is only stored as a server-side hash.</p>}
              </form>
            </CardContent>
          </Card>

          {type === 'parents' && currentParent && (
            <Card>
              <CardHeader><CardTitle>Link a student to {currentParent.firstName}</CardTitle></CardHeader>
              <CardContent>
                <form className="grid gap-3" onSubmit={(event) => void linkChild(event)}>
                  <label className="grid gap-1 text-sm font-medium">
                    Student
                    <select className="h-10 rounded-lg border border-input bg-card px-3 text-sm" required value={childForm.studentId} onChange={(event) => setChildForm({ ...childForm, studentId: event.target.value })}>
                      <option value="">Select a student</option>
                      {students.map((student) => <option key={student.id} value={student.id}>{student.firstName} {student.lastName} · {student.admissionNumber}</option>)}
                    </select>
                  </label>
                  <Input required maxLength={50} placeholder="Relationship (e.g. mother, guardian)" value={childForm.relationship} onChange={(event) => setChildForm({ ...childForm, relationship: event.target.value })} />
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={childForm.isPrimary} onChange={(event) => setChildForm({ ...childForm, isPrimary: event.target.checked })} />
                    Primary contact
                  </label>
                  <Button type="submit" disabled={busy || students.length === 0}>Link student</Button>
                  {students.length === 0 && <p className="text-xs text-muted-foreground">Create a student record before linking a family account.</p>}
                </form>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

export function TeachersPage() {
  return <DirectoryPage initialType="teachers" />
}

export function ParentsPage() {
  return <DirectoryPage initialType="parents" />
}
