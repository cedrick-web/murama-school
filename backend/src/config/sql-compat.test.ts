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
