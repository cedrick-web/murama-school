import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import test, { type TestContext } from 'node:test'
import bcrypt from 'bcryptjs'
import express from 'express'
import jwt from 'jsonwebtoken'
import { pool } from '../config/database.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import type { UserRole } from '../types/auth.js'
import authRoutes from './auth.routes.js'

const secret = 'auth-route-test-secret-with-at-least-32-characters'
process.env.JWT_SECRET = secret
const password = 'Test password only 123!'
const passwordHash = bcrypt.hashSync(password, 4)
const originalFetch = globalThis.fetch

async function harness(t: TestContext, role: UserRole = 'STUDENT') {
  const account = { id: 7, first_name: 'Test', last_name: 'Account', email: 'test@example.test', phone: null, role, is_active: true, password_hash: passwordHash }
  const state = { account, databaseUnavailable: false, providerStatus: 200, providerEmail: account.email, providerIdentityEmail: account.email, jwtConfigured: true }
  const counts = new Map<string, number>()
  const originalEnv = { secret: process.env.JWT_SECRET, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_PUBLISHABLE_KEY }
  process.env.SUPABASE_URL = 'https://auth-test.supabase.co'
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-only-public-key'
  t.after(() => {
    for (const [key, value] of Object.entries({ JWT_SECRET: originalEnv.secret, SUPABASE_URL: originalEnv.url, SUPABASE_PUBLISHABLE_KEY: originalEnv.key })) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
  t.mock.method(pool, 'execute', async (sql: string, values: readonly unknown[] = []) => {
    if (state.databaseUnavailable) throw Object.assign(new Error('Test database unavailable'), { code: 'ECONNREFUSED' })
    if (sql.startsWith('INSERT INTO rate_limit_buckets')) {
      counts.set(String(values[0]), (counts.get(String(values[0])) ?? 0) + 1)
      return [{ affectedRows: 1 }, undefined]
    }
    if (sql.includes('FROM rate_limit_buckets')) return [[{ requestCount: counts.get(String(values[0])), resetAt: new Date(Date.now() + 60_000).toISOString() }], undefined]
    if (sql.includes('FROM users')) {
      if (sql.includes('password_hash FROM')) return [account.is_active ? [{ password_hash: account.password_hash }] : [], undefined]
      const matches = sql.includes('LOWER(u.email)') ? values[0] === account.email : values[0] === account.id
      return [matches ? [account] : [], undefined]
    }
    if (sql.startsWith('UPDATE users SET password_hash')) { account.password_hash = String(values[0]); return [{ affectedRows: 1 }, undefined] }
    if (sql.startsWith('UPDATE users SET last_login_at')) return [{ affectedRows: 1 }, undefined]
    assert.fail('Unexpected SQL in isolated authentication test: ' + sql)
  })
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    if (!String(input).startsWith('https://auth-test.supabase.co/')) return originalFetch(input, init)
    return new Response(JSON.stringify({
      id: 'google-test-id', email: state.providerEmail, email_confirmed_at: '2026-10-01T00:00:00Z',
      identities: [{ provider: 'google', identity_data: { email: state.providerIdentityEmail, email_verified: true } }],
    }), { status: state.providerStatus })
  })
  const app = express()
  app.use(express.json())
  app.use('/api/auth', authRoutes)
  app.get('/api/test/admin', requireAuth, requireRole('ADMIN'), (_req, res) => res.json({ success: true }))
  const server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve, reject) => {
    server.closeAllConnections()
    server.close((error) => error ? reject(error) : resolve())
  }))
  const request = (path: string, body?: unknown, token?: string) => originalFetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  })
  return { state, request, login: () => request('/api/auth/login', { email: account.email, password }) }
}

for (const role of ['ADMIN', 'HEADTEACHER', 'TEACHER', 'STAFF', 'STUDENT', 'PARENT'] as const) {
  test(`${role} password login issues a working school token without leaking password hashes`, async (t) => {
    const { login, request } = await harness(t, role)
    const response = await login()
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.user.role, role)
    assert.equal(body.user.password_hash, undefined)
    const claims = jwt.verify(body.token, secret) as jwt.JwtPayload
    assert.equal(claims.userId, 7)
    assert.equal(claims.role, role)
    assert.equal((await request('/api/auth/me', undefined, body.token)).status, 200)
  })
}

