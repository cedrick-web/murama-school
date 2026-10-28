import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import test, { type TestContext } from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'

import { pool, type PoolConnection } from '../config/database.js'
import type { UserRole } from '../types/auth.js'
import portalRoutes from './portal.routes.js'

const secret = 'portal-route-test-secret-at-least-32-characters'
process.env.JWT_SECRET = secret

type Execute = typeof pool.execute

async function harness(t: TestContext, role: UserRole, execute: Execute, connection?: PoolConnection) {
  // All database calls are mocked; these checks never access school records.
  t.mock.method(pool, 'execute', async (sql: string, values: readonly unknown[] = []) => {
    if (sql.includes('u.is_active, r.name AS role')) {
      return [[{ id: 7, first_name: 'Test', last_name: 'User', email: 'test@example.test', phone: null, is_active: true, role }], undefined]
    }
    return execute(sql, values)
  })
  if (connection) t.mock.method(pool, 'getConnection', async () => connection)
  const app = express()
  app.use(express.json())
  app.use('/api/portal', portalRoutes)
  const server = createServer(app)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  }))
  const token = jwt.sign({ userId: 7, role }, secret)
  return (path: string, method = 'GET', body?: unknown) => fetch(
    `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/portal${path}`,
    { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) },
  )
}

for (const method of ['POST', 'PATCH']) {
  test(`${method} notification-read preserves ownership and supports both clients`, async (t) => {
    const queries: Array<{ sql: string; values: readonly unknown[] }> = []
    const request = await harness(t, 'STUDENT', async (sql, values = []) => {
      queries.push({ sql, values })
      return [sql.startsWith('SELECT') ? [{ id: 12 }] : { affectedRows: 1 }, undefined]
    })
    const response = await request('/notifications/12/read', method)
    assert.equal(response.status, 200)
    assert.equal(queries.length, 2)
    for (const query of queries) {
      assert.match(query.sql, /id = \? AND user_id = \?/)
      assert.deepEqual(query.values, [12, 7])
    }
  })

  test(`${method} notification-read denies unowned records without an update`, async (t) => {
    const request = await harness(t, 'PARENT', async (sql) => {
      assert.ok(sql.startsWith('SELECT'), 'must not write an unowned notification')
      return [[], undefined]
    })
    assert.equal((await request('/notifications/99/read', method)).status, 404)
  })
}

test('legacy workspace overview is account-scoped and excludes draft report cards', async (t) => {
  let reportQuerySeen = false
  const request = await harness(t, 'STUDENT', async (sql, values = []) => {
    if (sql === 'SELECT id FROM students WHERE user_id = ? LIMIT 1') {
      assert.deepEqual(values, [7])
      return [[{ id: 21 }], undefined]
    }
    if (sql.includes('FROM report_cards r')) {
      reportQuerySeen = true
      assert.match(sql, /r.generated_at IS NOT NULL/)
      assert.deepEqual(values, [[21]])
    }
    return [[], undefined]
  })
  const response = await request('/overview')
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.overview.role, 'STUDENT')
  for (const key of ['students', 'announcements', 'notifications', 'messages', 'attendance', 'reportCards', 'fees', 'timetable']) {
    assert.ok(Array.isArray(result.overview[key]), `${key} must preserve the workspace response shape`)
  }
  assert.equal(reportQuerySeen, true)
})

test('parent detail routes deny an unlinked child before reading academic records', async (t) => {
  const request = await harness(t, 'PARENT', async (sql, values = []) => {
    assert.match(sql, /FROM parents p INNER JOIN student_parents/)
    assert.deepEqual(values, [7, 99])
    return [[], undefined]
  })
  assert.equal((await request('/parent/children/99/results')).status, 404)
})

test('student detail routes retain own-profile resolution', async (t) => {
  const request = await harness(t, 'STUDENT', async (sql, values = []) => {
    if (sql === 'SELECT id FROM students WHERE user_id = ? LIMIT 1') return [[{ id: 21 }], undefined]
    assert.match(sql, /WHERE s.id = \?/)
    assert.deepEqual(values, ['ACTIVE', 21])
    return [[{ studentId: 21, firstName: 'Test' }], undefined]
  })
  const response = await request('/student/overview')
  assert.equal(response.status, 200)
  assert.equal((await response.json()).student.studentId, 21)
})

