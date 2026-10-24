import { FormEvent, useEffect, useState } from 'react'
import AcademicPanel from './AcademicPanel'
import StudentsPanel from './StudentsPanel'
import './admin.css'
import { cleanGoogleCallbackUrl, finishGoogleSignIn, getGoogleCallbackError, startGoogleSignIn } from './lib/supabase-auth'

type UserRole =
  | 'ADMIN'
  | 'HEADTEACHER'
  | 'TEACHER'
  | 'STUDENT'
  | 'PARENT'
  | 'STAFF'

interface AuthUser {
  id: number
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  role: UserRole
}

interface AdminUser extends AuthUser {
  isActive: number | boolean
  lastLoginAt: string | null
}

interface ApiResponse {
  success?: boolean
  message?: string
  token?: string
  user?: AuthUser
  users?: AdminUser[]
  settings?: SchoolSettings
  announcements?: Announcement[]
  logs?: AuditLog[]
}

interface SchoolSettings {
  school_name: string
  default_language: string
  supported_languages: string
  timezone: string
  currency: string
  contact_email: string
  contact_phone: string
  address: string
}

interface Announcement {
  id: number
  title: string
  message: string
  audience: string
  isPublished: number | boolean
  publishedAt: string | null
  createdAt: string
  createdBy: string | null
}

interface AuditLog {
  id: number
  action: string
  entityType: string | null
  entityId: number | null
  details: Record<string, unknown> | string | null
  createdAt: string
  actor: string | null
}

type AdminSection = 'users' | 'academics' | 'students' | 'settings' | 'announcements' | 'activity'

const roles: UserRole[] = [
  'ADMIN',
  'HEADTEACHER',
  'TEACHER',
  'STAFF',
  'STUDENT',
  'PARENT',
]
const tokenKey = 'murama-admin-token'

function hasGoogleCallback(): boolean {
  const params = new URLSearchParams(window.location.search)
  return params.has('code') || params.has('error') || params.has('error_description')
}
const apiUrl = (import.meta.env.VITE_API_URL ?? 'http://localhost:5000').replace(/\/$/, '')

async function request<T extends ApiResponse>(
  path: string,
  token?: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  const body: ApiResponse | null = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(body?.message ?? `Request failed (${response.status})`)
  }

  if (!body?.success) {
    throw new Error(body?.message ?? 'The server returned an unexpected response')
  }

  return body as T
}

