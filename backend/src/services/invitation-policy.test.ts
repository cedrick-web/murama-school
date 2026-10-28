import assert from 'node:assert/strict'
import test from 'node:test'
import { isInvitationUsable } from './invitation-policy.js'

const now = Date.parse('2026-10-26T12:00:00.000Z')
const validInvitation = {
  expiresAt: '2026-10-27T12:00:00.000Z',
  acceptedAt: null,
  revokedAt: null,
  isActive: false,
  role: 'STUDENT',
}

test('allows a valid unexpired invitation for an inactive student or parent', () => {
  assert.equal(isInvitationUsable(validInvitation, now), true)
  assert.equal(isInvitationUsable({ ...validInvitation, role: 'PARENT' }, now), true)
  assert.equal(isInvitationUsable({ ...validInvitation, role: 'TEACHER' }, now), true)
})

test('rejects accepted, revoked, expired, active, or unsupported-role invitations', () => {
  assert.equal(isInvitationUsable({ ...validInvitation, acceptedAt: '2026-10-26T11:00:00Z' }, now), false)
  assert.equal(isInvitationUsable({ ...validInvitation, revokedAt: '2026-10-26T11:00:00Z' }, now), false)
  assert.equal(isInvitationUsable({ ...validInvitation, expiresAt: '2026-10-26T11:59:59Z' }, now), false)
  assert.equal(isInvitationUsable({ ...validInvitation, isActive: true }, now), false)
  assert.equal(isInvitationUsable({ ...validInvitation, role: 'ADMIN' }, now), false)
  assert.equal(isInvitationUsable({ ...validInvitation, expiresAt: 'not-a-date' }, now), false)
})
