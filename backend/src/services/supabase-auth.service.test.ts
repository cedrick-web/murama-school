import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { SupabaseAuthConfigurationError, verifyGoogleAccessToken } from './supabase-auth.service.js'

const identity = {
  id: 'google-user-id', email: 'Teacher@Example.test', email_confirmed_at: '2026-10-01T00:00:00Z',
  identities: [{ provider: 'google', identity_data: { email: 'teacher@example.test', email_verified: true } }],
  user_metadata: { full_name: ' Teacher Name ', avatar_url: 'https://example.test/avatar.png', role: 'ADMIN' },
}

function setup(t: TestContext, body: unknown, status = 200) {
  const original = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_PUBLISHABLE_KEY, anon: process.env.SUPABASE_ANON_KEY }
  process.env.SUPABASE_URL = 'https://test-project.supabase.co/'
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key'
  t.after(() => {
    for (const [name, value] of Object.entries({ SUPABASE_URL: original.url, SUPABASE_PUBLISHABLE_KEY: original.key, SUPABASE_ANON_KEY: original.anon })) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })
  return t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(url), 'https://test-project.supabase.co/auth/v1/user')
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer test-access-token')
    assert.ok(init?.signal, 'provider verification must be bounded by a timeout')
    return new Response(JSON.stringify(body), { status })
  })
}

test('Google verification binds the confirmed account email to the verified provider email', async (t) => {
  setup(t, identity)
  assert.deepEqual(await verifyGoogleAccessToken('test-access-token'), {
    id: 'google-user-id', email: 'teacher@example.test', displayName: 'Teacher Name', avatarUrl: 'https://example.test/avatar.png',
  })
})

for (const [name, overrides] of Object.entries({
  'unknown provider': { identities: [{ provider: 'email' }] },
  'provider metadata without an identity': { identities: [], app_metadata: { provider: 'google' } },
  'unconfirmed account email': { email_confirmed_at: '' },
  'mismatched linked Google email': { identities: [{ provider: 'google', identity_data: { email: 'attacker@example.test', email_verified: true } }] },
  'unverified Google email': { identities: [{ provider: 'google', identity_data: { email: 'teacher@example.test', email_verified: false } }] },
  'anonymous user': { is_anonymous: true },
  'missing identity': { id: '' },
})) {
  test('Google verification rejects ' + name, async (t) => {
    setup(t, { ...identity, ...overrides })
    assert.equal(await verifyGoogleAccessToken('test-access-token'), null)
  })
}

test('Google verification rejects invalid and expired provider tokens', async (t) => {
  setup(t, {}, 401)
  assert.equal(await verifyGoogleAccessToken('test-access-token'), null)
})

test('Google verification does not treat upstream failures as a verified identity', async (t) => {
  setup(t, {}, 503)
  await assert.rejects(verifyGoogleAccessToken('test-access-token'), /status 503/)
})

test('Google verification fails explicitly when the server is unconfigured', async (t) => {
  setup(t, identity)
  delete process.env.SUPABASE_URL
  await assert.rejects(verifyGoogleAccessToken('test-access-token'), SupabaseAuthConfigurationError)
})
