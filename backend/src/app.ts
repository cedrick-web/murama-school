import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import helmet from 'helmet'
import morgan from 'morgan'

import { checkDatabaseConnection } from './config/database.js'
import authRoutes from './routes/auth.routes.js'
import adminRoutes from './routes/admin.routes.js'
import publicRoutes from './routes/public.routes.js'

dotenv.config()

const app = express()

app.use(helmet())
app.use(cors({ origin: process.env.FRONTEND_URL ?? 'http://localhost:5173' }))
app.use(express.json({ limit: '1mb' }))
app.use(morgan('dev'))

app.use('/api/auth', authRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/public', publicRoutes)

app.get('/', (_req, res) => {
  res.json({
    name: 'Murama School API',
    status: 'running',
    version: '0.1.0',
  })
})

app.get('/api/health', async (_req, res) => {
  try {
    await checkDatabaseConnection()
    res.json({ success: true, service: 'murama-school-api', status: 'healthy', database: 'connected' })
  } catch {
    res.status(503).json({
      success: false,
      service: 'murama-school-api',
      status: 'degraded',
      database: 'unavailable',
      message: 'The API is running, but its database connection is not ready. Configure SUPABASE_DB_URL in the server runtime.',
    })
  }
})

app.get('/api/health/database', async (_req, res) => {
  try {
    await checkDatabaseConnection()
    res.json({ success: true, service: 'murama-school-api', database: 'supabase-postgres', status: 'connected' })
  } catch {
    res.status(503).json({
      success: false,
      service: 'murama-school-api',
      database: 'supabase-postgres',
      status: 'unavailable',
      message: 'Database connection is not configured or cannot be reached.',
    })
  }
})

// Keep unknown API requests machine-readable instead of falling through to HTML.
app.use('/api', (_req, res) => {
  res.status(404).json({ success: false, message: 'API endpoint not found' })
})

export default app
