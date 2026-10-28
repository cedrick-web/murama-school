import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import test, { type TestContext } from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'
import { pool, type PoolConnection } from '../config/database.js'
import type { UserRole } from '../types/auth.js'
import adminRoutes from './admin.routes.js'

const secret = 'admin-authorization-test-secret-at-least-32-characters'
process.env.JWT_SECRET = secret

async function harness(t: TestContext, actorRole: UserRole, targetRole: UserRole = 'ADMIN', targetId = 8) {
  const writes: string[] = []
  let committed = 0
  let released = 0
  t.mock.method(pool, 'execute', async (sql: string) => {
    assert.match(sql, /FROM users u/)
    return [[{ id: 7, first_name: 'Test', last_name: 'Actor', email: 'actor@example.test', phone: null, role: actorRole, is_active: true }], undefined]
  })
  const connection: PoolConnection = {
    async beginTransaction() {}, async commit() { committed++ }, async rollback() {}, release() { released++ },
    async execute(sql, values = []) {
      if (sql.startsWith('SELECT id, name FROM roles')) return [[{ id: values[0] === 'ADMIN' ? 1 : 3, name: values[0] }], undefined]
      if (sql.includes('FROM users u')) return [[{ id: targetId, role: targetRole, roleId: targetRole === 'ADMIN' ? 1 : 2, isActive: true }], undefined]
      if (sql.startsWith('SELECT id FROM roles')) return [[{ id: 1 }], undefined]
      if (sql.startsWith('SELECT COUNT(*)')) return [[{ count: 1 }], undefined]
      writes.push(sql)
      return [{ affectedRows: 1 }, undefined]
    },
  }
  t.mock.method(pool, 'getConnection', async () => connection)
  const app = express()
  app.use(express.json())
  app.use('/api/admin', adminRoutes)
  const server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve, reject) => {
    server.closeAllConnections()
    server.close((error) => error ? reject(error) : resolve())
  }))
  const token = jwt.sign({ userId: 7, role: actorRole }, secret)
  const patch = (action: string, body: unknown) => fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin/users/${targetId}/${action}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
  })
  return { patch, writes, get committed() { return committed }, get released() { return released } }
}

const actions = [
  { action: 'role', body: { role: 'TEACHER' } },
  { action: 'status', body: { isActive: false } },
  { action: 'password', body: { password: 'Dedicated test password 123!' } },
]
for (const { action, body } of actions) {
  test(`headteacher cannot change an administrator's ${action}`, async (t) => {
    const h = await harness(t, 'HEADTEACHER')
    assert.equal((await h.patch(action, body)).status, 403)
    assert.deepEqual(h.writes, [])
    assert.equal(h.released, 1)
  })
  test(`administrator can manage another administrator's ${action}`, async (t) => {
    const h = await harness(t, 'ADMIN')
    assert.equal((await h.patch(action, body)).status, 200)
    assert.ok(h.writes.some((sql) => sql.startsWith('UPDATE users')))
    assert.ok(h.writes.some((sql) => sql.startsWith('INSERT INTO audit_logs')))
    assert.equal(h.committed, 1)
    assert.equal(h.released, 1)
  })
  test(`headteacher retains permitted ${action} management for non-administrator accounts`, async (t) => {
    const h = await harness(t, 'HEADTEACHER', 'STUDENT')
    assert.equal((await h.patch(action, body)).status, 200)
    assert.ok(h.writes.some((sql) => sql.startsWith('UPDATE users')))
  })
}

test('headteacher cannot promote themselves to administrator', async (t) => {
  const h = await harness(t, 'HEADTEACHER', 'HEADTEACHER', 7)
  assert.equal((await h.patch('role', { role: 'ADMIN' })).status, 403)
  assert.deepEqual(h.writes, [])
})

test('headteacher cannot promote another school account to administrator', async (t) => {
  const h = await harness(t, 'HEADTEACHER', 'STUDENT')
  assert.equal((await h.patch('role', { role: 'ADMIN' })).status, 403)
  assert.deepEqual(h.writes, [])
})

for (const role of ['TEACHER', 'STAFF', 'PARENT', 'STUDENT'] as const) {
  test(`${role} cannot use administrator account-management endpoints`, async (t) => {
    const h = await harness(t, role)
    assert.equal((await h.patch('role', { role: 'ADMIN' })).status, 403)
    assert.deepEqual(h.writes, [])
  })
}
