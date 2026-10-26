import { createClient, type SupabaseClient } from '@supabase/supabase-js'

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

export async function startGoogleSignIn(): Promise<void> {
  const supabase = getSupabaseClient()
  const callbackPath = window.location.pathname.startsWith('/teacher') ? '/teacher' : window.location.pathname.startsWith('/portal') ? '/portal' : '/admin'
  const redirectTo = new URL(callbackPath, window.location.origin).toString()
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

export async function finishGoogleSignIn(code: string): Promise<VerifiedSchoolLogin> {
  if (!code.trim()) throw new Error('The Google sign-in code is missing. Please start sign-in again.')
  const supabase = getSupabaseClient()
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
  const callbackPath = window.location.pathname.startsWith('/teacher') ? '/teacher' : window.location.pathname.startsWith('/portal') ? '/portal' : '/admin'
  window.history.replaceState({}, document.title, callbackPath)
}

export function getGoogleCallbackError(): string | null {
  const params = new URLSearchParams(window.location.search)
  return params.get('error_description') ?? params.get('error')
}
