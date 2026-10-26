type JsonObject = Record<string, unknown>

const baseUrl = (process.env.SMOKE_BASE_URL ?? '').trim().replace(/\/+$/, '')
const studentEmail = (process.env.SMOKE_STUDENT_EMAIL ?? '').trim()
const studentPassword = process.env.SMOKE_STUDENT_PASSWORD ?? ''
const parentEmail = (process.env.SMOKE_PARENT_EMAIL ?? '').trim()
const parentPassword = process.env.SMOKE_PARENT_PASSWORD ?? ''
const unlinkedStudentId = (process.env.SMOKE_UNLINKED_STUDENT_ID ?? '').trim()

function requireSetting(name: string, value: string): void {
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
}

async function request(path: string, token?: string, init: RequestInit = {}): Promise<{ status: number; body: JsonObject }> {
  const response = await fetch(baseUrl + path, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...init.headers,
    },
  })
  const body = await response.json().catch(() => ({})) as JsonObject
  return { status: response.status, body }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function login(email: string, password: string, expectedRole: 'STUDENT' | 'PARENT'): Promise<{ token: string; userId: number }> {
  const result = await request('/api/auth/login', undefined, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  assert(result.status === 200 && result.body.success === true, `${expectedRole} sign-in failed (HTTP ${result.status})`)
  const token = result.body.token
  const user = result.body.user as JsonObject | undefined
  assert(typeof token === 'string' && token.length > 20, `${expectedRole} sign-in did not return a token`)
  assert(user && user.role === expectedRole && Number.isSafeInteger(Number(user.id)), `Account is not an active ${expectedRole} account`)
  return { token, userId: Number(user.id) }
}

async function main(): Promise<void> {
  requireSetting('SMOKE_BASE_URL', baseUrl)
  requireSetting('SMOKE_STUDENT_EMAIL', studentEmail)
  requireSetting('SMOKE_STUDENT_PASSWORD', studentPassword)
  requireSetting('SMOKE_PARENT_EMAIL', parentEmail)
  requireSetting('SMOKE_PARENT_PASSWORD', parentPassword)

  const readiness = await request('/api/health/ready')
  assert(readiness.status === 200 && readiness.body.ready === true, 'Production readiness check failed; inspect safe component statuses in the response')
  console.log('PASS: production readiness')

  const student = await login(studentEmail, studentPassword, 'STUDENT')
  const studentOverview = await request('/api/portal/student/overview', student.token)
  assert(studentOverview.status === 200 && studentOverview.body.success === true, 'Student overview could not be loaded')
  console.log('PASS: student login and own-record access')

  const parent = await login(parentEmail, parentPassword, 'PARENT')
  const childrenResult = await request('/api/portal/parent/children', parent.token)
  assert(childrenResult.status === 200 && childrenResult.body.success === true && Array.isArray(childrenResult.body.children), 'Parent linked-child list could not be loaded')
  const children = childrenResult.body.children as JsonObject[]
  assert(children.length > 0, 'Parent test account has no verified linked student; seed a dedicated test relationship')
  const childId = Number(children[0].studentId)
  const childOverview = await request(`/api/portal/parent/children/${encodeURIComponent(String(childId))}/overview`, parent.token)
  assert(childOverview.status === 200 && childOverview.body.success === true, 'Parent cannot access the linked student overview')
  console.log('PASS: parent linked-child access')

  if (unlinkedStudentId) {
    const isolated = await request(`/api/portal/parent/children/${encodeURIComponent(unlinkedStudentId)}/overview`, parent.token)
    assert(isolated.status === 404, `Parent-child isolation failed (expected 404, got ${isolated.status})`)
    console.log('PASS: parent cannot access an unlinked student')
  } else {
    console.log('SKIP: parent-child isolation requires SMOKE_UNLINKED_STUDENT_ID for a known unlinked test student')
  }

  console.log('PASS: authorized end-to-end smoke checks completed')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'End-to-end smoke checks failed')
  process.exitCode = 1
})
