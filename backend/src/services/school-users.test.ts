import assert from 'node:assert/strict'
import test from 'node:test'
import { parsePassword } from './school-users.js'

test('password validation preserves intentional leading and trailing spaces', () => {
  const password = '  valid password  '
  assert.equal(parsePassword(password), password)
})

test('password validation rejects short, oversized and whitespace-only values', () => {
  assert.equal(parsePassword('short'), null)
  assert.equal(parsePassword(' '.repeat(10)), null)
  assert.equal(parsePassword('x'.repeat(129)), null)
})
