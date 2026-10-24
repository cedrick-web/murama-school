export interface SchoolUser {
  id: number
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  role: 'ADMIN' | 'HEADTEACHER' | 'TEACHER' | 'STUDENT' | 'PARENT' | 'STAFF'
}

interface SupabaseTokenResponse {
  access_token?: string
}

export interface VerifiedSchoolLogin {
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

const verifierKey = 'murama-google-pkce-verifier'
const stateKey = 'murama-google-oauth-state'

function getSupabaseConfig() {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/+$/, '')
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!url || !publishableKey) {
    throw new Error('Google sign-in is not configured yet. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in frontend/.env.local.')
  }
  return { url, publishableKey }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function secureRandomToken(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))
}

async function createCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64UrlEncode(new Uint8Array(digest))
}

export async function startGoogleSignIn(): Promise<void> {
  const config = getSupabaseConfig()
  const verifier = secureRandomToken()
  const state = secureRandomToken()
  const challenge = await createCodeChallenge(verifier)
  sessionStorage.setItem(verifierKey, verifier)
  sessionStorage.setItem(stateKey, state)

  const redirectTo = new URL('/admin', window.location.origin).toString()
  const authorizeUrl = new URL(config.url + '/auth/v1/authorize')
  authorizeUrl.searchParams.set('provider', 'google')
  authorizeUrl.searchParams.set('redirect_to', redirectTo)
  authorizeUrl.searchParams.set('code_challenge', challenge)
  authorizeUrl.searchParams.set('code_challenge_method', 's256')
  authorizeUrl.searchParams.set('state', state)
  authorizeUrl.searchParams.set('scope', 'openid email profile')
  authorizeUrl.searchParams.set('apikey', config.publishableKey)
  window.location.assign(authorizeUrl.toString())
}

export async function finishGoogleSignIn(code: string, returnedState: string | null): Promise<VerifiedSchoolLogin> {
  const config = getSupabaseConfig()
  const verifier = sessionStorage.getItem(verifierKey)
  const expectedState = sessionStorage.getItem(stateKey)
  sessionStorage.removeItem(verifierKey)
  sessionStorage.removeItem(stateKey)

  if (!verifier || !expectedState || !returnedState || returnedState !== expectedState) {
    throw new Error('Google sign-in could not be verified. Please start again.')
  }

  const tokenResponse = await fetch(config.url + '/auth/v1/token?grant_type=pkce', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: config.publishableKey },
    body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
  })
  const tokenBody = await tokenResponse.json().catch(() => null) as SupabaseTokenResponse | null
  if (!tokenResponse.ok || !tokenBody?.access_token) {
    throw new Error('Supabase could not complete Google sign-in. Check the provider and redirect URL configuration.')
  }

  const apiUrl = (import.meta.env.VITE_API_URL ?? 'http://localhost:5000').replace(/\/+$/, '')
  const response = await fetch(apiUrl + '/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: tokenBody.access_token }),
  })
  const result = await response.json().catch(() => null) as VerifiedSchoolLogin | null
  if (!response.ok || !result?.success || !result.token || !result.user) {
    throw new Error(result?.message ?? 'This Google account could not be linked to an active Murama School account.')
  }

  // Optional profile sync. School roles and permissions stay in MySQL.
  try {
    const profileResponse = await fetch(config.url + '/rest/v1/profiles?on_conflict=id', {
      method: 'POST',
      headers: {
        apikey: config.publishableKey,
        Authorization: 'Bearer ' + tokenBody.access_token,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify([{
        id: result.profile.id,
        email: result.profile.email,
        display_name: result.profile.displayName,
        avatar_url: result.profile.avatarUrl,
      }]),
    })
    if (!profileResponse.ok) {
      console.warn('Murama profile sync skipped. Apply the Supabase profiles migration and check Data API access.')
    }
  } catch {
    console.warn('Murama profile sync skipped because Supabase was unreachable.')
  }

  return result
}

export function cleanGoogleCallbackUrl(): void {
  window.history.replaceState({}, document.title, '/admin')
}

export function getGoogleCallbackError(): string | null {
  const params = new URLSearchParams(window.location.search)
  return params.get('error_description') ?? params.get('error')
}
