import { useEffect, useState, type FormEvent } from 'react'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { formatDate, formatMoney } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

interface PortalStudent {
  id: number
  admissionNumber: string
  status: string
  firstName: string
  lastName: string
  className: string | null
  streamName: string | null
}

interface PortalOverview {
  role: string
  unreadNotifications: number
  announcements: Array<{ id: number; title: string; message: string; publishedAt: string }>
  notifications: Array<{ id: number; title: string; body: string; createdAt: string; readAt: string | null }>
  messages: Array<{ id: number; subject: string; body: string; sentAt: string; senderName: string; readAt: string | null }>
  students: PortalStudent[]
  attendance: Array<{ id: number; attendanceDate: string; status: string; note: string | null; className: string | null }>
  reportCards: Array<{ id: number; termName: string; academicYearName: string; averageScore: number; classPosition: number | null; attendancePercentage: number | null; generatedAt: string }>
  fees: Array<{ id: number; feeName: string; academicYearName: string; amountDue: number; amountPaid: number; balance: number; status: string }>
  timetable: Array<{ id: number; className: string; dayOfWeek: string; startsAt: string; endsAt: string; room: string | null; subjectName: string; teacherName?: string }>
  teacher: { employeeNumber: string | null; qualification: string | null; department: string | null } | null
}