function formatDate(value: string | null): string {
  if (!value) return 'Never'

  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Unknown'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

export default function AdminApp() {
  const [token, setToken] = useState(() => sessionStorage.getItem(tokenKey))
  const [user, setUser] = useState<AuthUser | null>(null)
  const [status, setStatus] = useState<'checking' | 'signed-out' | 'ready'>(
    token || hasGoogleCallback() ? 'checking' : 'signed-out',
  )
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [busyUserId, setBusyUserId] = useState<number | null>(null)
  const [section, setSection] = useState<AdminSection>('users')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [oauthBusy, setOauthBusy] = useState(false)
  const [oauthProcessing, setOauthProcessing] = useState(() => hasGoogleCallback())

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const callbackError = getGoogleCallbackError()
    if (!code && !callbackError) return

    cleanGoogleCallbackUrl()
    setOauthProcessing(true)
    setStatus('checking')
    setError('')

    if (!code) {
      setError(callbackError ?? 'Google sign-in was cancelled.')
      setStatus('signed-out')
      setOauthProcessing(false)
      return
    }

    let active = true
    finishGoogleSignIn(code)
      .then((result) => {
        if (!active) return
        if (result.user.role !== 'ADMIN') {
          throw new Error('This Google account is not an administrator. Contact the school administrator for access.')
        }
        sessionStorage.setItem(tokenKey, result.token)
        setPassword('')
        setToken(result.token)
        setOauthProcessing(false)
        setStatus('checking')
      })
      .catch((reason: unknown) => {
        if (!active) return
        setError(reason instanceof Error ? reason.message : 'Unable to finish Google sign-in')
        setStatus('signed-out')
        setOauthProcessing(false)
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!token) {
      if (!oauthProcessing) setStatus('signed-out')
      setUser(null)
      return
    }

    let active = true
    setStatus('checking')
    setError('')

    request<{ user: AuthUser }>('/api/auth/me', token)
      .then(({ user: currentUser }) => {
        if (!active) return
        if (currentUser.role !== 'ADMIN') {
          sessionStorage.removeItem(tokenKey)
          setToken(null)
          setError('This area is available to administrators only.')
          return
        }
        setUser(currentUser)
        setStatus('ready')
      })
      .catch((reason: unknown) => {
        if (!active) return
        sessionStorage.removeItem(tokenKey)
        setToken(null)
        setError(reason instanceof Error ? reason.message : 'Unable to verify your session')
      })

    return () => {
      active = false
    }
  }, [token, oauthProcessing])

  useEffect(() => {
    if (status !== 'ready' || !token) return

    let active = true
    setLoadingUsers(true)
    setError('')

    request<{ users: AdminUser[] }>('/api/admin/users', token)
      .then(({ users: result }) => {
        if (active) setUsers(result)
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : 'Unable to load users')
        }
      })
      .finally(() => {
        if (active) setLoadingUsers(false)
      })

    return () => {
      active = false
    }
  }, [status, token])

  function signOut() {
    sessionStorage.removeItem(tokenKey)
    setToken(null)
    setUser(null)
    setUsers([])
    setError('')
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    try {
      const result = await request<{ token: string }>('/api/auth/login', undefined, {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password }),
      })
      if (!result.token) throw new Error('The server did not return a login token')
      sessionStorage.setItem(tokenKey, result.token)
      setPassword('')
      setToken(result.token)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to sign in')
    }
  }

  async function handleGoogleLogin() {
    setError('')
    setOauthBusy(true)
    try {
      await startGoogleSignIn()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to start Google sign-in')
      setOauthBusy(false)
    }
  }

  async function changeRole(target: AdminUser, role: UserRole) {
    if (!token || role === target.role) return

    setBusyUserId(target.id)
    setError('')
    try {
      await request('/api/admin/users/' + target.id + '/role', token, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      })
      setUsers((current) => current.map((item) => (
        item.id === target.id ? { ...item, role } : item
      )))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update this role')
    } finally {
      setBusyUserId(null)
    }
  }

  async function changeAccountStatus(target: AdminUser, isActive: boolean) {
    if (!token) return

    setBusyUserId(target.id)
    setError('')
    try {
      await request(`/api/admin/users/${target.id}/status`, token, {
        method: 'PATCH',
        body: JSON.stringify({ isActive }),
      })
      setUsers((current) => current.map((item) => (
        item.id === target.id ? { ...item, isActive } : item
      )))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update this account')
    } finally {
      setBusyUserId(null)
    }
  }

  if (status === 'checking' || oauthProcessing) {
    return <main className="admin-loading" aria-live="polite">{oauthProcessing ? 'Completing Google sign-in…' : 'Checking your session…'}</main>
  }

  if (status === 'signed-out') {
    return (
      <main className="admin-login-page">
        <a className="admin-back-link" href="/">← Murama School</a>
        <section className="admin-login-card">
          <span className="admin-brand-mark" aria-hidden="true">M</span>
          <p className="admin-eyebrow">SCHOOL ADMINISTRATION</p>
          <h1>Sign in to your workspace</h1>
          <p className="admin-muted">Use your school administrator account to continue.</p>
          {error && <p className="admin-alert" role="alert">{error}</p>}
          <button
            className="admin-google-button"
            type="button"
            onClick={handleGoogleLogin}
            disabled={oauthBusy || oauthProcessing}
          >
            <span className="admin-google-mark" aria-hidden="true">G</span>
            {oauthBusy ? 'Connecting to Google…' : 'Continue with Google'}
          </button>
          <div className="admin-login-divider"><span>or use your school account</span></div>
          <form onSubmit={handleLogin}>
            <label htmlFor="admin-email">Email address</label>
            <input
              id="admin-email"
              autoComplete="username"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <label htmlFor="admin-password">Password</label>
            <input
              id="admin-password"
              autoComplete="current-password"
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button className="admin-primary-button" type="submit">Sign in</button>
          </form>
          <p className="admin-login-note">Administrator access only</p>
        </section>
      </main>
    )
  }

  return (
    <main className="admin-page">
      <header className="admin-topbar">
        <a className="admin-brand" href="/" aria-label="Murama School home">
          <span className="admin-brand-mark" aria-hidden="true">M</span>
          <span><strong>ESM</strong><small>Administration</small></span>
        </a>
        <div className="admin-account">
          <span>{user ? `${user.firstName} ${user.lastName}` : 'Administrator'}</span>
          <button className="admin-quiet-button" type="button" onClick={signOut}>Sign out</button>
        </div>
      </header>

      <section className="admin-content">
          <nav className="admin-section-nav" aria-label="Administration sections">
            {([
              ['users', 'Users'],
              ['academics', 'Academics'],
              ['students', 'Students'],
              ['settings', 'School settings'],
              ['announcements', 'Announcements'],
              ['activity', 'Activity log'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={section === value ? 'is-selected' : ''}
                aria-current={section === value ? 'page' : undefined}
                onClick={() => {
                  setSection(value)
                  setError('')
                }}
              >
                {label}
              </button>
            ))}
          </nav>

          {error && <p className="admin-alert" role="alert">{error}</p>}

          {section === 'users' && (
            <>
              <div className="admin-page-heading">
                <div>
                  <p className="admin-eyebrow">SCHOOL ADMINISTRATION</p>
                  <h1>User management</h1>
                  <p className="admin-muted">Review school accounts and manage access.</p>
                </div>
                <div className="admin-user-count" aria-label={`${users.length} accounts`}>
                  <strong>{users.length}</strong><span>accounts</span>
                </div>
              </div>
              <section className="admin-table-card" aria-labelledby="users-heading">
                <div className="admin-table-heading">
                  <div>
                    <h2 id="users-heading">School accounts</h2>
                    <p>Changes to roles or account access are recorded.</p>
                  </div>
                  {loadingUsers && <span className="admin-muted" aria-live="polite">Loading…</span>}
                </div>
                <div className="admin-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Name</th>
                        <th scope="col">Email / phone</th>
                        <th scope="col">Role</th>
                        <th scope="col">Status</th>
                        <th scope="col">Last sign-in</th>
                        <th scope="col">Account access</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((account) => {
                        const active = account.isActive === true || account.isActive === 1
                        return (
                          <tr key={account.id}>
                            <td data-label="Name">
                              <strong>{account.firstName} {account.lastName}</strong>
                            </td>
                            <td data-label="Email / phone">
                              <span>{account.email ?? '—'}</span>
                              {account.phone && <small className="admin-cell-secondary">{account.phone}</small>}
                            </td>
                            <td data-label="Role">
                              <select
                                aria-label={`Role for ${account.firstName} ${account.lastName}`}
                                value={account.role}
                                disabled={busyUserId === account.id || account.id === user?.id}
                                onChange={(event) => {
                                  const role = roles.find((candidate) => candidate === event.target.value)
                                  if (role) void changeRole(account, role)
                                }}
                              >
                                {roles.map((role) => <option key={role} value={role}>{role}</option>)}
                              </select>
                              {account.id === user?.id && (
                                <small className="admin-cell-secondary">Your own role is locked</small>
                              )}
                            </td>
                            <td data-label="Status">
                              <span className={`admin-status ${active ? 'is-active' : 'is-inactive'}`}>
                                {active ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td data-label="Last sign-in">{formatDate(account.lastLoginAt)}</td>
                            <td data-label="Account access">
                              {active || account.role === 'ADMIN' ? (
                                <button
                                  className="admin-quiet-button"
                                  type="button"
                                  disabled={busyUserId === account.id || account.id === user?.id}
                                  onClick={() => void changeAccountStatus(account, !active)}
                                >
                                  {active ? 'Deactivate' : 'Activate'}
                                </button>
                              ) : (
                                <span className="admin-cell-secondary">Invitation required</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                      {!loadingUsers && users.length === 0 && (
                        <tr><td className="admin-empty" colSpan={6}>No user accounts found.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          {section === 'settings' && token && <SettingsPanel token={token} />}
          {section === 'academics' && token && <AcademicPanel token={token} />}
          {section === 'students' && token && <StudentsPanel token={token} />}
          {section === 'announcements' && token && <AnnouncementsPanel token={token} />}
          {section === 'activity' && token && <ActivityPanel token={token} />}
      </section>
    </main>
  )
}

function SettingsPanel({ token }: { token: string }) {
  const [settings, setSettings] = useState<SchoolSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    request<{ settings: SchoolSettings }>('/api/admin/settings', token)
      .then(({ settings: current }) => {
          if (active) setSettings(current)
      })
      .catch((reason: unknown) => {
          if (active) setError(reason instanceof Error ? reason.message : 'Unable to load settings')
      })
      .finally(() => {
          if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [token])

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!settings) return

    setSaving(true)
    setError('')
    setMessage('')
    try {
      const result = await request('/api/admin/settings', token, {
          method: 'PUT',
          body: JSON.stringify({ settings }),
      })
      setMessage(result.message ?? 'Settings saved')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="admin-page-heading">
          <div>
            <p className="admin-eyebrow">SCHOOL CONFIGURATION</p>
            <h1>School settings</h1>
            <p className="admin-muted">Manage the school identity, contact details, and regional preferences.</p>
          </div>
      </div>
      {error && <p className="admin-alert" role="alert">{error}</p>}
      {message && <p className="admin-success" role="status">{message}</p>}
      {loading && <p className="admin-muted" aria-live="polite">Loading settings…</p>}
      {settings && (
          <form className="admin-form-card" onSubmit={saveSettings}>
            <label>
              School name
              <input
                required
                maxLength={500}
                value={settings.school_name}
                onChange={(event) => setSettings({ ...settings, school_name: event.target.value })}
              />
            </label>
            <label>
              Contact email
              <input
                type="email"
                maxLength={500}
                value={settings.contact_email}
                onChange={(event) => setSettings({ ...settings, contact_email: event.target.value })}
              />
            </label>
            <label>
              Contact phone
              <input
                maxLength={500}
                value={settings.contact_phone}
                onChange={(event) => setSettings({ ...settings, contact_phone: event.target.value })}
              />
            </label>
            <label>
              School address
              <textarea
                rows={3}
                maxLength={500}
                value={settings.address}
                onChange={(event) => setSettings({ ...settings, address: event.target.value })}
              />
            </label>
            <label>
              Default language
              <select
                value={settings.default_language}
                onChange={(event) => setSettings({ ...settings, default_language: event.target.value })}
              >
                <option value="en">English</option>
                <option value="rw">Kinyarwanda</option>
              </select>
            </label>
            <label>
              Supported languages
              <input
                required
                value={settings.supported_languages}
                onChange={(event) => setSettings({ ...settings, supported_languages: event.target.value })}
                aria-describedby="supported-languages-hint"
              />
              <small id="supported-languages-hint">Comma-separated language codes: en, rw</small>
            </label>
            <label>
              Timezone
              <input
                required
                value={settings.timezone}
                onChange={(event) => setSettings({ ...settings, timezone: event.target.value })}
              />
            </label>
            <label>
              Currency
              <input
                required
                maxLength={3}
                value={settings.currency}
                onChange={(event) => setSettings({ ...settings, currency: event.target.value.toUpperCase() })}
              />
            </label>
            <div className="admin-form-actions">
              <button className="admin-primary-button" disabled={saving} type="submit">
                {saving ? 'Saving…' : 'Save settings'}
              </button>
            </div>
          </form>
      )}
    </>
  )
}

function AnnouncementsPanel({ token }: { token: string }) {
  const emptyForm = { title: '', message: '', audience: 'all', isPublished: false }
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function loadAnnouncements() {
    const result = await request<{ announcements: Announcement[] }>('/api/admin/announcements', token)
    setAnnouncements(result.announcements)
  }

  useEffect(() => {
    let active = true
    request<{ announcements: Announcement[] }>('/api/admin/announcements', token)
      .then(({ announcements: result }) => {
          if (active) setAnnouncements(result)
      })
      .catch((reason: unknown) => {
          if (active) setError(reason instanceof Error ? reason.message : 'Unable to load announcements')
      })
      .finally(() => {
          if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [token])

  async function saveAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const editing = editingId !== null
      const result = await request(
          editing ? `/api/admin/announcements/${editingId}` : '/api/admin/announcements',
          token,
          {
            method: editing ? 'PATCH' : 'POST',
            body: JSON.stringify(form),
          },
      )
      await loadAnnouncements()
      setForm(emptyForm)
      setEditingId(null)
      setMessage(result.message ?? (editing ? 'Announcement updated' : 'Announcement created'))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save announcement')
    } finally {
      setSaving(false)
    }
  }

  async function deleteAnnouncement(announcement: Announcement) {
    if (!window.confirm(`Delete “${announcement.title}”? This cannot be undone.`)) return

    setError('')
    setMessage('')
    try {
      const result = await request(`/api/admin/announcements/${announcement.id}`, token, {
          method: 'DELETE',
      })
      setAnnouncements((current) => current.filter((item) => item.id !== announcement.id))
      setMessage(result.message ?? 'Announcement deleted')
      if (editingId === announcement.id) {
          setEditingId(null)
          setForm(emptyForm)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to delete announcement')
    }
  }

  function editAnnouncement(announcement: Announcement) {
    setEditingId(announcement.id)
    setForm({
      title: announcement.title,
      message: announcement.message,
      audience: announcement.audience,
      isPublished: announcement.isPublished === true || announcement.isPublished === 1,
    })
    setError('')
    setMessage('')
  }

  return (
    <>
      <div className="admin-page-heading">
          <div>
            <p className="admin-eyebrow">SCHOOL COMMUNICATION</p>
            <h1>Announcements</h1>
            <p className="admin-muted">Draft, publish, and manage updates for the school community.</p>
          </div>
      </div>
      {error && <p className="admin-alert" role="alert">{error}</p>}
      {message && <p className="admin-success" role="status">{message}</p>}

      <form className="admin-form-card announcement-form" onSubmit={saveAnnouncement}>
          <div className="admin-table-heading">
            <div>
              <h2>{editingId ? 'Edit announcement' : 'New announcement'}</h2>
              <p>Published announcements are visible to their selected audience.</p>
            </div>
            {editingId !== null && (
              <button
                className="admin-quiet-button"
                type="button"
                onClick={() => {
                  setEditingId(null)
                  setForm(emptyForm)
                }}
              >
                Cancel edit
              </button>
            )}
          </div>
          <label>
            Title
            <input
              required
              maxLength={200}
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
            />
          </label>
          <label>
            Message
            <textarea
              required
              rows={5}
              maxLength={10000}
              value={form.message}
              onChange={(event) => setForm({ ...form, message: event.target.value })}
            />
          </label>
          <label>
            Audience
            <select
              value={form.audience}
              onChange={(event) => setForm({ ...form, audience: event.target.value })}
            >
              <option value="all">Everyone</option>
              <option value="students">Students</option>
              <option value="parents">Parents</option>
              <option value="teachers">Teachers</option>
              <option value="staff">Staff</option>
            </select>
          </label>
          <label className="admin-checkbox-label">
            <input
              type="checkbox"
              checked={form.isPublished}
              onChange={(event) => setForm({ ...form, isPublished: event.target.checked })}
            />
            Publish immediately
          </label>
          <div className="admin-form-actions">
            <button className="admin-primary-button" disabled={saving} type="submit">
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create announcement'}
            </button>
          </div>
      </form>

      <section className="admin-table-card admin-list-card">
          <div className="admin-table-heading">
            <div>
              <h2>All announcements</h2>
              <p>Drafts are saved for administrators and are not published to the public site.</p>
            </div>
            {loading && <span className="admin-muted" aria-live="polite">Loading…</span>}
          </div>
          <div className="admin-announcement-list">
            {!loading && announcements.length === 0 && (
              <p className="admin-empty">No announcements yet.</p>
            )}
            {announcements.map((announcement) => (
              <article className="admin-announcement-item" key={announcement.id}>
                <div className="admin-announcement-header">
                  <div>
                    <span className={`admin-status ${announcement.isPublished ? 'is-active' : 'is-inactive'}`}>
                      {announcement.isPublished ? 'Published' : 'Draft'}
                    </span>
                    <span className="admin-audience">{announcement.audience}</span>
                  </div>
                  <div className="admin-row-actions">
                    <button className="admin-quiet-button" type="button" onClick={() => editAnnouncement(announcement)}>
                      Edit
                    </button>
                    <button className="admin-quiet-button danger-button" type="button" onClick={() => void deleteAnnouncement(announcement)}>
                      Delete
                    </button>
                  </div>
                </div>
                <h3>{announcement.title}</h3>
                <p>{announcement.message}</p>
                <small className="admin-cell-secondary">
                  Created {formatDate(announcement.createdAt)}
                  {announcement.createdBy ? ` by ${announcement.createdBy}` : ''}
                </small>
              </article>
            ))}
          </div>
      </section>
    </>
  )
}

function ActivityPanel({ token }: { token: string }) {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    request<{ logs: AuditLog[] }>('/api/admin/audit-logs?limit=50', token)
      .then(({ logs: results }) => {
          if (active) setLogs(results)
      })
      .catch((reason: unknown) => {
          if (active) setError(reason instanceof Error ? reason.message : 'Unable to load activity')
      })
      .finally(() => {
          if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [token])

  return (
    <>
      <div className="admin-page-heading">
          <div>
            <p className="admin-eyebrow">ADMINISTRATION HISTORY</p>
            <h1>Activity log</h1>
            <p className="admin-muted">Recent account and content changes made by administrators.</p>
          </div>
      </div>
      {error && <p className="admin-alert" role="alert">{error}</p>}
      <section className="admin-table-card">
          <div className="admin-table-heading">
            <div><h2>Recent activity</h2><p>Showing the latest 50 recorded events.</p></div>
            {loading && <span className="admin-muted" aria-live="polite">Loading…</span>}
          </div>
          <div className="admin-activity-list">
            {!loading && logs.length === 0 && <p className="admin-empty">No activity recorded yet.</p>}
            {logs.map((log) => (
              <article className="admin-activity-item" key={log.id}>
                <span className="admin-activity-dot" aria-hidden="true" />
                <div>
                  <strong>{log.action.replaceAll('_', ' ')}</strong>
                  <p>{log.actor ?? 'System'}{log.entityType ? ` · ${log.entityType}` : ''}{log.entityId ? ` #${log.entityId}` : ''}</p>
                </div>
                <time dateTime={log.createdAt}>{formatDate(log.createdAt)}</time>
              </article>
            ))}
          </div>
      </section>
    </>
  )
}
