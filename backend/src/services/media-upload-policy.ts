import { ALLOWED_MEDIA_TYPES, MAX_MEDIA_BYTES } from './supabase-storage.service.js'

export type MediaCategory = 'SCHOOL_LIFE' | 'EVENT' | 'CAMPUS' | 'ANNOUNCEMENT' | 'OTHER'
export type MediaType = 'IMAGE' | 'VIDEO'

export interface ValidMediaUpload {
  title: string
  altText: string
  description: string | null
  category: MediaCategory
  mimeType: typeof ALLOWED_MEDIA_TYPES[number]
  sizeBytes: number
  mediaType: MediaType
}

export function validateMediaUpload(input: Record<string, unknown>): ValidMediaUpload | null {
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  const altText = typeof input.altText === 'string' ? input.altText.trim() : ''
  const description = input.description === undefined || input.description === null
    ? null
    : typeof input.description === 'string' ? input.description.trim() : undefined
  const category = typeof input.category === 'string' ? input.category.trim().toUpperCase() : 'SCHOOL_LIFE'
  const mimeType = typeof input.mimeType === 'string' ? input.mimeType.trim().toLowerCase() : ''
  const sizeBytes = Number(input.sizeBytes)

  if (
    title.length < 1 || title.length > 180
    || altText.length > 300
    || description === undefined || (description !== null && description.length > 2000)
    || !['SCHOOL_LIFE', 'EVENT', 'CAMPUS', 'ANNOUNCEMENT', 'OTHER'].includes(category)
    || !ALLOWED_MEDIA_TYPES.includes(mimeType as typeof ALLOWED_MEDIA_TYPES[number])
    || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_MEDIA_BYTES
    || (mimeType.startsWith('image/') && altText.length < 1)
  ) return null

  return {
    title,
    altText,
    description,
    category: category as MediaCategory,
    mimeType: mimeType as typeof ALLOWED_MEDIA_TYPES[number],
    sizeBytes,
    mediaType: mimeType.startsWith('image/') ? 'IMAGE' : 'VIDEO',
  }
}
