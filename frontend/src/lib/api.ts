export const API_BASE = (import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? '' : 'http://localhost:5000')).replace(/\/+$/, '')

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

interface Envelope {
  success?: boolean
  message?: string
}

export async function api<T>(
  path: string,
  options: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const { token, headers, ...rest } = options
  const response = await fetch(API_BASE + path, {
    ...rest,
    headers: {
      ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...headers,
    },
  })
  const body = await response.json().catch(() => null) as (Envelope & Record<string, unknown>) | null
  if (!response.ok || !body || body.success !== true) {
    throw new ApiError(body?.message ?? ('Request failed (' + response.status + ')'), response.status)
  }
  return body as T
}
