import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { persistSchoolToken } from './school-session'

export interface SchoolUser {
  id: number
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  role: 'ADMIN' | 'HEADTEACHER' | 'TEACHER' | 'STUDENT' | 'PARENT' | 'STAFF'
}

interface VerifiedSchoolLogin {
  success: boolean
  token: string
  user: SchoolUser
  profile: {
    id: string
    email: string
    displayName: string
    avatarUrl: string | null
  }
  message?: string
}

function getSupabaseConfig() {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/+$/, '')
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!url || !publishableKey) {
    throw new Error('Google sign-in is not configured yet. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in frontend/.env.local.')
  }
  return { url, publishableKey }
}

let client: SupabaseClient | null = null

function getSupabaseClient(): SupabaseClient {
  if (client) return client
  const config = getSupabaseConfig()
  client = createClient(config.url, config.publishableKey, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: window.sessionStorage,
    },
  })
  return client
}

function profileFor(user: {
  id: string
  email?: string
  user_metadata?: Record<string, unknown>
}) {
  const metadata = user.user_metadata ?? {}
  const name = metadata.full_name ?? metadata.name
  const image = metadata.avatar_url ?? metadata.picture
  return {
    id: user.id,
    email: user.email?.trim().toLowerCase() ?? '',
    displayName: typeof name === 'string' && name.trim() ? name.trim().slice(0, 160) : user.email ?? '',
    avatarUrl: typeof image === 'string' && /^https:\/\//i.test(image) ? image.slice(0, 1000) : null,
  }
}

const googleReturnKey = 'murama-google-return-path'

export async function startGoogleSignIn(): Promise<void> {
  const supabase = getSupabaseClient()
  const portalPath = ['/admin', '/teacher', '/portal', '/staff'].find((path) => (
    window.location.pathname === path || window.location.pathname.startsWith(path + '/')
  ))
  if (portalPath) window.sessionStorage.setItem(googleReturnKey, portalPath)
  else window.sessionStorage.removeItem(googleReturnKey)
  // Keep one allow-listed callback, even when sign-in starts in a role portal.
  const redirectTo = new URL('/signin', window.location.origin).toString()
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      scopes: 'openid email profile',
      queryParams: { access_type: 'online', prompt: 'select_account' },
    },
  })
  if (error) throw new Error('Unable to start Google sign-in: ' + error.message)
}

let pendingCallback: { code: string; promise: Promise<VerifiedSchoolLogin> } | null = null

/** StrictMode and callback re-renders must not exchange a single-use PKCE code twice. */
export function finishGoogleSignIn(code: string): Promise<VerifiedSchoolLogin> {
  if (!code.trim()) return Promise.reject(new Error('The Google sign-in code is missing. Please start sign-in again.'))
  if (pendingCallback?.code === code) return pendingCallback.promise
  const promise = exchangeGoogleSession(code)
  pendingCallback = { code, promise }
  return promise
}

async function exchangeGoogleSession(code: string): Promise<VerifiedSchoolLogin> {
  const supabase = getSupabaseClient()
  try { return await verifySchoolSession(supabase, code) }
  finally {
    // Supabase is an identity handoff, not a second long-lived school session.
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    if (error) console.warn('Unable to finish local identity-session cleanup')
  }
}

async function verifySchoolSession(supabase: SupabaseClient, code: string): Promise<VerifiedSchoolLogin> {
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)
  if (error || !data.session?.access_token || !data.user) {
    throw new Error('Supabase could not complete Google sign-in. Check the provider and redirect URL configuration.')
  }

  const profile = profileFor(data.user)
  const apiUrl = (import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? '' : 'http://localhost:5000')).replace(/\/+$/, '')
  const response = await fetch(apiUrl + '/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: data.session.access_token }),
  })
  const result = await response.json().catch(() => null) as VerifiedSchoolLogin | null
  if (!response.ok || !result?.success || !result.token || !result.user) {
    throw new Error(result?.message ?? 'This Google account could not be linked to an active Murama School account.')
  }

  // This profile stores identity display metadata only; school roles and
  // access permissions come from the server's school database.
  const { error: profileError } = await supabase.from('profiles').upsert({
    id: profile.id,
    email: profile.email,
    display_name: profile.displayName,
    avatar_url: profile.avatarUrl,
  }, { onConflict: 'id' })
  if (profileError) {
    // Authorization was verified independently by the school API. A profile
    // sync problem must not turn a valid school sign-in into a fake success.
    console.warn('Murama profile sync skipped:', profileError.message)
  }

  return { ...result, profile }
}

export function cleanGoogleCallbackUrl(): void {
  window.history.replaceState({}, document.title, '/signin')
}

/** Restore only a known portal appropriate to the server-verified school role. */
export function restoreGooglePortalSession(user: SchoolUser, token: string): string | null {
  const requestedPath = window.sessionStorage.getItem(googleReturnKey)
  window.sessionStorage.removeItem(googleReturnKey)
  const allowed = requestedPath === '/admin' && ['ADMIN', 'HEADTEACHER'].includes(user.role)
    || requestedPath === '/teacher' && user.role === 'TEACHER'
    || requestedPath === '/portal' && ['STUDENT', 'PARENT'].includes(user.role)
    || requestedPath === '/staff' && ['STAFF', 'HEADTEACHER'].includes(user.role)
  if (!allowed) return null
  persistSchoolToken(token)
  return requestedPath
}

export function getGoogleCallbackError(): string | null {
  const params = new URLSearchParams(window.location.search)
  const error = params.get('error_description') ?? params.get('error')
  if (!error) return null
  if (/unsupported provider|provider is not enabled/i.test(error)) {
    return 'Google sign-in is not enabled for this Supabase project yet. In Supabase, open Authentication → Providers → Google, enable Google, and save the OAuth client ID and secret there.'
  }
  return error
}