test('password login rejects missing, incorrect, unknown and inactive credentials', async (t) => {
  const { request, state, login } = await harness(t)
  assert.equal((await request('/api/auth/login', {})).status, 400)
  assert.equal((await request('/api/auth/login', { email: state.account.email, password: 'wrong' })).status, 401)
  assert.equal((await request('/api/auth/login', { email: 'unknown@example.test', password })).status, 401)
  state.account.is_active = false
  assert.equal((await login()).status, 401)
})

test('password login normalizes email but preserves significant password whitespace', async (t) => {
  const { request, state } = await harness(t)
  state.account.password_hash = bcrypt.hashSync('  significant password  ', 4)
  assert.equal((await request('/api/auth/login', { email: ' TEST@EXAMPLE.TEST ', password: '  significant password  ' })).status, 200)
  assert.equal((await request('/api/auth/login', { email: state.account.email, password: 'significant password' })).status, 401)
})

test('existing tokens lose access after deactivation or a database role change', async (t) => {
  const { login, request, state } = await harness(t, 'ADMIN')
  const { token } = await (await login()).json()
  assert.equal((await request('/api/test/admin', undefined, token)).status, 200)
  state.account.role = 'STUDENT'
  assert.equal((await request('/api/test/admin', undefined, token)).status, 403)
  state.account.is_active = false
  assert.equal((await request('/api/auth/me', undefined, token)).status, 401)
})

test('missing, expired, tampered and unexpected-algorithm school tokens are rejected', async (t) => {
  const { request } = await harness(t)
  for (const token of [undefined, 'invalid', jwt.sign({ userId: 7, role: 'STUDENT' }, secret, { expiresIn: -1 }), jwt.sign({ userId: 7, role: 'STUDENT' }, secret, { algorithm: 'HS384' })]) {
    assert.equal((await request('/api/auth/me', undefined, token)).status, 401)
  }
})

test('shared authentication rate limit blocks excessive sign-in attempts', async (t) => {
  const { request } = await harness(t)
  for (let i = 0; i < 10; i++) assert.equal((await request('/api/auth/login', {})).status, 400)
  const response = await request('/api/auth/login', {})
  assert.equal(response.status, 429)
  assert.ok(Number(response.headers.get('Retry-After')) > 0)
})

test('authentication fails closed when the database or JWT signing configuration is unavailable', async (t) => {
  const { state, login } = await harness(t)
  state.databaseUnavailable = true
  assert.equal((await login()).status, 503)
  state.databaseUnavailable = false
  delete process.env.JWT_SECRET
  assert.equal((await login()).status, 503)
})

test('password change rejects wrong current password and verifies the new password', async (t) => {
  const { request, login, state } = await harness(t)
  const { token } = await (await login()).json()
  assert.equal((await request('/api/auth/password', { currentPassword: 'wrong', newPassword: 'Replacement password 123!' }, token)).status, 401)
  assert.equal((await request('/api/auth/password', { currentPassword: password, newPassword: 'Replacement password 123!' }, token)).status, 200)
  assert.equal((await login()).status, 401)
  assert.equal((await request('/api/auth/login', { email: state.account.email, password: 'Replacement password 123!' })).status, 200)
})

test('verified Google identity exchanges for a database-authorized school token', async (t) => {
  const { request } = await harness(t, 'TEACHER')
  const response = await request('/api/auth/google', { accessToken: 'google-test-access-token-long-enough', role: 'ADMIN' })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.user.role, 'TEACHER')
  assert.equal((await request('/api/auth/me', undefined, body.token)).status, 200)
})

test('Google sign-in rejects invalid, mismatched, unknown and inactive identities', async (t) => {
  const { request, state } = await harness(t)
  const google = () => request('/api/auth/google', { accessToken: 'google-test-access-token-long-enough' })
  assert.equal((await request('/api/auth/google', { accessToken: 'short' })).status, 400)
  state.providerStatus = 401
  assert.equal((await google()).status, 401)
  state.providerStatus = 200
  state.providerIdentityEmail = 'attacker@example.test'
  assert.equal((await google()).status, 401)
  state.providerEmail = state.providerIdentityEmail = 'unknown@example.test'
  assert.equal((await google()).status, 403)
  state.providerEmail = state.providerIdentityEmail = state.account.email
  state.account.is_active = false
  assert.equal((await google()).status, 403)
})

test('Google configuration failures return 503 instead of false upstream errors', async (t) => {
  const { request } = await harness(t)
  delete process.env.JWT_SECRET
  assert.equal((await request('/api/auth/google', { accessToken: 'google-test-access-token-long-enough' })).status, 503)
  delete process.env.SUPABASE_URL
  assert.equal((await request('/api/auth/google', { accessToken: 'google-test-access-token-long-enough' })).status, 503)
})
