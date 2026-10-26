import assert from 'node:assert/strict'
import test from 'node:test'
import { validateMediaUpload } from './media-upload-policy.js'

const validImage = {
  title: 'Science exhibition',
  altText: 'Students display science projects in the school hall',
  description: 'Annual science exhibition',
  category: 'EVENT',
  mimeType: 'image/jpeg',
  sizeBytes: 1024,
}

test('normalizes valid image and video metadata', () => {
  const image = validateMediaUpload({ ...validImage, title: '  Science exhibition  ' })
  assert.equal(image?.title, 'Science exhibition')
  assert.equal(image?.mediaType, 'IMAGE')
  assert.equal(image?.mimeType, 'image/jpeg')

  const video = validateMediaUpload({ ...validImage, altText: '', mimeType: 'video/mp4' })
  assert.equal(video?.mediaType, 'VIDEO')
  assert.equal(video?.altText, '')
})

test('requires accessible alt text for images', () => {
  assert.equal(validateMediaUpload({ ...validImage, altText: '   ' }), null)
})

test('rejects unsupported MIME types and invalid sizes', () => {
  assert.equal(validateMediaUpload({ ...validImage, mimeType: 'image/svg+xml' }), null)
  assert.equal(validateMediaUpload({ ...validImage, sizeBytes: 0 }), null)
  assert.equal(validateMediaUpload({ ...validImage, sizeBytes: 25 * 1024 * 1024 + 1 }), null)
  assert.equal(validateMediaUpload({ ...validImage, sizeBytes: 1.5 }), null)
})

test('rejects invalid categories and oversized metadata', () => {
  assert.equal(validateMediaUpload({ ...validImage, category: 'PRIVATE' }), null)
  assert.equal(validateMediaUpload({ ...validImage, title: ' ' }), null)
  assert.equal(validateMediaUpload({ ...validImage, description: 'x'.repeat(2001) }), null)
  assert.equal(validateMediaUpload({ ...validImage, altText: 'x'.repeat(301) }), null)
})
