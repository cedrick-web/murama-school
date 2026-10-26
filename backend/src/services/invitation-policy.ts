export interface InvitationState {
  expiresAt?: unknown
  acceptedAt?: unknown
  revokedAt?: unknown
  isActive?: unknown
  role?: unknown
}

export function isInvitationUsable(invitation: InvitationState, now = Date.now()): boolean {
  const expiry = new Date(String(invitation.expiresAt)).getTime()
  return !invitation.acceptedAt
    && !invitation.revokedAt
    && Number.isFinite(expiry)
    && expiry > now
    && !Boolean(invitation.isActive)
    && ['STUDENT', 'PARENT', 'TEACHER'].includes(String(invitation.role))
}
