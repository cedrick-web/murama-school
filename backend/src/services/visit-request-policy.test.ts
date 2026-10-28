import assert from 'node:assert/strict'
import test from 'node:test'
import { validateVisitRequest } from './visit-request-policy.js'

const now = new Date('2026-10-26T10:00:00.000Z')
const valid = {
  fullName: '  Aline Uwase ',
  email: ' ALINE@example.com ',
  phone: '',
  visitorType: 'PARENT',
  preferredDate: '2026-10-27',
  preferredTime: '09:30',
  purpose: 'Discuss school enrollment and academic progress.',
}

test('normalizes a valid request and permits either email or phone contact', () => {
  assert.deepEqual(validateVisitRequest(valid, now), {
    fullName: 'Aline Uwase',
    email: 'aline@example.com',
    phone: null,
    visitorType: 'PARENT',
    preferredDate: '2026-10-27',
    preferredTime: '09:30',
    purpose: 'Discuss school enrollment and academic progress.',
  })
  const phoneOnly = validateVisitRequest({ ...valid, email: '', phone: '+250 788 123 456' }, now)
  assert.equal(phoneOnly?.email, null)
  assert.equal(phoneOnly?.phone, '+250 788 123 456')
})

test('rejects requests without a contact method or with invalid contact details', () => {
  assert.equal(validateVisitRequest({ ...valid, email: '', phone: '' }, now), null)
  assert.equal(validateVisitRequest({ ...valid, email: 'not-an-email' }, now), null)
  assert.equal(validateVisitRequest({ ...valid, email: '', phone: '123' }, now), null)
})

test('rejects invalid, past, and malformed dates or times', () => {
  assert.equal(validateVisitRequest({ ...valid, preferredDate: '2026-02-30' }, now), null)
  assert.equal(validateVisitRequest({ ...valid, preferredDate: '2026-10-25' }, now), null)
  assert.equal(validateVisitRequest({ ...valid, preferredTime: '25:80' }, now), null)
})

test('rejects unsupported visitor types and out-of-range text', () => {
  assert.equal(validateVisitRequest({ ...valid, visitorType: 'ADMIN' }, now), null)
  assert.equal(validateVisitRequest({ ...valid, fullName: 'A' }, now), null)
  assert.equal(validateVisitRequest({ ...valid, purpose: 'short' }, now), null)
  assert.equal(validateVisitRequest({ ...valid, purpose: 'x'.repeat(3001) }, now), null)
})
