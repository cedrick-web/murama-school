export interface ReadinessInputs {
  databaseConnected: boolean
  jwtSecretConfigured: boolean
  mediaStorageConfigured: boolean
}

export interface ReadinessReport {
  ready: boolean
  status: 'ready' | 'degraded'
  checks: {
    database: 'ready' | 'unavailable'
    authentication: 'ready' | 'misconfigured'
    mediaStorage: 'ready' | 'misconfigured'
  }
  missing: string[]
}

export function buildReadinessReport(input: ReadinessInputs): ReadinessReport {
  const checks = {
    database: input.databaseConnected ? 'ready' as const : 'unavailable' as const,
    authentication: input.jwtSecretConfigured ? 'ready' as const : 'misconfigured' as const,
    mediaStorage: input.mediaStorageConfigured ? 'ready' as const : 'misconfigured' as const,
  }
  const missing = Object.entries(checks)
    .filter(([, value]) => value !== 'ready')
    .map(([key]) => key)
  return {
    ready: missing.length === 0,
    status: missing.length === 0 ? 'ready' : 'degraded',
    checks,
    missing,
  }
}
