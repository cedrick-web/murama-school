import assert from 'node:assert/strict'
import test from 'node:test'
import jwt from 'jsonwebtoken'
import { createRequireAuth, requireRole, type AuthenticatedRequest } from './auth.js'
import type { AuthUser } from '../types/auth.js'

const secret = 'test-secret-with-at-least-32-characters-long'
process.env.JWT_SECRET = secret

function makeResponse() {
  let statusCode = 200
  let body: unknown
  const response = {
    status(code: number) {
      statusCode = code
      return response
    },
    json(value: unknown) {
      body = value
      return response
    },
  }
  return { response, get statusCode() { return statusCode }, get body() { return body } }
}

function makeRequest(role: string | null = 'ADMIN') {
  const token = role
    ? jwt.sign({ userId: 7, role }, secret, { expiresIn: '8h' })
    : null
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    user: undefined,
  } as unknown as AuthenticatedRequest
}

const currentStudent: AuthUser = {
  id: 7,
  firstName: 'Test',
  lastName: 'Student',
  email: 'student@example.test',
  phone: null,
  role: 'STUDENT',
}

test('authentication uses the current database role instead of a stale JWT role', async () => {
  const req = makeRequest('ADMIN')
  const res = makeResponse()
  let nextCalls = 0
  const middleware = createRequireAuth(async () => currentStudent)

  await middleware(req, res.response as never, (() => { nextCalls += 1 }) as never)

  assert.equal(nextCalls, 1)
  assert.equal(req.user?.role, 'STUDENT')

  const roleResponse = makeResponse()
  let roleNextCalls = 0
  requireRole('ADMIN')(req, roleResponse.response as never, (() => { roleNextCalls += 1 }) as never)
  assert.equal(roleResponse.statusCode, 403)
  assert.equal(roleNextCalls, 0)
})

test('authentication rejects an account that is no longer active', async () => {
  const req = makeRequest()
  const res = makeResponse()
  let nextCalls = 0

  await createRequireAuth(async () => null)(
    req,
    res.response as never,
    (() => { nextCalls += 1 }) as never,
  )

  assert.equal(res.statusCode, 401)
  assert.equal(nextCalls, 0)
  assert.match(String((res.body as { message: string }).message), /no longer active/)
})

test('authentication fails closed with 503 when the database is unavailable', async () => {
  const req = makeRequest()
  const res = makeResponse()
  let nextCalls = 0
  const databaseError = Object.assign(new Error('database unavailable'), { code: 'ECONNREFUSED' })

  await createRequireAuth(async () => { throw databaseError })(
    req,
    res.response as never,
    (() => { nextCalls += 1 }) as never,
  )

  assert.equal(res.statusCode, 503)
  assert.equal(nextCalls, 0)
})

test('authentication rejects requests without a bearer token', async () => {
  const req = makeRequest(null)
  const res = makeResponse()
  let lookupCalls = 0

  await createRequireAuth(async () => {
    lookupCalls += 1
    return currentStudent
  })(req, res.response as never, (() => {}) as never)

  assert.equal(res.statusCode, 401)
  assert.equal(lookupCalls, 0)
})

test('authentication rejects malformed signed claims before querying the database', async () => {
  for (const claims of [
    { userId: 0, role: 'STUDENT' },
    { userId: -7, role: 'STUDENT' },
    { userId: '7', role: 'STUDENT' },
    { userId: 1.5, role: 'STUDENT' },
    { userId: 7, role: 'UNKNOWN' },
    { userId: 7 },
  ]) {
    const req = makeRequest()
    req.headers.authorization = 'Bearer ' + jwt.sign(claims, secret)
    const res = makeResponse()
    let lookupCalls = 0
    await createRequireAuth(async () => {
      lookupCalls += 1
      return currentStudent
    })(req, res.response as never, (() => assert.fail('Invalid claims must not authenticate')) as never)
    assert.equal(res.statusCode, 401)
    assert.equal(lookupCalls, 0)
  }
})

test('authentication rejects tampered and expired tokens without looking up an account', async () => {
  const invalidTokens = [
    jwt.sign({ userId: 7, role: 'STUDENT' }, 'a-different-signing-secret'),
    jwt.sign({ userId: 7, role: 'STUDENT' }, secret, { expiresIn: -1 }),
    'not-a-jwt',
  ]
  for (const token of invalidTokens) {
    const req = makeRequest()
    req.headers.authorization = 'Bearer ' + token
    const res = makeResponse()
    await createRequireAuth(async () => assert.fail('Invalid tokens must not reach the database'))(
      req, res.response as never, (() => assert.fail('Invalid tokens must not authenticate')) as never,
    )
    assert.equal(res.statusCode, 401)
  }
})

test('authentication reports unavailable configuration separately from invalid credentials', async () => {
  const previous = process.env.JWT_SECRET
  const originalError = console.error
  try {
    console.error = () => {}
    for (const value of [undefined, 'too-short']) {
      if (value === undefined) delete process.env.JWT_SECRET
      else process.env.JWT_SECRET = value
      const res = makeResponse()
      await createRequireAuth(async () => assert.fail('Unconfigured auth must not query the database'))(
        makeRequest(), res.response as never, (() => assert.fail('Unconfigured auth must not authenticate')) as never,
      )
      assert.equal(res.statusCode, 503)
    }
  } finally {
    if (previous === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = previous
    console.error = originalError
  }
})
