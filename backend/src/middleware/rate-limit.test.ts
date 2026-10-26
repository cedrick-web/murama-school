import assert from 'node:assert/strict'
import test from 'node:test'
import { createRateLimiter } from './rate-limit.js'

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
