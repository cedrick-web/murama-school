import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, ApiError } from './api'
import { clearSchoolSession, persistSchoolToken, readSchoolToken, schoolHomePath } from './school-session'

export type UserRole = 'ADMIN' | 'HEADTEACHER' | 'TEACHER' | 'STUDENT' | 'PARENT' | 'STAFF'

export interface AuthUser {
  id: number
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  role: UserRole
}

const readStoredToken = readSchoolToken

interface AuthContextValue {
  token: string | null
  user: AuthUser | null
  status: 'checking' | 'signed-out' | 'ready'
  error: string
  setError: (message: string) => void
  signInWithPassword: (email: string, password: string) => Promise<void>
  completeSession: (token: string) => Promise<void>
  signOut: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => readStoredToken())
  const [user, setUser] = useState<AuthUser | null>(null)
  const [status, setStatus] = useState<AuthContextValue['status']>(token ? 'checking' : 'signed-out')
  const [error, setError] = useState('')

  const persistToken = useCallback((next: string | null) => {
    if (next) persistSchoolToken(next)
    else clearSchoolSession()
    setToken(next)
  }, [])

  const completeSession = useCallback(async (nextToken: string) => {
    const result = await api<{ user: AuthUser }>('/api/auth/me', { token: nextToken })
    persistToken(nextToken)
    setUser(result.user)
    setStatus('ready')
    setError('')
  }, [persistToken])

  useEffect(() => {
    if (!token) {
      setUser(null)
      setStatus('signed-out')
      return
    }
    let active = true
    setStatus('checking')
    api<{ user: AuthUser }>('/api/auth/me', { token })
      .then((result) => {
        if (!active) return
        setUser(result.user)
        setStatus('ready')
      })
      .catch((reason: unknown) => {
        if (!active) return
        if (reason instanceof ApiError && reason.status === 401) persistToken(null)
        setUser(null)
        setStatus('signed-out')
        setError(reason instanceof Error ? reason.message : 'Unable to verify your session')
      })
    return () => {
      active = false
    }
  }, [token, persistToken])

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    const result = await api<{ token: string; user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
    await completeSession(result.token)
  }, [completeSession])

  const signOut = useCallback(() => {
    persistToken(null)
    setUser(null)
    setStatus('signed-out')
    setError('')
  }, [persistToken])

  const value = useMemo<AuthContextValue>(() => ({
    token,
    user,
    status,
    error,
    setError,
    signInWithPassword,
    completeSession,
    signOut,
  }), [token, user, status, error, signInWithPassword, completeSession, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}

export function homePathFor(role: UserRole): string {
  return schoolHomePath(role)
}

export function canManageSchool(role: UserRole | undefined): boolean {
  return role === 'ADMIN' || role === 'HEADTEACHER'
}
