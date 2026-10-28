import { FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { homePathFor, useAuth } from '@/lib/auth'
import { cleanGoogleCallbackUrl, finishGoogleSignIn, getGoogleCallbackError, restoreGooglePortalSession, startGoogleSignIn } from '@/lib/supabase-auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function SignInPage() {
  const { user, status, error, setError, signInWithPassword, completeSession } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  const [oauthProcessing, setOauthProcessing] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return params.has('code') || params.has('error')
  })

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const callbackError = getGoogleCallbackError()
    if (!code && !callbackError) return
    cleanGoogleCallbackUrl()
    setOauthProcessing(true)
    if (!code) {
      setError(callbackError ?? 'Google sign-in was cancelled.')
      setOauthProcessing(false)
      return
    }
    finishGoogleSignIn(code)
      .then(async (result) => {
        const portalPath = restoreGooglePortalSession(result.user, result.token)
        if (portalPath) {
          window.location.replace(portalPath)
          return
        }
        await completeSession(result.token)
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'Unable to finish Google sign-in')
      })
      .finally(() => setOauthProcessing(false))
  }, [completeSession, setError])

  useEffect(() => {
    if (!oauthProcessing && status === 'ready' && user) navigate(homePathFor(user.role), { replace: true })
  }, [status, user, navigate, oauthProcessing])

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await signInWithPassword(email, password)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to sign in')
    } finally {
      setBusy(false)
    }
  }

  async function onGoogle() {
    setGoogleBusy(true)
    setError('')
    try {
      await startGoogleSignIn()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to start Google sign-in')
      setGoogleBusy(false)
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="hidden bg-[#123524] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <Link to="/" className="text-sm text-white/70">← Back to the public site</Link>
        <div>
          <p className="text-xs tracking-[0.2em] text-accent">ECOLE SECONDAIRE DE MURAMA</p>
          <h1 className="mt-4 max-w-md text-4xl font-semibold">The school workspace for staff, families and students.</h1>
          <p className="mt-4 max-w-md text-white/70">Sign in with an active school account. Access is determined by the role stored in the school database, not by Google alone.</p>
        </div>
        <p className="text-sm text-white/50">Protected by school JWT sessions and Supabase identity verification.</p>
      </section>
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-3xl border bg-card p-8 shadow-sm">
          <Link to="/" className="mb-6 inline-block text-sm text-muted-foreground lg:hidden">← Murama School</Link>
          <h2 className="text-2xl font-semibold">Sign in</h2>
          <p className="mt-1 text-sm text-muted-foreground">Use your school email and password, or a linked Google account.</p>
          {(oauthProcessing || status === 'checking') && <p className="mt-4 text-sm">Verifying your session…</p>}
          {error && <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-destructive" role="alert">{error}</p>}
          <Button className="mt-6 w-full" variant="outline" disabled={googleBusy || oauthProcessing} onClick={() => void onGoogle()}>
            {googleBusy ? 'Connecting to Google…' : 'Continue with Google'}
          </Button>
          <div className="my-6 h-px bg-border" />
          <form className="grid gap-4" onSubmit={(event) => void onSubmit(event)}>
            <label className="grid gap-1 text-sm font-medium">
              Email
              <Input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Password
              <Input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
            <Button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in to workspace'}</Button>
          </form>
        </div>
      </section>
    </main>
  )
}
