import { useCallback, useEffect, useState } from 'react'
import './media-gallery.css'

type Language = 'en' | 'rw'
interface MediaItem {
  id: number
  title: string
  altText: string
  description: string | null
  category: string
  mediaType: 'IMAGE' | 'VIDEO'
  publicUrl: string
  mimeType: string
  sizeBytes: number
  publishedAt: string
}
interface Props { language: Language }
interface ApiResponse { success?: boolean; message?: string; media?: MediaItem[] }
const apiUrl = (import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? '' : 'http://localhost:5000')).replace(/\/$/, '')
const labels = {
  en: {
    kicker: 'SCHOOL LIFE',
    title: 'Moments from Murama',
    intro: 'Photos and videos officially published by the school.',
    loading: 'Loading the school gallery…',
    empty: 'The school has not published any photos or videos yet.',
    error: 'The gallery could not be loaded.',
    retry: 'Try again',
    image: 'Photo',
    video: 'Video',
  },
  rw: {
    kicker: 'UBUZIMA BW’ISHURI',
    title: 'Ibihe byo kuri Murama',
    intro: 'Amafoto na videwo byashyizwe ahagaragara n’ishuri.',
    loading: 'Turimo kuzana amafoto na videwo by’ishuri…',
    empty: 'Nta mafoto cyangwa videwo ishuri rirashyira ahagaragara.',
    error: 'Amafoto na videwo ntibishoboye kugaragara.',
    retry: 'Ongera ugerageze',
    image: 'Ifoto',
    video: 'Videwo',
  },
}
function formatDate(value: string, language: Language): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(language === 'en' ? 'en-RW' : 'rw-RW', { dateStyle: 'medium' }).format(date)
}
export default function MediaGallery({ language }: Props) {
  const t = labels[language]
  const [items, setItems] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(apiUrl + '/api/public/media')
      const result = await response.json().catch(() => null) as ApiResponse | null
      if (!response.ok || !result?.success || !Array.isArray(result.media)) throw new Error(result?.message ?? t.error)
      setItems(result.media)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t.error)
    } finally {
      setLoading(false)
    }
  }, [t.error])
  useEffect(() => { void load() }, [load])

  return <section className="media-gallery-section" id="gallery">
    <div className="media-gallery-heading"><div><span className="media-gallery-kicker">{t.kicker}</span><h2>{t.title}</h2><p>{t.intro}</p></div><span className="media-gallery-count">{String(items.length).padStart(2, '0')} <small>{language === 'en' ? 'published items' : 'ibiri hanze'}</small></span></div>
    {loading ? <div className="media-gallery-state" aria-live="polite"><span className="media-gallery-spinner" />{t.loading}</div>
      : error ? <div className="media-gallery-state is-error" role="alert"><p>{error}</p><button type="button" onClick={() => void load()}>{t.retry}</button></div>
      : !items.length ? <div className="media-gallery-state"><span className="media-gallery-empty-mark">M</span><p>{t.empty}</p></div>
      : <div className="media-gallery-grid">{items.map((item) => <article className="media-gallery-card" key={item.id}>
        <div className="media-gallery-frame">
          {item.mediaType === 'VIDEO'
            ? <video controls preload="metadata" playsInline aria-label={item.title}><source src={item.publicUrl} type={item.mimeType} />Your browser does not support this video.</video>
            : <img src={item.publicUrl} alt={item.altText || item.title} loading="lazy" decoding="async" />}
          <span className="media-gallery-type">{item.mediaType === 'VIDEO' ? t.video : t.image}</span>
        </div>
        <div className="media-gallery-card-copy"><div className="media-gallery-meta"><span>{item.category.replace(/_/g, ' ')}</span><time dateTime={item.publishedAt}>{formatDate(item.publishedAt, language)}</time></div><h3>{item.title}</h3>{item.description && <p>{item.description}</p>}</div>
      </article>)}</div>}
  </section>
}
