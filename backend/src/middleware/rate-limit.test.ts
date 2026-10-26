import assert from 'node:assert/strict'
import test from 'node:test'
import { createDatabaseRateLimiter, createRateLimiter } from './rate-limit.js'

function makeRequest(ip = '192.0.2.10') {
  return { ip, socket: { remoteAddress: ip } }
}

function makeResponse() {
  const headers = new Map<string, string>()
  let statusCode = 200
  let body: unknown
  const response = {
    setHeader(name: string, value: string) {
      headers.set(name, value)
      return response
    },
    status(code: number) {
      statusCode = code
      return response
    },
    json(value: unknown) {
      body = value
      return response
    },
  }
  return { response, headers, get statusCode() { return statusCode }, get body() { return body } }
}

test('rate limiter allows requests up to the configured limit', () => {
  const limit = createRateLimiter(60_000, 2)
  let nextCalls = 0

  for (let index = 0; index < 2; index += 1) {
    const response = makeResponse()
    limit(makeRequest() as never, response.response as never, (() => { nextCalls += 1 }) as never)
    assert.equal(response.statusCode, 200)
    assert.equal(response.headers.get('RateLimit-Remaining'), String(1 - index))
  }

  assert.equal(nextCalls, 2)
})

test('rate limiter rejects excess requests with 429 and Retry-After', () => {
  const limit = createRateLimiter(60_000, 1)
  const next = () => assert.fail('next must not be called for a blocked request')

  limit(makeRequest() as never, makeResponse().response as never, (() => {}) as never)
  const response = makeResponse()
  limit(makeRequest() as never, response.response as never, next as never)

  assert.equal(response.statusCode, 429)
  assert.ok(Number(response.headers.get('Retry-After')) >= 1)
  assert.match(String((response.body as { message: string }).message), /Too many sign-in attempts/)
})

test('rate limiter tracks clients independently', () => {
  const limit = createRateLimiter(60_000, 1)
  const first = makeResponse()
  const second = makeResponse()

  limit(makeRequest('192.0.2.1') as never, first.response as never, (() => {}) as never)
  limit(makeRequest('192.0.2.2') as never, second.response as never, (() => {}) as never)

  assert.equal(first.statusCode, 200)
  assert.equal(second.statusCode, 200)
})
test('shared-store limiter hashes scoped client keys and blocks excess requests', async () => {
  const buckets = new Map<string, { count: number; resetAt: number }>()
  const keys: string[] = []
  const increment = async (key: string, windowMs: number) => {
    keys.push(key)
    const now = Date.now()
    const current = buckets.get(key)
    const entry = !current || current.resetAt <= now
      ? { count: 1, resetAt: now + windowMs }
      : { count: current.count + 1, resetAt: current.resetAt }
    buckets.set(key, entry)
    return entry
  }
  const limit = createDatabaseRateLimiter(60_000, 1, 'password-login', increment)
  const invoke = async () => {
    const response = makeResponse()
    let nextCalls = 0
    limit(makeRequest() as never, response.response as never, (() => { nextCalls += 1 }) as never)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    return { response, nextCalls }
  }

  const first = await invoke()
  const second = await invoke()
  assert.equal(first.response.statusCode, 200)
  assert.equal(first.nextCalls, 1)
  assert.equal(second.response.statusCode, 429)
  assert.equal(second.nextCalls, 0)
  assert.equal(keys.length, 2)
  assert.notEqual(keys[0], '192.0.2.10')
  assert.equal(keys[0].length, 64)
})

test('shared-store limiter fails closed when the shared store is unavailable', async () => {
  const limit = createDatabaseRateLimiter(60_000, 10, 'test', async () => {
    throw new Error('store unavailable')
  })
  const response = makeResponse()
  let nextCalls = 0
  const originalError = console.error
  console.error = () => {}
  try {
    limit(makeRequest() as never, response.response as never, (() => { nextCalls += 1 }) as never)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  } finally {
    console.error = originalError
  }
  assert.equal(response.statusCode, 503)
  assert.equal(nextCalls, 0)
})

test('shared-store limiter supports endpoint-specific rate-limit messages', async () => {
  let count = 0
  const limit = createDatabaseRateLimiter(
    60_000,
    1,
    'school-visit-requests',
    async (_key, windowMs) => ({ count: ++count, resetAt: Date.now() + windowMs }),
    'Too many school visit requests.',
    'School visit requests are temporarily unavailable.',
  )
  const invoke = async () => {
    const response = makeResponse()
    limit(makeRequest() as never, response.response as never, (() => {}) as never)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    return response
  }

  await invoke()
  const blocked = await invoke()
  assert.equal(blocked.statusCode, 429)
  assert.equal((blocked.body as { message: string }).message, 'Too many school visit requests.')
})
