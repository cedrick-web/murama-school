export function formatDate(value: string | null | undefined, withTime = false): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-RW', withTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' }).format(date)
}

export function formatMoney(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const amount = Number(value)
  if (!Number.isFinite(amount)) return '—'
  return new Intl.NumberFormat('en-RW', { maximumFractionDigits: 0 }).format(amount) + ' RWF'
}

export function isTrue(value: boolean | number | null | undefined): boolean {
  return value === true || value === 1
}

export function displayName(first: string, last: string): string {
  return [first, last].filter(Boolean).join(' ').trim()
}

export function initials(first: string, last: string): string {
  return ((first[0] ?? '') + (last[0] ?? '')).toUpperCase() || 'MS'
}
