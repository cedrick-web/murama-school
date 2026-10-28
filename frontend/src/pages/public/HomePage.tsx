import { FormEvent, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { PublicShell } from '@/components/layout/PublicShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

interface PublicSchool {
  schoolName: string
  contactEmail: string
  contactPhone: string
  address: string
}
interface Announcement { id: number; title: string; message: string; publishedAt: string }
interface NewsItem { id: number; title: string; slug: string; summary: string | null; publishedAt: string }
interface SchoolEvent { id: number; title: string; description: string | null; startsAt: string; location: string | null }
interface GalleryItem { id: number; title: string | null; mediaType: string; mediaUrl: string; thumbnailUrl: string | null }

export default function HomePage() {
  const [school, setSchool] = useState<PublicSchool>({
    schoolName: 'Ecole Secondaire de Murama',
    contactEmail: '',
    contactPhone: '',
    address: '',
  })
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [news, setNews] = useState<NewsItem[]>([])
  const [events, setEvents] = useState<SchoolEvent[]>([])
  const [gallery, setGallery] = useState<GalleryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [inquiry, setInquiry] = useState({ fullName: '', email: '', phone: '', subject: '', message: '' })
  const [inquiryStatus, setInquiryStatus] = useState('')
  const [inquiryError, setInquiryError] = useState('')
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    const results = await Promise.allSettled([
      api<{ school: PublicSchool }>('/api/public/school'),
      api<{ announcements: Announcement[] }>('/api/public/announcements'),
      api<{ news: NewsItem[] }>('/api/public/news'),
      api<{ events: SchoolEvent[] }>('/api/public/events'),
      api<{ items: GalleryItem[] }>('/api/public/gallery'),
    ])
    if (results[0].status === 'fulfilled') setSchool(results[0].value.school)
    if (results[1].status === 'fulfilled') setAnnouncements(results[1].value.announcements)
    if (results[2].status === 'fulfilled') setNews(results[2].value.news)
    if (results[3].status === 'fulfilled') setEvents(results[3].value.events)
    if (results[4].status === 'fulfilled') setGallery(results[4].value.items)
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  async function sendInquiry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSending(true)
    setInquiryError('')
    setInquiryStatus('')
    try {
      const result = await api<{ message?: string }>('/api/public/inquiries', {
        method: 'POST',
        body: JSON.stringify(inquiry),
      })
      setInquiryStatus(result.message ?? 'Message received.')
      setInquiry({ fullName: '', email: '', phone: '', subject: '', message: '' })
    } catch (reason) {
      setInquiryError(reason instanceof Error ? reason.message : 'Unable to send your message')
    } finally {
      setSending(false)
    }
  }

  return (
    <PublicShell schoolName={school.schoolName}>
      <section className="bg-[#123524] text-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
          <div>
            <p className="text-xs tracking-[0.22em] text-accent">ECOLE SECONDAIRE DE MURAMA</p>
            <h1 className="mt-4 text-4xl font-semibold leading-tight md:text-5xl">A connected school community, powered by live school records.</h1>
            <p className="mt-4 max-w-xl text-white/75">Official announcements, news, events and contact details are published from the school administration system. Families and staff sign in to their own portal.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/news" className="rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground">Read school news</Link>
              <Link to="/signin" className="rounded-xl border border-white/20 px-5 py-3 text-sm font-semibold">Open portal</Link>
            </div>
          </div>
          <div className="rounded-3xl bg-white/8 p-6">
            <p className="text-xs uppercase tracking-[0.16em] text-white/60">Published now</p>
            <p className="mt-2 text-3xl font-semibold">{loading ? '…' : announcements.length}</p>
            <p className="text-sm text-white/70">public announcements from the school database</p>
            <dl className="mt-6 grid gap-3 text-sm">
              <div><dt className="text-white/50">Email</dt><dd>{school.contactEmail || 'Not published'}</dd></div>
              <div><dt className="text-white/50">Phone</dt><dd>{school.contactPhone || 'Not published'}</dd></div>
              <div><dt className="text-white/50">Address</dt><dd>{school.address || 'Not published'}</dd></div>
            </dl>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-4 py-12 lg:grid-cols-3">
        <article className="rounded-3xl border bg-card p-6 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold">Announcements</h2>
            <Button variant="ghost" size="sm" onClick={() => void load()}>Refresh</Button>
          </div>
          {announcements.length === 0 && <p className="text-sm text-muted-foreground">No published announcements at the moment.</p>}
          <div className="grid gap-4">
            {announcements.map((item) => (
              <div key={item.id} className="rounded-2xl border p-4">
                <p className="text-xs text-muted-foreground">{formatDate(item.publishedAt)}</p>
                <h3 className="mt-1 font-semibold">{item.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{item.message}</p>
              </div>
            ))}
          </div>
        </article>
        <article className="rounded-3xl border bg-card p-6">
          <h2 className="text-xl font-semibold">Upcoming events</h2>
          <div className="mt-4 grid gap-3">
            {events.length === 0 && <p className="text-sm text-muted-foreground">No published events yet.</p>}
            {events.slice(0, 5).map((item) => (
              <div key={item.id}>
                <p className="text-xs text-muted-foreground">{formatDate(item.startsAt, true)}</p>
                <p className="font-medium">{item.title}</p>
                <p className="text-sm text-muted-foreground">{item.location || 'Venue to be confirmed'}</p>
              </div>
            ))}
            <Link to="/events" className="text-sm font-semibold text-primary">All events</Link>
          </div>
        </article>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-12">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">School news</h2>
          <Link to="/news" className="text-sm font-semibold text-primary">View all</Link>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {news.length === 0 && <p className="text-sm text-muted-foreground">No published news articles yet.</p>}
          {news.slice(0, 3).map((item) => (
            <article key={item.id} className="rounded-3xl border bg-card p-5">
              <p className="text-xs text-muted-foreground">{formatDate(item.publishedAt)}</p>
              <h3 className="mt-2 font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{item.summary || 'Read the full article in the news archive.'}</p>
            </article>
          ))}
        </div>
      </section>

      {gallery.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 pb-12">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold">Gallery</h2>
            <Link to="/gallery" className="text-sm font-semibold text-primary">Open gallery</Link>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {gallery.slice(0, 8).map((item) => (
              <a key={item.id} href={item.mediaUrl} target="_blank" rel="noreferrer" className="overflow-hidden rounded-2xl border bg-card">
                {item.mediaType === 'image' ? (
                  <img src={item.thumbnailUrl || item.mediaUrl} alt={item.title ?? 'School gallery item'} className="h-36 w-full object-cover" />
                ) : (
                  <div className="grid h-36 place-items-center text-sm">Video</div>
                )}
              </a>
            ))}
          </div>
        </section>
      )}

      <section id="contact" className="border-t bg-card">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 lg:grid-cols-2">
          <div>
            <h2 className="text-2xl font-semibold">Contact the school</h2>
            <p className="mt-2 text-sm text-muted-foreground">Messages are stored as inquiries for the administration team. This is not a demo form.</p>
            <dl className="mt-6 grid gap-2 text-sm">
              <div><dt className="text-muted-foreground">Email</dt><dd>{school.contactEmail || 'Not published'}</dd></div>
              <div><dt className="text-muted-foreground">Phone</dt><dd>{school.contactPhone || 'Not published'}</dd></div>
              <div><dt className="text-muted-foreground">Address</dt><dd>{school.address || 'Not published'}</dd></div>
            </dl>
          </div>
          <form className="grid gap-3 rounded-3xl border p-6" onSubmit={(event) => void sendInquiry(event)}>
            {inquiryError && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-destructive" role="alert">{inquiryError}</p>}
            {inquiryStatus && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">{inquiryStatus}</p>}
            <Input required maxLength={150} placeholder="Full name" value={inquiry.fullName} onChange={(event) => setInquiry({ ...inquiry, fullName: event.target.value })} />
            <Input required type="email" placeholder="Email" value={inquiry.email} onChange={(event) => setInquiry({ ...inquiry, email: event.target.value })} />
            <Input maxLength={30} placeholder="Phone (optional)" value={inquiry.phone} onChange={(event) => setInquiry({ ...inquiry, phone: event.target.value })} />
            <Input required maxLength={200} placeholder="Subject" value={inquiry.subject} onChange={(event) => setInquiry({ ...inquiry, subject: event.target.value })} />
            <Textarea required maxLength={8000} rows={5} placeholder="Message" value={inquiry.message} onChange={(event) => setInquiry({ ...inquiry, message: event.target.value })} />
            <Button type="submit" disabled={sending}>{sending ? 'Sending…' : 'Send message'}</Button>
          </form>
        </div>
      </section>
    </PublicShell>
  )
}