export function PortalPage() {
  const { token, user } = useAuth()
  const [overview, setOverview] = useState<PortalOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    api<{ overview: PortalOverview }>('/api/portal/overview', { token })
      .then(({ overview: result }) => {
        if (active) setOverview(result)
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Unable to load your school portal')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [token])

  async function markRead(kind: 'notifications' | 'messages', id: number) {
    setError('')
    try {
      await api(`/api/portal/${kind}/${id}/read`, { method: 'POST', token })
      setOverview((current) => current && ({
        ...current,
        [kind]: current[kind].map((item) => item.id === id ? { ...item, readAt: new Date().toISOString() } : item),
      }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update this item')
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground" role="status">Loading your school portal…</p>
  if (!overview) {
    return <p className="rounded-xl bg-red-50 p-4 text-sm text-destructive" role="alert">{error || 'Your portal data is unavailable.'}</p>
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{overview.role} PORTAL</p>
        <h1 className="mt-1 text-2xl font-semibold">Welcome, {user?.firstName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {overview.unreadNotifications
            ? `You have ${overview.unreadNotifications} unread notification${overview.unreadNotifications === 1 ? '' : 's'}.`
            : 'Your school updates and records are shown below.'}
        </p>
      </header>

      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-destructive" role="alert">{error}</p>}

      {overview.students.length > 0 && (
        <section className="grid gap-4 md:grid-cols-2">
          {overview.students.map((student) => (
            <Card key={student.id}>
              <CardHeader><CardTitle>{student.firstName} {student.lastName}</CardTitle></CardHeader>
              <CardContent className="grid gap-1 text-sm text-muted-foreground">
                <p>Admission number: {student.admissionNumber}</p>
                <p>Class: {[student.className, student.streamName].filter(Boolean).join(' · ') || 'Not enrolled'}</p>
                <p>Status: {student.status}</p>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {overview.teacher && (
        <Card>
          <CardHeader><CardTitle>Teaching profile</CardTitle></CardHeader>
          <CardContent className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-3">
            <p>Employee number: {overview.teacher.employeeNumber || '—'}</p>
            <p>Department: {overview.teacher.department || '—'}</p>
            <p>Qualification: {overview.teacher.qualification || '—'}</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>School announcements</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {overview.announcements.length === 0 && <p className="text-sm text-muted-foreground">No announcements are published for your account.</p>}
            {overview.announcements.map((item) => (
              <article key={item.id} className="border-b pb-3 last:border-0 last:pb-0">
                <p className="text-xs text-muted-foreground">{formatDate(item.publishedAt)}</p>
                <h2 className="mt-1 font-semibold">{item.title}</h2>
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{item.message}</p>
              </article>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Notifications</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {overview.notifications.length === 0 && <p className="text-sm text-muted-foreground">You have no notifications.</p>}
            {overview.notifications.map((item) => (
              <article key={item.id} className="flex items-start justify-between gap-3 border-b pb-3 last:border-0 last:pb-0">
                <div>
                  <p className="font-medium">{item.title}</p>
                  <p className="text-sm text-muted-foreground">{item.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{formatDate(item.createdAt, true)}</p>
                </div>
                {!item.readAt && <Button size="sm" variant="outline" onClick={() => void markRead('notifications', item.id)}>Mark read</Button>}
              </article>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Messages</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {overview.messages.length === 0 && <p className="text-sm text-muted-foreground">You have no messages.</p>}
          {overview.messages.map((item) => (
            <article key={item.id} className="flex items-start justify-between gap-3 border-b pb-3 last:border-0 last:pb-0">
              <div>
                <p className="font-medium">{item.subject}</p>
                <p className="text-sm text-muted-foreground">From {item.senderName} · {formatDate(item.sentAt, true)}</p>
                <p className="mt-2 whitespace-pre-wrap text-sm">{item.body}</p>
              </div>
              {!item.readAt && <Button size="sm" variant="outline" onClick={() => void markRead('messages', item.id)}>Mark read</Button>}
            </article>
          ))}
        </CardContent>
      </Card>

      {overview.attendance.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Recent attendance</CardTitle></CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {overview.attendance.map((item) => (
              <p key={item.id} className="rounded-lg bg-secondary/60 p-3 text-sm">
                <strong>{formatDate(item.attendanceDate)}</strong> · {item.status}{item.className ? ` · ${item.className}` : ''}
                {item.note && <span className="block text-muted-foreground">{item.note}</span>}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {overview.reportCards.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Report cards</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {overview.reportCards.map((item) => (
              <article key={item.id} className="rounded-xl border p-4">
                <p className="font-semibold">{item.termName} · {item.academicYearName}</p>
                <p className="mt-1 text-sm">Average: {Number(item.averageScore).toFixed(1)}%</p>
                <p className="text-sm text-muted-foreground">Class position: {item.classPosition ?? '—'} · Attendance: {item.attendancePercentage ?? '—'}%</p>
              </article>
            ))}
          </CardContent>
        </Card>
      )}

      {overview.fees.length > 0 && (
        <Card>
          <CardHeader><CardTitle>School fees</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {overview.fees.map((item) => (
              <article key={item.id} className="rounded-xl border p-4">
                <p className="font-semibold">{item.feeName} · {item.academicYearName}</p>
                <p className="mt-1 text-sm">Due: {formatMoney(item.amountDue)} · Paid: {formatMoney(item.amountPaid)}</p>
                <p className="text-sm text-muted-foreground">Balance: {formatMoney(item.balance)} · {item.status}</p>
              </article>
            ))}
          </CardContent>
        </Card>
      )}

      {overview.timetable.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Timetable</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {overview.timetable.map((item) => (
              <article key={item.id} className="rounded-xl border p-4">
                <p className="font-semibold">{item.subjectName} · {item.className}</p>
                <p className="text-sm text-muted-foreground">{item.dayOfWeek}, {item.startsAt}–{item.endsAt}{item.room ? ` · ${item.room}` : ''}</p>
                {item.teacherName && <p className="text-sm text-muted-foreground">{item.teacherName}</p>}
              </article>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export function AccountPage() {
  const { token } = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    setError('')
    try {
      const result = await api<{ message: string }>('/api/auth/password', {
        method: 'POST',
        token,
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      setMessage(result.message)
      setCurrentPassword('')
      setNewPassword('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update your password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header>
        <h1 className="text-2xl font-semibold">Password and profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">Change your school account password. Use at least 10 characters.</p>
      </header>
      <Card>
        <CardContent className="pt-6">
          <form className="grid gap-4" onSubmit={(event) => void updatePassword(event)}>
            {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-destructive" role="alert">{error}</p>}
            {message && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800" role="status">{message}</p>}
            <label className="grid gap-1 text-sm font-medium">
              Current password
              <Input type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              New password
              <Input type="password" autoComplete="new-password" minLength={10} maxLength={128} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
            </label>
            <Button type="submit" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
