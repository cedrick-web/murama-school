import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { Button } from '@/components/ui/button'
import './dashboard.css'

interface ApiEnvelope {
  success?: boolean
  message?: string
}
interface SchoolAccount {
  id: number; firstName: string; lastName: string; email: string | null
  role: string; isActive: boolean | number; lastLoginAt: string | null
}
interface StudentRecord {
  id: number; firstName: string; lastName: string; admissionNumber: string
  status: string; className: string | null; streamName: string | null
  enrollmentStatus: string | null
}
interface EnrollmentRecord {
  id: number; studentName: string; admissionNumber: string; academicYearName: string
  className: string; streamName: string | null; status: string; enrolledOn: string
}
interface AcademicYear {
  id: number; name: string; startsOn: string; endsOn: string
  isCurrent: boolean | number; termCount: number
}
interface SchoolClass { id: number; name: string; streamCount: number }
interface SchoolAnnouncement {
  id: number; title: string; message: string; audience: string
  isPublished: boolean | number; publishedAt: string | null
  createdAt: string; createdBy: string | null
}
interface AuditRecord {
  id: number; action: string; entityType: string | null; entityId: number | null
  details: Record<string, unknown> | string | null; createdAt: string; actor: string | null
}
type NavigateTo = 'users' | 'academics' | 'students' | 'operations' | 'settings' | 'announcements' | 'activity'
interface DashboardPanelProps { token: string; userName: string; onNavigate: (section: NavigateTo) => void }
const apiUrl = (import.meta.env.VITE_API_URL ?? 'http://localhost:5000').replace(/\/+$/, '')

