import assert from 'node:assert/strict'
import test from 'node:test'
import { normalisePostgresRows, translateMysqlQuery } from './sql-compat.js'

test('translates scalar parameters and preserves case-sensitive API aliases', () => {
  const query = translateMysqlQuery(
    'SELECT u.first_name AS firstName, u.is_active AS isActive FROM users u WHERE u.id = ? LIMIT ?',
    [12, 10],
  )
  assert.equal(query.text, 'SELECT u.first_name AS "firstName", u.is_active AS "isActive" FROM users u WHERE u.id = $1 LIMIT $2')
  assert.deepEqual(query.values, [12, 10])
  assert.equal(query.kind, 'select')
})

test('uses PostgreSQL array matching for the legacy IN (?) pattern', () => {
  const query = translateMysqlQuery('SELECT s.id FROM students s WHERE s.id IN (?)', [[2, 5, 8]])
  assert.equal(query.text, 'SELECT s.id FROM students s WHERE s.id = ANY($1)')
  assert.deepEqual(query.values, [[2, 5, 8]])
})

test('handles nullable predicates and MySQL null-safe comparisons', () => {
  const query = translateMysqlQuery(
    'SELECT id FROM student_enrollments WHERE term_id <=> ? AND (? IS NULL OR class_id = ?)',
    [null, null, 4],
  )
  assert.equal(query.text, 'SELECT id FROM student_enrollments WHERE term_id IS NOT DISTINCT FROM $1 AND (CAST($2 AS TEXT) IS NULL OR class_id = $3)')
})

test('translates MySQL upserts without changing their conflict keys', () => {
  const query = translateMysqlQuery(
    'INSERT INTO attendance_records (student_id, attendance_date, status) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE status = VALUES(status)',
    [10, '2026-10-24', 'PRESENT'],
  )
  assert.equal(
    query.text,
    'INSERT INTO attendance_records (student_id, attendance_date, status) VALUES ($1, $2, $3) ON CONFLICT (student_id, attendance_date) DO UPDATE SET status = EXCLUDED.status',
  )
})

test('translates IF(), CONCAT_WS, conditional aggregate and non-null aggregate expressions', () => {
  const query = translateMysqlQuery(
    'SELECT CONCAT_WS(" ", u.first_name, u.last_name) AS fullName, IF(?, COALESCE(published_at, CURRENT_TIMESTAMP), NULL) AS publishedAt, SUM(status = ?) AS paidItems, SUM(mr.read_at IS NOT NULL) AS readCount FROM users u',
    [true, 'PAID'],
  )
  assert.equal(
    query.text,
    'SELECT CONCAT_WS(\' \', u.first_name, u.last_name) AS "fullName", (CASE WHEN $1 THEN COALESCE(published_at, CURRENT_TIMESTAMP) ELSE NULL END) AS "publishedAt", COUNT(*) FILTER (WHERE status = $2) AS "paidItems", COUNT(mr.read_at) AS "readCount" FROM users u',
  )
})

test('adds RETURNING id only for route inserts whose existing response reads insertId', () => {
  const query = translateMysqlQuery('INSERT INTO assessments (title) VALUES (?)', ['Quiz'])
  assert.equal(query.text, 'INSERT INTO assessments (title) VALUES ($1) RETURNING id')
  assert.equal(query.returnsId, true)

  const noId = translateMysqlQuery(
    'INSERT INTO message_recipients (message_id, recipient_user_id) VALUES (?, ?)',
    [1, 2],
  )
  assert.equal(noId.text, 'INSERT INTO message_recipients (message_id, recipient_user_id) VALUES ($1, $2)')
})

test('returns generated IDs for secure account invitations', () => {
  const query = translateMysqlQuery(
    'INSERT INTO account_invitations (user_id, invited_by, token_hash, expires_at) VALUES (?, ?, ?, ?)',
    [21, 4, 'a'.repeat(64), '2026-10-27T00:00:00.000Z'],
  )
  assert.equal(
    query.text,
    'INSERT INTO account_invitations (user_id, invited_by, token_hash, expires_at) VALUES ($1, $2, $3, $4) RETURNING id',
  )
  assert.equal(query.returnsId, true)
})

test('returns generated IDs for parent, teacher, and teacher assignment inserts', () => {
  const cases = [
    ['INSERT INTO parents (user_id, occupation) VALUES (?, ?)', 'INSERT INTO parents (user_id, occupation) VALUES ($1, $2) RETURNING id', [1, 'teacher']],
    ['INSERT INTO teachers (user_id, department) VALUES (?, ?)', 'INSERT INTO teachers (user_id, department) VALUES ($1, $2) RETURNING id', [1, 'science']],
    ['INSERT INTO teacher_subjects (teacher_id, class_id, subject_id, academic_year_id) VALUES (?, ?, ?, ?)', 'INSERT INTO teacher_subjects (teacher_id, class_id, subject_id, academic_year_id) VALUES ($1, $2, $3, $4) RETURNING id', [1, 2, 3, 4]],
  ] as const
  for (const [input, expected, values] of cases) {
    const translated = translateMysqlQuery(input, values)
    assert.equal(translated.text, expected)
    assert.equal(translated.returnsId, true)
  }
})

test('preserves generated IDs for public content and staff inserts after merging table sets', () => {
  for (const table of ['staff', 'news', 'events', 'gallery_items', 'school_inquiries', 'school_visit_requests', 'school_media_items']) {
    const query = translateMysqlQuery(`INSERT INTO ${table} (id) VALUES (?)`, [1])
    assert.equal(query.text, `INSERT INTO ${table} (id) VALUES ($1) RETURNING id`)
    assert.equal(query.returnsId, true)
  }
})

test('quotes camelCase aliases when they are referenced by ORDER BY', () => {
  const query = translateMysqlQuery(
    'SELECT AVG(score) AS averageScore, COUNT(*) AS markedCount FROM assessment_results ORDER BY averageScore DESC NULLS LAST',
  )
  assert.equal(
    query.text,
    'SELECT AVG(score) AS "averageScore", COUNT(*) AS "markedCount" FROM assessment_results ORDER BY "averageScore" DESC NULLS LAST',
  )
})

test('normalises numeric PostgreSQL strings only in identifier and metric fields', () => {
  assert.deepEqual(
    normalisePostgresRows([{
      id: '20',
      studentId: '3',
      markedCount: '8',
      averageScore: '82.50',
      admissionNumber: '00021',
      email: '32@example.test',
    }]),
    [{ id: 20, studentId: 3, markedCount: 8, averageScore: 82.5, admissionNumber: '00021', email: '32@example.test' }],
  )
})
