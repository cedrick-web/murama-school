import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { PublicShell } from '@/components/layout/PublicShell'
import HomePage from './HomePage'

interface NewsItem { id: number; title: string; summary: string | null; body: string; publishedAt: string }
interface SchoolEvent { id: number; title: string; description: string | null; startsAt: string; endsAt: string | null; location: string | null }
interface GalleryItem { id: number; title: string | null; mediaType: string; mediaUrl: string; thumbnailUrl: string | null; description: string | null }

export function NewsPage() {
  const [schoolName, setSchoolName] = useState('Ecole Secondaire de Murama')
  const [items, setItems] = useState<NewsItem[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    void api<{ school: { schoolName: string } }>('/api/public/school').then((result) => setSchoolName(result.school.schoolName)).catch(() => undefined)
    api<{ news: NewsItem[] }>('/api/public/news')
      .then((result) => setItems(result.news))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Unable to load news'))
  }, [])
  return (
    <PublicShell schoolName={schoolName}>
      <div className="mx-auto max-w-4xl px-4 py-12">
        <h1 className="text-3xl font-semibold">School news</h1>
        <p className="mt-2 text-muted-foreground">Published articles from the school content register.</p>
        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
        <div className="mt-8 grid gap-6">
          {items.length === 0 && !error && <p className="text-sm text-muted-foreground">No published news yet.</p>}
          {items.map((item) => (
            <article key={item.id} className="rounded-3xl border bg-card p-6">
              <p className="text-xs text-muted-foreground">{formatDate(item.publishedAt)}</p>
              <h2 className="mt-2 text-xl font-semibold">{item.title}</h2>
              {item.summary && <p className="mt-2 text-sm text-muted-foreground">{item.summary}</p>}
              <p className="mt-4 whitespace-pre-wrap text-sm leading-6">{item.body}</p>
            </article>
          ))}
        </div>
      </div>
    </PublicShell>
  )
}

export function EventsPage() {
  const [schoolName, setSchoolName] = useState('Ecole Secondaire de Murama')
  const [items, setItems] = useState<SchoolEvent[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    void api<{ school: { schoolName: string } }>('/api/public/school').then((result) => setSchoolName(result.school.schoolName)).catch(() => undefined)
    api<{ events: SchoolEvent[] }>('/api/public/events')
      .then((result) => setItems(result.events))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Unable to load events'))
  }, [])
  return (
    <PublicShell schoolName={schoolName}>
      <div className="mx-auto max-w-4xl px-4 py-12">
        <h1 className="text-3xl font-semibold">School events</h1>
        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
        <div className="mt-8 grid gap-4">
          {items.length === 0 && !error && <p className="text-sm text-muted-foreground">No published events yet.</p>}
          {items.map((item) => (
            <article key={item.id} className="rounded-3xl border bg-card p-6">
              <p className="text-xs text-muted-foreground">{formatDate(item.startsAt, true)}{item.endsAt ? ' – ' + formatDate(item.endsAt, true) : ''}</p>
              <h2 className="mt-2 text-xl font-semibold">{item.title}</h2>
              <p className="text-sm text-muted-foreground">{item.location || 'Venue to be confirmed'}</p>
              {item.description && <p className="mt-3 text-sm">{item.description}</p>}
            </article>
          ))}
        </div>
      </div>
    </PublicShell>
  )
}

export function GalleryPage() {
  const [schoolName, setSchoolName] = useState('Ecole Secondaire de Murama')
  const [items, setItems] = useState<GalleryItem[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    void api<{ school: { schoolName: string } }>('/api/public/school').then((result) => setSchoolName(result.school.schoolName)).catch(() => undefined)
    api<{ items: GalleryItem[] }>('/api/public/gallery')
      .then((result) => setItems(result.items))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Unable to load gallery'))
  }, [])
  return (
    <PublicShell schoolName={schoolName}>
      <div className="mx-auto max-w-6xl px-4 py-12">
        <h1 className="text-3xl font-semibold">Gallery</h1>
        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.length === 0 && !error && <p className="text-sm text-muted-foreground">No published gallery items yet.</p>}
          {items.map((item) => (
            <a key={item.id} href={item.mediaUrl} target="_blank" rel="noreferrer" className="overflow-hidden rounded-3xl border bg-card">
              {item.mediaType === 'image' ? (
                <img src={item.thumbnailUrl || item.mediaUrl} alt={item.title ?? 'Gallery item'} className="h-52 w-full object-cover" />
              ) : (
                <div className="grid h-52 place-items-center text-sm">Open video</div>
              )}
              <div className="p-4">
                <h2 className="font-semibold">{item.title || 'Untitled'}</h2>
                {item.description && <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>}
              </div>
            </a>
          ))}
        </div>
      </div>
    </PublicShell>
  )
}

export function ContactPage() {
  return <HomePage />
}
