import assert from 'node:assert/strict'
import test from 'node:test'
import { authorizeStudentScope } from './portal-access.js'

test('student access is scoped to the student linked to their own account', () => {
  assert.equal(authorizeStudentScope('STUDENT', 12, [], undefined), 12)
  assert.equal(authorizeStudentScope('STUDENT', 12, [], 12), 12)
  assert.equal(authorizeStudentScope('STUDENT', 12, [], 13), null)
  assert.equal(authorizeStudentScope('STUDENT', null, [], undefined), null)
})

test('parent access requires a database-verified linked child and requested ID', () => {
  assert.equal(authorizeStudentScope('PARENT', null, [21, 22], 21), 21)
  assert.equal(authorizeStudentScope('PARENT', null, [21, 22], 22), 22)
  assert.equal(authorizeStudentScope('PARENT', null, [21, 22], 23), null)
  assert.equal(authorizeStudentScope('PARENT', null, [21, 22], undefined), null)
  assert.equal(authorizeStudentScope('PARENT', null, [], 21), null)
})

test('staff roles cannot use student or parent portal scope decisions', () => {
  for (const role of ['ADMIN', 'HEADTEACHER', 'TEACHER', 'STAFF'] as const) {
    assert.equal(authorizeStudentScope(role, 12, [21], 12), null)
    assert.equal(authorizeStudentScope(role, 12, [21], 21), null)
  }
})
