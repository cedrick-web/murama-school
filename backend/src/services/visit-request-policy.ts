export type VisitType = 'PARENT' | 'STUDENT' | 'PROSPECTIVE_PARENT' | 'OTHER'

export interface ValidVisitRequest {
  fullName: string
  email: string | null
  phone: string | null
  visitorType: VisitType
  preferredDate: string
  preferredTime: string | null
  purpose: string
}

function dateInRwanda(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Kigali',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''
  return part('year') + '-' + part('month') + '-' + part('day')
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T00:00:00.000Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/** Validate and normalize untrusted public visit-form input before any database write. */
export function validateVisitRequest(input: Record<string, unknown>, now = new Date()): ValidVisitRequest | null {
  const fullName = typeof input.fullName === 'string' ? input.fullName.trim() : ''
  const emailInput = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  const phoneInput = typeof input.phone === 'string' ? input.phone.trim() : ''
  const visitorType = typeof input.visitorType === 'string' ? input.visitorType.trim().toUpperCase() : 'OTHER'
  const preferredDate = input.preferredDate
  const rawTime = input.preferredTime
  const preferredTime = rawTime === '' || rawTime === null || rawTime === undefined ? null : rawTime
  const purpose = typeof input.purpose === 'string' ? input.purpose.trim() : ''

  if (
    fullName.length < 2 || fullName.length > 120
    || (!emailInput && !phoneInput)
    || (emailInput && (emailInput.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput)))
    || (phoneInput && (phoneInput.length > 40 || phoneInput.replace(/\D/g, '').length < 7))
    || !['PARENT', 'STUDENT', 'PROSPECTIVE_PARENT', 'OTHER'].includes(visitorType)
    || !isCalendarDate(preferredDate)
    || preferredDate < dateInRwanda(now)
    || (preferredTime !== null && (typeof preferredTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(preferredTime)))
    || purpose.length < 10 || purpose.length > 3000
  ) return null

  return {
    fullName,
    email: emailInput || null,
    phone: phoneInput || null,
    visitorType: visitorType as VisitType,
    preferredDate,
    preferredTime: preferredTime as string | null,
    purpose,
  }
}
