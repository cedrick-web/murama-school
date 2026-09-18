import mysql from 'mysql2/promise'

import dotenv from 'dotenv'

dotenv.config()

const required = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER'] as const

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required database environment variable: ${key}`)
  }
}

export const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD ?? '',
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
  charset: 'utf8mb4',
})

export async function checkDatabaseConnection(): Promise<void> {
  const connection = await pool.getConnection()

  try {
    await connection.ping()
  } finally {
    connection.release()
  }
}
