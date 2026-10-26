import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createSignedMediaReadUrl,
  createSignedMediaUpload,
  deleteStoredMedia,
  StorageConfigurationError,
  verifyUploadedMedia,
} from './supabase-storage.service.js'

const originalFetch = globalThis.fetch
const originalUrl = process.env.SUPABASE_URL
const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

function configureStorage() {
  process.env.SUPABASE_URL = 'https://example-project.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-server-secret'
}

function restoreStorage() {
  globalThis.fetch = originalFetch
  if (originalUrl === undefined) delete process.env.SUPABASE_URL
  else process.env.SUPABASE_URL = originalUrl
  if (originalServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey
}

test('signed upload tokens are requested server-side without exposing service credentials in the URL', async () => {
  configureStorage()
  let requestUrl = ''
  let requestInit: RequestInit | undefined
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestUrl = String(input)
    requestInit = init
    return new Response(JSON.stringify({ token: 'signed-upload-token' }), { status: 200 })
  }) as typeof fetch
  try {
    const token = await createSignedMediaUpload('2026/item/photo.jpg')
    assert.equal(token, 'signed-upload-token')
    assert.match(requestUrl, /object\/upload\/sign\/school-media\/2026\/item\/photo\.jpg$/)
    assert.equal(new URL(requestUrl).search, '')
    assert.equal((requestInit?.headers as Record<string, string>).Authorization, 'Bearer test-only-server-secret')
    assert.equal(requestInit?.method, 'POST')
  } finally {
    restoreStorage()
  }
})

test('signed read URLs are normalized to the configured Supabase Storage endpoint', async () => {
  configureStorage()
  let requestUrl = ''
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requestUrl = String(input)
    return new Response(JSON.stringify({ signedURL: '/object/sign/school-media/photo.jpg?token=temporary' }), { status: 200 })
  }) as typeof fetch
  try {
    const url = await createSignedMediaReadUrl('photo.jpg', 300)
    assert.match(requestUrl, /object\/sign\/school-media\/photo\.jpg$/)
    assert.equal(url, 'https://example-project.supabase.co/storage/v1/object/sign/school-media/photo.jpg?token=temporary')
  } finally {
    restoreStorage()
  }
})

test('uploaded object verification requires matching byte size and MIME type', async () => {
  configureStorage()
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(init?.method, 'HEAD')
    return new Response(null, { status: 200, headers: { 'content-length': '1024', 'content-type': 'image/jpeg' } })
  }) as typeof fetch
  try {
    assert.equal(await verifyUploadedMedia('photo.jpg', 'image/jpeg', 1024), true)
    assert.equal(await verifyUploadedMedia('photo.jpg', 'image/png', 1024), false)
    assert.equal(await verifyUploadedMedia('photo.jpg', 'image/jpeg', 2048), false)
  } finally {
    restoreStorage()
  }
})

test('missing objects are not accepted as verified uploads', async () => {
  configureStorage()
  globalThis.fetch = (async () => new Response(null, { status: 404 })) as typeof fetch
  try {
    assert.equal(await verifyUploadedMedia('missing.jpg', 'image/jpeg', 1024), false)
  } finally {
    restoreStorage()
  }
})

test('deleting stored media uses the server credential and scoped object prefix', async () => {
  configureStorage()
  let requestUrl = ''
  let requestInit: RequestInit | undefined
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestUrl = String(input)
    requestInit = init
    return new Response(null, { status: 200 })
  }) as typeof fetch
  try {
    await deleteStoredMedia('folder/photo.jpg')
    assert.equal(requestUrl, 'https://example-project.supabase.co/storage/v1/object/school-media')
    assert.equal(requestInit?.method, 'DELETE')
    assert.equal((requestInit?.headers as Record<string, string>).Authorization, 'Bearer test-only-server-secret')
    assert.deepEqual(JSON.parse(String(requestInit?.body)), { prefixes: ['folder/photo.jpg'] })
  } finally {
    restoreStorage()
  }
})

test('storage configuration errors do not leak credential values', async () => {
  delete process.env.SUPABASE_URL
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
  try {
    await assert.rejects(createSignedMediaUpload('photo.jpg'), StorageConfigurationError)
  } finally {
    restoreStorage()
  }
})
