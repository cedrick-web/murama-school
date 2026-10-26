const BUCKET = 'school-media'
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024
export const ALLOWED_MEDIA_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'video/mp4',
  'video/webm',
] as const

export class StorageConfigurationError extends Error {
  constructor() {
    super('Supabase Storage is not configured on the server')
    this.name = 'StorageConfigurationError'
  }
}

export class StorageServiceError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'StorageServiceError'
  }
}

function config() {
  const baseUrl = process.env.SUPABASE_URL?.trim().replace(/\/+$/, '')
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!baseUrl || !serviceKey) throw new StorageConfigurationError()
  return { baseUrl, serviceKey }
}

function objectPathUrl(path: string): string {
  return path.split('/').map((segment) => encodeURIComponent(segment)).join('/')
}

export function publicMediaUrl(path: string): string {
  const { baseUrl } = config()
  return baseUrl + '/storage/v1/object/public/' + BUCKET + '/' + objectPathUrl(path)
}

/** Issue a short-lived upload token. The service-role key never leaves the server. */
export async function createSignedMediaUpload(path: string): Promise<string> {
  const { baseUrl, serviceKey } = config()
  const response = await fetch(
    baseUrl + '/storage/v1/object/upload/sign/' + BUCKET + '/' + objectPathUrl(path),
    {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: 'Bearer ' + serviceKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ upsert: false }),
    },
  )
  const body = await response.json().catch(() => null) as { token?: unknown; message?: unknown } | null
  if (!response.ok || typeof body?.token !== 'string' || !body.token) {
    throw new StorageServiceError(
      typeof body?.message === 'string' ? body.message : 'Supabase Storage could not create an upload token',
      response.status,
    )
  }
  return body.token
}

/** Confirm that the signed upload actually exists and matches the expected content type and size. */
export async function verifyUploadedMedia(path: string, expectedMimeType: string, expectedSize: number): Promise<boolean> {
  const { baseUrl, serviceKey } = config()
  const response = await fetch(
    baseUrl + '/storage/v1/object/info/public/' + BUCKET + '/' + objectPathUrl(path),
    {
      method: 'GET',
      headers: {
        apikey: serviceKey,
        Authorization: 'Bearer ' + serviceKey,
      },
    },
  )
  if (response.status === 404) return false
  if (!response.ok) {
    throw new StorageServiceError('Supabase Storage could not verify the uploaded media', response.status)
  }
  const body = await response.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return false
  const actualSize = Number(body.size ?? body.metadata && (body.metadata as Record<string, unknown>).size)
  const actualMime = String(body.mimetype ?? body.contentType ?? body.metadata && (body.metadata as Record<string, unknown>).mimetype ?? '').toLowerCase()
  return Number.isFinite(actualSize)
    && actualSize === expectedSize
    && actualMime === expectedMimeType.toLowerCase()
    && actualSize > 0
    && actualSize <= MAX_MEDIA_BYTES
}

export async function deleteStoredMedia(path: string): Promise<void> {
  const { baseUrl, serviceKey } = config()
  const response = await fetch(baseUrl + '/storage/v1/object/' + BUCKET, {
    method: 'DELETE',
    headers: {
      apikey: serviceKey,
      Authorization: 'Bearer ' + serviceKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prefixes: [path] }),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: unknown } | null
    throw new StorageServiceError(
      typeof body?.message === 'string' ? body.message : 'Supabase Storage could not delete the media object',
      response.status,
    )
  }
}
