import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthUser } from '../types/auth.js'
import { listParentChildren, resolvePortalStudentId } from './student-parent-portal.service.js'

function user(role: AuthUser['role'], id = 7): AuthUser {
  return { id, firstName: 'Test', lastName: 'User', email: 'test@example.com', phone: null, role }
}

test('student portal resolves only the student linked to the authenticated account', async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const query = async (sql: string, values: unknown[]) => {
    calls.push({ sql, values })
    return [[{ id: 12 }], []]
  }

  assert.equal(await resolvePortalStudentId(query, user('STUDENT'), undefined), 12)
  assert.equal(await resolvePortalStudentId(query, user('STUDENT'), 12), 12)
  assert.equal(await resolvePortalStudentId(query, user('STUDENT'), 13), null)
  assert.deepEqual(calls[0].values, [7])
  assert.match(calls[0].sql, /WHERE user_id = \?/)
})

test('student portal returns no scope when no linked student exists', async () => {
  const query = async () => [[], []]
  assert.equal(await resolvePortalStudentId(query, user('STUDENT'), undefined), null)
})

test('parent portal verifies the parent-child relationship in the database', async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const query = async (sql: string, values: unknown[]) => {
    calls.push({ sql, values })
    return [[{ id: 22 }], []]
  }

  assert.equal(await resolvePortalStudentId(query, user('PARENT', 9), 22), 22)
  assert.equal(await resolvePortalStudentId(query, user('PARENT', 9), 23), null)
  assert.deepEqual(calls[0].values, [9, 22])
  assert.match(calls[0].sql, /sp\.parent_id = p\.id/)
  assert.match(calls[0].sql, /p\.user_id = \? AND s\.id = \?/)
})

test('parent portal does not resolve a child without a requested child ID', async () => {
  let calls = 0
  const query = async () => { calls += 1; return [[{ id: 22 }], []] }
  assert.equal(await resolvePortalStudentId(query, user('PARENT'), undefined), null)
  assert.equal(calls, 0)
})

test('staff roles cannot resolve student or parent records through portal services', async () => {
  let calls = 0
  const query = async () => { calls += 1; return [[{ id: 22 }], []] }
  for (const role of ['ADMIN', 'HEADTEACHER', 'TEACHER', 'STAFF'] as const) {
    assert.equal(await resolvePortalStudentId(query, user(role), 22), null)
  }
  assert.equal(calls, 0)
})

test('parent children listing is scoped to the authenticated parent user ID', async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const query = async (sql: string, values: unknown[]) => {
    calls.push({ sql, values })
    return [[{ studentId: 22, firstName: 'Aline' }], []]
  }

  const children = await listParentChildren(query, 9)
  assert.deepEqual(children, [{ studentId: 22, firstName: 'Aline' }])
  assert.deepEqual(call?.values, ['ACTIVE', 9])
  assert.match(call?.sql ?? '', /WHERE p\.user_id = \?/)
})
