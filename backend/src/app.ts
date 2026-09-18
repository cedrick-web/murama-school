import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import helmet from 'helmet'
import morgan from 'morgan'

import { checkDatabaseConnection } from './config/database.js'

dotenv.config()

const app = express()

app.use(helmet())
app.use(cors({ origin: process.env.FRONTEND_URL ?? 'http://localhost:5173' }))
app.use(express.json({ limit: '1mb' }))
app.use(morgan('dev'))

app.get('/', (_req, res) => {
  res.json({
    name: 'Murama School API',
    status: 'running',
    version: '0.1.0',
  })
})

app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    service: 'murama-school-api',
    status: 'healthy',
  })
})

app.get('/api/health/database', async (_req, res) => {
  try {
    await checkDatabaseConnection()

    res.json({
      success: true,
      service: 'murama-school-api',
      database: 'mysql',
      status: 'connected',
    })
  } catch {
    res.status(503).json({
      success: false,
      service: 'murama-school-api',
      database: 'mysql',
      status: 'unavailable',
    })
  }
})

export default app
