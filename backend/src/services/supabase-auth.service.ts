export interface VerifiedGoogleIdentity {
  id: string
  email: string
  displayName: string
  avatarUrl: string | null
}

interface SupabaseUserResponse {
  id?: unknown
  email?: unknown
  email_confirmed_at?: unknown
  user_metadata?: Record<string, unknown>
  app_metadata?: Record<string, unknown>
  identities?: Array<{ provider?: unknown }>
}

export class SupabaseAuthConfigurationError extends Error {
  constructor() {
    super('Supabase Google authentication is not configured on the server')
    this.name = 'SupabaseAuthConfigurationError'
  }
}

/** Validate the token with Supabase Auth; never trust decoded, unverified claims. */
export async function verifyGoogleAccessToken(accessToken: string): Promise<VerifiedGoogleIdentity | null> {
  const supabaseUrl = process.env.SUPABASE_URL?.trim().replace(/\/+$/, '')
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim() ?? process.env.SUPABASE_ANON_KEY?.trim()
  if (!supabaseUrl || !publishableKey) throw new SupabaseAuthConfigurationError()

  const response = await fetch(supabaseUrl + '/auth/v1/user', {
    method: 'GET',
    headers: {
      apikey: publishableKey,
      Authorization: 'Bearer ' + accessToken,
    },
  })
  if (response.status === 401 || response.status === 403) return null
  if (!response.ok) throw new Error('Supabase user verification failed with status ' + response.status)

  const user = await response.json() as SupabaseUserResponse
  const provider = user.app_metadata?.provider
  const hasGoogleIdentity = Array.isArray(user.identities)
    && user.identities.some((identity) => identity.provider === 'google')

  if (
    typeof user.id !== 'string'
    || typeof user.email !== 'string'
    || !user.email.trim()
    || typeof user.email_confirmed_at !== 'string'
    || (provider !== 'google' && !hasGoogleIdentity)
  ) return null

  const metadata = user.user_metadata ?? {}
  const nameValue = metadata.full_name ?? metadata.name
  const displayName = typeof nameValue === 'string'
    ? nameValue.trim().slice(0, 160)
    : user.email
  const avatarValue = metadata.avatar_url ?? metadata.picture
  const avatarUrl = typeof avatarValue === 'string' && /^https:\/\//i.test(avatarValue)
    ? avatarValue.slice(0, 1000)
    : null

  return {
    id: user.id,
    email: user.email.trim().toLowerCase(),
    displayName: displayName || user.email,
    avatarUrl,
  }
}