async function getApi<T>(path: string, token: string): Promise<T> {
  const response = await fetch(apiUrl + path, { headers: { Authorization: 'Bearer ' + token } })
  const body = await response.json().catch(() => null) as (ApiEnvelope & Record<string, unknown>) | null
  if (!response.ok || !body || body.success !== true) {
    throw new Error(body?.message ?? ('Request failed (' + response.status + ')'))
  }
  return body as T
}
function isEnabled(value: boolean | number): boolean { return value === true || value === 1 }
function safeDate(value: string | null | undefined, withTime = false): string {
  if (!value) return 'No recent activity'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date unavailable'
  return new Intl.DateTimeFormat('en-RW', withTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' }).format(date)
}
function readableAction(action: string): string {
  return action.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}
function MetricIcon({ kind }: { kind: 'students' | 'enrolments' | 'accounts' | 'classes' }) {
  const paths = {
    students: <><circle cx="9" cy="8" r="3"/><path d="M3 20v-1.5A4.5 4.5 0 0 1 7.5 14h3A4.5 4.5 0 0 1 15 18.5V20"/><path d="M16 5.3a3 3 0 0 1 0 5.8M18 14.2a4.5 4.5 0 0 1 3 4.3V20"/></>,
    enrolments: <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h4"/></>,
    accounts: <><circle cx="9" cy="8" r="3"/><path d="M3 20v-1a6 6 0 0 1 12 0v1M16 11a3 3 0 1 0 0-6M18 14a4 4 0 0 1 3 4v2"/></>,
    classes: <><path d="M3 5.5 12 2l9 3.5-9 3.5-9-3.5Z"/><path d="M6 7v6c0 2 2.7 3.5 6 3.5s6-1.5 6-3.5V7M21 6v7"/></>,
  }
  return <svg className="dashboard-metric-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>
}
export default function DashboardPanel({ token, userName, onNavigate }: DashboardPanelProps) {
  const [accounts, setAccounts] = useState<SchoolAccount[] | null>(null)
  const [students, setStudents] = useState<StudentRecord[] | null>(null)
  const [enrollments, setEnrollments] = useState<EnrollmentRecord[] | null>(null)
  const [years, setYears] = useState<AcademicYear[] | null>(null)
  const [classes, setClasses] = useState<SchoolClass[] | null>(null)
  const [announcements, setAnnouncements] = useState<SchoolAnnouncement[] | null>(null)
  const [activity, setActivity] = useState<AuditRecord[] | null>(null)
  const [database, setDatabase] = useState<{ success: boolean; status: string } | null>(null)
  const [failedSources, setFailedSources] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    const results = await Promise.allSettled([
      getApi<{ users: SchoolAccount[] }>('/api/admin/users', token),
      getApi<{ students: StudentRecord[] }>('/api/admin/people/students', token),
      getApi<{ enrollments: EnrollmentRecord[] }>('/api/admin/people/enrollments', token),
      getApi<{ years: AcademicYear[] }>('/api/admin/academics/years', token),
      getApi<{ classes: SchoolClass[] }>('/api/admin/academics/classes', token),
      getApi<{ announcements: SchoolAnnouncement[] }>('/api/admin/announcements', token),
      getApi<{ logs: AuditRecord[] }>('/api/admin/audit-logs?limit=6', token),
      fetch(apiUrl + '/api/health/database').then(async (response) => {
        const body = await response.json().catch(() => null) as { success?: boolean; status?: string } | null
        if (!response.ok || !body?.success) throw new Error('Database health check failed')
        return body as { success: boolean; status: string }
      }),
    ] as const)
    setAccounts(results[0].status === 'fulfilled' ? results[0].value.users : null)
    setStudents(results[1].status === 'fulfilled' ? results[1].value.students : null)
    setEnrollments(results[2].status === 'fulfilled' ? results[2].value.enrollments : null)
    setYears(results[3].status === 'fulfilled' ? results[3].value.years : null)
    setClasses(results[4].status === 'fulfilled' ? results[4].value.classes : null)
    setAnnouncements(results[5].status === 'fulfilled' ? results[5].value.announcements : null)
    setActivity(results[6].status === 'fulfilled' ? results[6].value.logs : null)
    setDatabase(results[7].status === 'fulfilled' ? results[7].value : null)
    const labels = ['school accounts', 'student records', 'enrollments', 'academic years', 'classes', 'announcements', 'audit activity', 'database health']
    setFailedSources(results.flatMap((result, index) => result.status === 'rejected' ? [labels[index]] : []))
    setLastUpdated(new Date())
    setLoading(false)
  }, [token])

  useEffect(() => { void loadDashboard() }, [loadDashboard])
  const activeStudents = useMemo(() => students?.filter((student) => student.status === 'ACTIVE').length ?? null, [students])
  const activeEnrollments = useMemo(() => enrollments?.filter((enrollment) => enrollment.status === 'ACTIVE').length ?? null, [enrollments])
  const activeAccounts = useMemo(() => accounts?.filter((account) => isEnabled(account.isActive)).length ?? null, [accounts])
  const currentYear = useMemo(() => years?.find((year) => isEnabled(year.isCurrent)) ?? null, [years])
  const publishedCount = useMemo(() => announcements?.filter((announcement) => isEnabled(announcement.isPublished)).length ?? null, [announcements])
  const streamCount = classes?.reduce((sum, schoolClass) => sum + Number(schoolClass.streamCount || 0), 0) ?? null
  const metrics = [
    { key: 'students' as const, label: 'Active students', value: activeStudents, note: 'From the student register', action: 'students' as const },
    { key: 'enrolments' as const, label: 'Active enrollments', value: activeEnrollments, note: 'Across recorded academic years', action: 'students' as const },
    { key: 'accounts' as const, label: 'Active accounts', value: activeAccounts, note: 'School system access accounts', action: 'users' as const },
    { key: 'classes' as const, label: 'Classes', value: classes?.length ?? null, note: (streamCount === null ? '—' : streamCount.toLocaleString('en-RW')) + ' streams recorded', action: 'academics' as const },
  ]
  const today = new Intl.DateTimeFormat('en-RW', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())
  const firstName = userName.trim().split(/\s+/)[0] || 'Administrator'

  return (
    <motion.div
      className="dashboard-root"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: 'easeOut' }}
    >
      <section className="dashboard-welcome">
        <div>
          <span className="dashboard-kicker">SCHOOL OPERATIONS · LIVE OVERVIEW</span>
          <h2>Good day, {firstName}.</h2>
          <p>One clear view of your school's records, academic setup and operational activity.</p>
          <div className="dashboard-welcome-meta">
            <span className="dashboard-date"><span className="dashboard-meta-dot" />{today}</span>
            {currentYear && <span className="dashboard-year-badge">{currentYear.name} · Current academic year</span>}
          </div>
        </div>
        <div className="dashboard-welcome-actions">
          <Button variant="outline" size="sm" className="dashboard-refresh-button" onClick={() => void loadDashboard()} disabled={loading}>
            <svg viewBox="0 0 24 24" aria-hidden="true" className={loading ? 'is-spinning' : ''}><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.7 9A7 7 0 0 1 18 6.5L20 12M4 12l2 5.5A7 7 0 0 0 18.3 15"/></svg>
            {loading ? 'Refreshing' : 'Refresh data'}
          </Button>
          <span className="dashboard-updated">{lastUpdated ? 'Updated ' + safeDate(lastUpdated.toISOString(), true) : 'Waiting for live data'}</span>
        </div>
      </section>

      {failedSources.length > 0 && (
        <div className="dashboard-data-warning" role="status">
          <strong>Some data sources could not be loaded.</strong>
          <span>{failedSources.join(', ')}. Metrics from unavailable sources are shown as unavailable rather than reported as zero.</span>
          <button type="button" onClick={() => void loadDashboard()}>Retry</button>
        </div>
      )}

      <div className="dashboard-section-heading">
        <div><h3>Operational snapshot</h3><p>Counts are loaded from the school API, not sample data.</p></div>
        <span className={'dashboard-connection ' + (database?.status === 'connected' ? 'is-connected' : 'is-disconnected')}>
          <span />{database?.status === 'connected' ? 'Supabase PostgreSQL connected' : database ? 'Supabase PostgreSQL unavailable' : 'Database status unknown'}
        </span>
      </div>

      <section className="dashboard-metrics" aria-label="School metrics">
        {metrics.map((metric) => (
          <button className="dashboard-metric-card" type="button" key={metric.key} onClick={() => onNavigate(metric.action)}>
            <span className={'dashboard-metric-icon-wrap tone-' + metric.key}><MetricIcon kind={metric.key} /></span>
            <span className="dashboard-metric-label">{metric.label}</span>
            <strong className="dashboard-metric-value">{loading && metric.value === null ? '…' : metric.value === null ? '—' : metric.value.toLocaleString('en-RW')}</strong>
            <span className="dashboard-metric-note">{metric.note}</span>
            <span className="dashboard-metric-link">Open records <span aria-hidden="true">↗</span></span>
          </button>
        ))}
      </section>

      <section className="dashboard-lower-grid">
        <div className="dashboard-panel dashboard-activity-panel">
          <div className="dashboard-panel-heading">
            <div><span className="dashboard-panel-eyebrow">AUDIT TRAIL</span><h3>Recent activity</h3></div>
            <button type="button" onClick={() => onNavigate('activity')}>Full audit log <span aria-hidden="true">→</span></button>
          </div>
          {activity === null && !loading ? <p className="dashboard-empty">Audit activity is unavailable. Refresh to try again.</p>
            : activity?.length === 0 ? <p className="dashboard-empty">No recorded activity is available yet.</p>
            : <div className="dashboard-activity-list">
              {(activity ?? []).slice(0, 6).map((record) => (
                <article className="dashboard-activity-item" key={record.id}>
                  <span className="dashboard-activity-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg></span>
                  <div className="dashboard-activity-copy">
                    <strong>{readableAction(record.action)}</strong>
                    <span>{record.actor || 'System account'}{record.entityType ? ' · ' + record.entityType : ''}{record.entityId ? ' #' + record.entityId : ''}</span>
                  </div>
                  <time dateTime={record.createdAt}>{safeDate(record.createdAt, true)}</time>
                </article>
              ))}
            </div>}
        </div>

        <div className="dashboard-panel dashboard-announcements-panel">
          <div className="dashboard-panel-heading">
            <div><span className="dashboard-panel-eyebrow">SCHOOL COMMUNICATION</span><h3>Announcements</h3></div>
            <button type="button" onClick={() => onNavigate('announcements')}>Manage <span aria-hidden="true">→</span></button>
          </div>
          <div className="dashboard-announcement-counts">
            <div><strong>{loading && announcements === null ? '…' : publishedCount ?? '—'}</strong><span>Published</span></div>
            <div><strong>{loading && announcements === null ? '…' : announcements === null ? '—' : announcements.length - (publishedCount ?? 0)}</strong><span>Drafts</span></div>
          </div>
          {announcements === null && !loading ? <p className="dashboard-empty">Announcements could not be loaded.</p>
            : announcements?.length === 0 ? <p className="dashboard-empty">No announcements have been created yet.</p>
            : <div className="dashboard-announcement-list">
              {(announcements ?? []).slice(0, 3).map((announcement) => (
                <article className="dashboard-announcement-item" key={announcement.id}>
                  <div className="dashboard-announcement-title-row">
                    <strong>{announcement.title}</strong>
                    <span className={'dashboard-publish-pill ' + (isEnabled(announcement.isPublished) ? 'published' : 'draft')}>{isEnabled(announcement.isPublished) ? 'Published' : 'Draft'}</span>
                  </div>
                  <p>{announcement.message}</p>
                  <span>{announcement.audience} · {safeDate(announcement.publishedAt ?? announcement.createdAt)}</span>
                </article>
              ))}
            </div>}
          <button className="dashboard-create-announcement" type="button" onClick={() => onNavigate('announcements')}>
            Manage school communications <span aria-hidden="true">→</span>
          </button>
        </div>
      </section>

      <section className="dashboard-modules-section">
        <div className="dashboard-section-heading">
          <div><h3>School management</h3><p>Open a module backed by the current school API.</p></div>
        </div>
        <div className="dashboard-module-grid">
          <button type="button" className="dashboard-module-card" onClick={() => onNavigate('students')}>
            <span className="dashboard-module-icon">01</span><span><strong>Students & enrollment</strong><small>Maintain the student register, admission details and class enrollment.</small></span><span className="dashboard-module-arrow">↗</span>
          </button>
          <button type="button" className="dashboard-module-card" onClick={() => onNavigate('academics')}>
            <span className="dashboard-module-icon">02</span><span><strong>Academic structure</strong><small>Configure academic years, terms, classes, streams and subjects.</small></span><span className="dashboard-module-arrow">↗</span>
          </button>
          <button type="button" className="dashboard-module-card" onClick={() => onNavigate('users')}>
            <span className="dashboard-module-icon">03</span><span><strong>Accounts & access</strong><small>Review users, roles and account status.</small></span><span className="dashboard-module-arrow">↗</span>
          </button>
          <button type="button" className="dashboard-module-card" onClick={() => onNavigate('settings')}>
            <span className="dashboard-module-icon">04</span><span><strong>School identity</strong><small>Manage contact details, locale, language and currency.</small></span><span className="dashboard-module-arrow">↗</span>
          </button>
          <button type="button" className="dashboard-module-card" onClick={() => onNavigate('operations')}>
            <span className="dashboard-module-icon">05</span><span><strong>School operations</strong><small>Attendance registers, assessments and marks, timetable, fee balances, receipts and official messages.</small></span><span className="dashboard-module-arrow">↗</span>
          </button>
        </div>
      </section>
    </motion.div>
  )
}
