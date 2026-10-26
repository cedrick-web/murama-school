import assert from 'node:assert/strict'
import test from 'node:test'
import { buildReadinessReport } from './production-readiness.js'

test('production readiness succeeds only when database, auth and media storage are configured', () => {
  const report = buildReadinessReport({ databaseConnected: true, jwtSecretConfigured: true, mediaStorageConfigured: true })
  assert.equal(report.ready, true)
  assert.equal(report.status, 'ready')
  assert.deepEqual(report.missing, [])
})

test('readiness reports missing components without exposing secret values', () => {
  const report = buildReadinessReport({ databaseConnected: false, jwtSecretConfigured: true, mediaStorageConfigured: false })
  assert.equal(report.ready, false)
  assert.equal(report.status, 'degraded')
  assert.deepEqual(report.missing, ['database', 'mediaStorage'])
  assert.deepEqual(report.checks, { database: 'unavailable', authentication: 'ready', mediaStorage: 'misconfigured' })
})