test('student routes reject staff before issuing student queries', async (t) => {
  const request = await harness(t, 'STAFF', async () => assert.fail('Wrong role must not query student records'))
  assert.equal((await request('/student/overview')).status, 403)
})

test('message-read keeps recipient ownership for the legacy client', async (t) => {
  const request = await harness(t, 'STAFF', async (sql, values = []) => {
    assert.deepEqual(values, [13, 7])
    assert.match(sql, /message_id = \? AND recipient_user_id = \?/)
    return [sql.startsWith('SELECT') ? [{ message_id: 13 }] : { affectedRows: 1 }, undefined]
  })
  assert.equal((await request('/messages/13/read', 'POST')).status, 200)
})

function transaction(execute: Execute) {
  const calls = { committed: 0, rolledBack: 0, released: 0 }
  const connection: PoolConnection = {
    execute,
    async beginTransaction() {},
    async commit() { calls.committed += 1 },
    async rollback() { calls.rolledBack += 1 },
    release() { calls.released += 1 },
  }
  return { connection, calls }
}
const attendanceBody = { classId: 3, termId: 4, date: '2026-10-28', records: [{ studentId: 21, status: 'PRESENT' }] }
const currentTerm = { academicYearId: 1, startsOn: '2026-09-01', endsOn: '2026-12-31' }

test('legacy attendance cannot bypass teacher assignment checks', async (t) => {
  const tx = transaction(async (sql) => {
    if (sql.includes('FROM terms')) return [[currentTerm], undefined]
    if (sql.includes('FROM teachers')) return [[{ id: 2 }], undefined]
    assert.match(sql, /FROM teacher_subjects/)
    return [[], undefined]
  })
  const request = await harness(t, 'TEACHER', async () => {
    assert.fail('Use the reserved connection for teacher lookup to avoid exhausting a serverless pool of size one')
  }, tx.connection)
  assert.equal((await request('/attendance', 'POST', attendanceBody)).status, 403)
  assert.deepEqual(tx.calls, { committed: 0, rolledBack: 1, released: 1 })
})

test('legacy attendance rejects students not enrolled in the selected class and term', async (t) => {
  const tx = transaction(async (sql) => {
    if (sql.includes('FROM terms')) return [[currentTerm], undefined]
    assert.match(sql, /FROM student_enrollments/)
    return [[], undefined]
  })
  const request = await harness(t, 'ADMIN', async () => assert.fail('Unexpected nontransactional query'), tx.connection)
  assert.equal((await request('/attendance', 'POST', attendanceBody)).status, 400)
  assert.deepEqual(tx.calls, { committed: 0, rolledBack: 1, released: 1 })
})

test('legacy attendance rejects dates outside the selected current-year term', async (t) => {
  const tx = transaction(async (sql) => {
    assert.match(sql, /ay.is_current = TRUE.*FOR UPDATE/)
    return [[currentTerm], undefined]
  })
  const request = await harness(t, 'ADMIN', async () => assert.fail('Unexpected nontransactional query'), tx.connection)
  assert.equal((await request('/attendance', 'POST', { ...attendanceBody, date: '2026-08-01' })).status, 400)
  assert.equal(tx.calls.committed, 0)
})

test('legacy attendance preserves the saved-count contract and transactional audit', async (t) => {
  const writes: string[] = []
  const tx = transaction(async (sql) => {
    if (sql.includes('FROM terms')) return [[currentTerm], undefined]
    if (sql.includes('FROM student_enrollments')) return [[{ id: 1 }], undefined]
    writes.push(sql)
    return [{ affectedRows: 1 }, undefined]
  })
  const request = await harness(t, 'HEADTEACHER', async () => assert.fail('Unexpected nontransactional query'), tx.connection)
  const response = await request('/attendance', 'POST', attendanceBody)
  assert.equal(response.status, 200)
  assert.equal((await response.json()).saved, 1)
  assert.equal(writes.length, 2)
  assert.match(writes[0], /class_id = VALUES\(class_id\), term_id = VALUES\(term_id\)/)
  assert.match(writes[1], /INSERT INTO audit_logs/)
  assert.deepEqual(tx.calls, { committed: 1, rolledBack: 0, released: 1 })
})
