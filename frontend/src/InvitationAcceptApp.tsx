import { FormEvent, useEffect, useState } from 'react'
import './invitation.css'

interface InvitationInfo {
  email: string
  firstName: string
  lastName: string
  role: 'STUDENT' | 'PARENT'
  expiresAt: string
}
interface ApiResult {
  success?: boolean
  message?: string
  invitation?: InvitationInfo
  role?: string
}

const apiUrl = (import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? '' : 'http://localhost:5000')).replace(/\/$/, '')

async function sendInvitationRequest(path: string, body: Record<string, string>): Promise<ApiResult> {
  const response = await fetch(apiUrl + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const result = await response.json().catch(() => null) as ApiResult | null
  if (!response.ok || !result?.success) {
    throw new Error(result?.message ?? `Request failed (${response.status})`)
  }
  return result
}

export default function InvitationAcceptApp() {
  const [token, setToken] = useState('')
  const [invitation, setInvitation] = useState<InvitationInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [accepted, setAccepted] = useState(false)

  useEffect(() => {
    const fragment = window.location.hash.replace(/^#/, '')
    const params = new URLSearchParams(fragment)
    const invitationToken = params.get('token') ?? ''
    // Remove the one-time secret from the address bar and browser history
    // immediately; keep it only in this page's in-memory state.
    window.history.replaceState({}, document.title, '/invite')
    if (!invitationToken) {
      setError('This invitation link is missing its token. Ask the school administrator for a new invitation.')
      setLoading(false)
      return
    }
    setToken(invitationToken)
    let active = true
    sendInvitationRequest('/api/invitations/validate', { token: invitationToken })
      .then((result) => {
        if (!active) return
        setInvitation(result.invitation ?? null)
        if (!result.invitation) setError('The invitation could not be verified.')
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Unable to verify this invitation')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  async function acceptInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (password.length < 12 || password.length > 128) {
      setError('Choose a password between 12 and 128 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('The passwords do not match.')
      return
    }
    setSubmitting(true)
    try {
      await sendInvitationRequest('/api/invitations/accept', { token, password })
      setPassword('')
      setConfirmPassword('')
      setToken('')
      setAccepted(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to activate this account')
    } finally {
      setSubmitting(false)
    }
  }

  return <main className="invite-shell">
    <section className="invite-card">
      <a className="invite-brand" href="/"><span className="invite-brand-mark">M</span><span><strong>MURAMA</strong><small>DIGITAL SCHOOL</small></span></a>
      {loading ? <div className="invite-loading"><span className="invite-spinner" /><p>Verifying your secure invitation…</p></div>
        : accepted ? <div className="invite-success"><span className="invite-success-mark">✓</span><span className="invite-eyebrow">ACCOUNT ACTIVATED</span><h1>Welcome to your school portal.</h1><p>Your account is active. Sign in using the email address provided by the school and the password you just created.</p><a className="invite-primary-link" href="/portal">Continue to student & parent portal</a></div>
        : invitation ? <>
          <div className="invite-intro"><span className="invite-eyebrow">SECURE ACCOUNT SETUP</span><h1>Activate your school account.</h1><p>The school has invited you to access Murama Digital School. Create a password to finish setting up your account.</p></div>
          <div className="invite-identity"><span className="invite-avatar">{invitation.firstName.slice(0, 1)}{invitation.lastName.slice(0, 1)}</span><div><strong>{invitation.firstName} {invitation.lastName}</strong><small>{invitation.email}</small></div><span className="invite-role">{invitation.role === 'PARENT' ? 'Parent' : 'Student'}</span></div>
          {error && <p className="invite-error" role="alert">{error}</p>}
          <form className="invite-form" onSubmit={acceptInvitation}>
            <label>Create password<input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} maxLength={128} required placeholder="At least 12 characters" /><small>Use a unique password that you do not use on another website.</small></label>
            <label>Confirm password<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={12} maxLength={128} required placeholder="Enter the same password again" /></label>
            <button type="submit" disabled={submitting}>{submitting ? 'Activating account…' : 'Activate account securely'}</button>
          </form>
          <p className="invite-privacy">This link is one-time use and expires automatically. Your school role and email are set by the school, not by this form.</p>
        </> : <div className="invite-failure"><span className="invite-failure-mark">!</span><h1>Invitation unavailable</h1><p>{error || 'This invitation is invalid or has expired.'}</p><a className="invite-primary-link" href="/">Return to school website</a></div>}
      {!loading && !accepted && <a className="invite-back-link" href="/">← Back to school website</a>}
    </section>
  </main>
}
