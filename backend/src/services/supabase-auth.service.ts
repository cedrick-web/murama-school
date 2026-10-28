export interface VerifiedGoogleIdentity {
  id: string
  email: string
  displayName: string
  avatarUrl: string | null
}

interface SupabaseIdentity {
  provider?: unknown
  identity_data?: { email?: unknown; email_verified?: unknown }
}

interface SupabaseUserResponse {
  id?: unknown
  email?: unknown
  email_confirmed_at?: unknown
  is_anonymous?: unknown
  user_metadata?: Record<string, unknown>
  identities?: SupabaseIdentity[]
}

export class SupabaseAuthConfigurationError extends Error {
  constructor() {
    super('Supabase Google authentication is not configured on the server')
    this.name = 'SupabaseAuthConfigurationError'
  }
}

/** Verify with Supabase, then bind the school email to the verified Google identity. */
export async function verifyGoogleAccessToken(accessToken: string): Promise<VerifiedGoogleIdentity | null> {
  const supabaseUrl = process.env.SUPABASE_URL?.trim().replace(/\/+$/, '')
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim()
  if (!supabaseUrl || !publishableKey) throw new SupabaseAuthConfigurationError()

  const response = await fetch(supabaseUrl + '/auth/v1/user', {
    method: 'GET',
    headers: { apikey: publishableKey, Authorization: 'Bearer ' + accessToken },
    signal: AbortSignal.timeout(10_000),
  })
  if (response.status === 401 || response.status === 403) return null
  if (!response.ok) throw new Error('Supabase user verification failed with status ' + response.status)

  const user = await response.json() as SupabaseUserResponse | null
  if (
    !user
    || typeof user.id !== 'string' || !user.id.trim()
    || typeof user.email !== 'string' || !user.email.trim()
    || typeof user.email_confirmed_at !== 'string' || !user.email_confirmed_at.trim()
    || user.is_anonymous === true
    || !Array.isArray(user.identities)
  ) return null

  const email = user.email.trim().toLowerCase()
  // A linked Google identity alone does not prove ownership of the account's
  // primary email. Require Google's own verified email to match the school email.
  const verifiedIdentity = user.identities.some((identity) => (
    identity?.provider === 'google'
    && identity.identity_data?.email_verified === true
    && typeof identity.identity_data.email === 'string'
    && identity.identity_data.email.trim().toLowerCase() === email
  ))
  if (!verifiedIdentity) return null

  const metadata = user.user_metadata ?? {}
  const nameValue = metadata.full_name ?? metadata.name
  const displayName = typeof nameValue === 'string' ? nameValue.trim().slice(0, 160) : email
  const avatarValue = metadata.avatar_url ?? metadata.picture
  const avatarUrl = typeof avatarValue === 'string' && /^https:\/\//i.test(avatarValue)
    ? avatarValue.slice(0, 1000)
    : null

  return { id: user.id, email, displayName: displayName || email, avatarUrl }
}
