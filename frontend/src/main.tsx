import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import AdminApp from './AdminApp'
import './styles.css'

type Language = 'en' | 'rw'

interface PublicSchool {
  schoolName: string
  contactEmail: string
  contactPhone: string
  address: string
}

interface PublicAnnouncement {
  id: number
  title: string
  message: string
  publishedAt: string
}

interface PublicResponse {
  success?: boolean
  message?: string
  school?: PublicSchool
  announcements?: PublicAnnouncement[]
}

const publicApiUrl = (import.meta.env.VITE_API_URL ?? 'http://localhost:5000').replace(/\/$/, '')

async function getPublicData<T extends PublicResponse>(path: string): Promise<T> {
  const response = await fetch(`${publicApiUrl}${path}`)
  const result: PublicResponse | null = await response.json().catch(() => null)
  if (!response.ok || !result?.success) {
    throw new Error(result?.message ?? `Request failed (${response.status})`)
  }
  return result as T
}

const content = {
  en: {
    nav: ['Home', 'About', 'Academics', 'News', 'Gallery', 'Contact'],
    language: 'Kinyarwanda',
    badge: 'Learning • Character • Excellence',
    title: 'A school community built for a brighter future.',
    intro:
      'Welcome to Ecole Secondaire de Murama. Our digital platform will connect students, parents, teachers, and school administration in one simple and trusted place.',
    primary: 'Discover our school',
    secondary: 'School updates',
    stats: [
      ['01', 'Strong learning culture'],
      ['02', 'Supportive community'],
      ['03', 'Future-ready skills'],
    ],
    aboutLabel: 'ABOUT MURAMA',
    aboutTitle: 'A modern school experience, without making school life complicated.',
    aboutText:
      'The Murama platform is being designed to make important school information easier to find, communication easier to manage, and academic services easier to access.',
    cards: [
      ['Academic excellence', 'Clear information about subjects, programs, academic periods, and learning activities.'],
      ['Parent connection', 'Important announcements and school communication in one accessible place.'],
      ['Student growth', 'A digital environment that supports learning, activities, achievements, and student life.'],
    ],
    updatesLabel: 'WHAT COMES NEXT',
    updatesTitle: 'More than a school website.',
    updatesText:
      'This foundation will grow into a complete school platform with public information, administration tools, academic management, communication, reports, and secure user portals.',
    cta: 'Explore the platform',
    announcementsHeading: 'Latest school announcements',
    announcementsLoading: 'Loading school updates…',
    announcementsEmpty: 'There are no public announcements right now.',
    announcementsError: 'School announcements could not be loaded.',
    schoolDetailsError: 'School contact details could not be loaded.',
    noContactDetails: 'Contact details will be published here.',
    footer: 'Ecole Secondaire de Murama',
    footerText: 'Learning today. Building tomorrow.',
  },
  rw: {
    nav: ['Ahabanza', 'Ishuri', 'Amasomo', 'Amakuru', 'Amafoto', 'Twandikire'],
    language: 'English',
    badge: 'Kwiga • Indangagaciro • Indashyikirwa',
    title: 'Ishuri rihuza abantu n’ejo hazaza heza.',
    intro:
      'Murakaza neza kuri Ecole Secondaire de Murama. Uru rubuga ruzahuza abanyeshuri, ababyeyi, abarimu n’ubuyobozi bw’ishuri ahantu hamwe hizewe kandi horoshye gukoresha.',
    primary: 'Menya ishuri ryacu',
    secondary: 'Amakuru y’ishuri',
    stats: [
      ['01', 'Umuco wo kwiga'],
      ['02', 'Umuryango w’ishuri'],
      ['03', 'Ubumenyi bw’ejo'],
    ],
    aboutLabel: 'IBYEREKEYE MURAMA',
    aboutTitle: 'Ubunararibonye bw’ishuri bugezweho, bworoshye gukoresha.',
    aboutText:
      'Uru rubuga rwa Murama rutegurwa kugira ngo amakuru y’ishuri aboneke byoroshye, itumanaho rirusheho kuba ryiza, ndetse serivisi z’amasomo zigerweho neza.',
    cards: [
      ['Indashyikirwa mu masomo', 'Amakuru asobanutse ku masomo, porogaramu, ibihe by’amashuri n’ibikorwa byo kwiga.'],
      ['Guhuza ababyeyi', 'Amatangazo n’itumanaho by’ingenzi biboneka ahantu hamwe.'],
      ['Iterambere ry’umunyeshuri', 'Ahantu h’ikoranabuhanga hafasha mu myigire, ibikorwa, impano n’ubuzima bw’umunyeshuri.'],
    ],
    updatesLabel: 'IBIZAKURIKIRA',
    updatesTitle: 'Si urubuga rw’amakuru y’ishuri gusa.',
    updatesText:
      'Uru rufatiro ruzaguka rube sisitemu yuzuye y’ishuri irimo amakuru rusange, imicungire y’ishuri, amasomo, itumanaho, raporo n’imbuga z’abakoresha zifite umutekano.',
    cta: 'Reba urubuga',
    announcementsHeading: 'Amatangazo mashya y’ishuri',
    announcementsLoading: 'Turimo kuzana amakuru y’ishuri…',
    announcementsEmpty: 'Nta matangazo rusange ahari ubu.',
    announcementsError: 'Amatangazo y’ishuri ntashoboye kugaragara.',
    schoolDetailsError: 'Amakuru yo kuvugana n’ishuri ntashoboye kugaragara.',
    noContactDetails: 'Amakuru yo kuvugana n’ishuri azashyirwa hano.',
    footer: 'Ecole Secondaire de Murama',
    footerText: 'Kwiga uyu munsi. Kubaka ejo.',
  },
} as const

function App() {
  const [language, setLanguage] = useState<Language>('en')
  const t = content[language]
  const [school, setSchool] = useState<PublicSchool>({
    schoolName: 'Ecole Secondaire de Murama',
    contactEmail: '',
    contactPhone: '',
    address: '',
  })
  const [announcements, setAnnouncements] = useState<PublicAnnouncement[]>([])
  const [announcementsLoading, setAnnouncementsLoading] = useState(true)
  const [announcementsError, setAnnouncementsError] = useState(false)
  const [schoolError, setSchoolError] = useState(false)

  useEffect(() => {
    let active = true
    getPublicData<{ school: PublicSchool }>('/api/public/school')
      .then(({ school: result }) => {
        if (active) setSchool(result)
      })
      .catch(() => {
        if (active) setSchoolError(true)
      })
    getPublicData<{ announcements: PublicAnnouncement[] }>('/api/public/announcements')
      .then(({ announcements: result }) => {
        if (active) setAnnouncements(result)
      })
      .catch(() => {
        if (active) setAnnouncementsError(true)
      })
      .finally(() => {
        if (active) setAnnouncementsLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  function formatPublishedDate(value: string): string {
    const date = new Date(value)
    return Number.isNaN(date.getTime())
      ? ''
      : new Intl.DateTimeFormat(language === 'en' ? 'en' : 'rw', { dateStyle: 'medium' }).format(date)
  }

  return (
    <div className="site-shell">
      <header className="site-header">
        <a className="brand" href="#home" aria-label={t.footer}>
          <span className="brand-mark">M</span>
          <span>
            <strong>ESM</strong>
            <small>Murama School</small>
          </span>
        </a>

        <nav className="desktop-nav" aria-label="Primary navigation">
          {t.nav.map((item, index) => (
            <a key={item} href={`#${['home', 'about', 'academics', 'news', 'gallery', 'contact'][index]}`}>
              {item}
            </a>
          ))}
        </nav>

        <button
          className="language-switcher"
          onClick={() => setLanguage(language === 'en' ? 'rw' : 'en')}
          type="button"
          aria-label={`Switch language to ${t.language}`}
        >
          {t.language}
        </button>
      </header>

      <main>
        <section className="hero" id="home">
          <div className="hero-content">
            <p className="eyebrow">{t.badge}</p>
            <h1>{t.title}</h1>
            <p className="hero-copy">{t.intro}</p>
            <div className="hero-actions">
              <a className="button button-primary" href="#about">{t.primary}</a>
              <a className="button button-secondary" href="#news">{t.secondary}</a>
            </div>
          </div>
          <div className="hero-panel" aria-label="Murama School highlights">
            <div className="hero-panel-top">
              <span>EST. SCHOOL PLATFORM</span>
              <span>2026</span>
            </div>
            <div className="hero-orbit">
              <span className="orbit-ring ring-one" />
              <span className="orbit-ring ring-two" />
              <span className="orbit-core">M</span>
            </div>
            <p>One connected place for the Murama school community.</p>
          </div>
        </section>

        <section className="stats-strip" aria-label="School highlights">
          {t.stats.map(([number, label]) => (
            <div className="stat" key={number}>
              <span>{number}</span>
              <strong>{label}</strong>
            </div>
          ))}
        </section>

        <section className="section section-light" id="about">
          <div className="section-heading">
            <p className="section-label">{t.aboutLabel}</p>
            <h2>{t.aboutTitle}</h2>
            <p>{t.aboutText}</p>
          </div>
          <div className="feature-grid" id="academics">
            {t.cards.map(([title, text], index) => (
              <article className="feature-card" key={title}>
                <span className="feature-number">0{index + 1}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="section section-dark" id="news">
          <div className="section-heading dark-heading">
            <p className="section-label">{t.updatesLabel}</p>
            <h2>{t.updatesTitle}</h2>
            <p>{t.updatesText}</p>
            <a className="button button-light" href="#contact">{t.cta}</a>
          </div>
          <div className="public-updates-column">
            <section className="public-announcements" aria-labelledby="public-announcements-heading">
              <h3 id="public-announcements-heading">{t.announcementsHeading}</h3>
              {announcementsLoading && <p aria-live="polite">{t.announcementsLoading}</p>}
              {announcementsError && <p role="alert">{t.announcementsError}</p>}
              {!announcementsLoading && !announcementsError && announcements.length === 0 && (
                <p>{t.announcementsEmpty}</p>
              )}
              {!announcementsError && announcements.map((announcement) => (
                <article className="public-announcement" key={announcement.id}>
                  <h4>{announcement.title}</h4>
                  <p>{announcement.message}</p>
                  {formatPublishedDate(announcement.publishedAt) && (
                    <time dateTime={announcement.publishedAt}>
                      {formatPublishedDate(announcement.publishedAt)}
                    </time>
                  )}
                </article>
              ))}
            </section>
            <div className="future-grid" id="gallery">
              <div className="future-card"><span>01</span><strong>Public website</strong><small>News, events, gallery and school information.</small></div>
              <div className="future-card"><span>02</span><strong>School management</strong><small>Academic, staff, student and administrative workflows.</small></div>
              <div className="future-card"><span>03</span><strong>Parent & student portals</strong><small>Secure access to communication and academic services.</small></div>
            </div>
          </div>
        </section>

        <section className="contact-band" id="contact">
          <div>
            <p className="section-label">{school.schoolName.toUpperCase()}</p>
            <h2>Learning today. Building tomorrow.</h2>
          </div>
          <div className="public-contact">
            {schoolError && <p role="alert">{t.schoolDetailsError}</p>}
            {school.contactEmail && <a className="button button-primary" href={`mailto:${school.contactEmail}`}>{school.contactEmail}</a>}
            {school.contactPhone && <a className="button button-secondary" href={`tel:${school.contactPhone}`}>{school.contactPhone}</a>}
            {school.address && <span>{school.address}</span>}
            {!schoolError && !school.contactEmail && !school.contactPhone && !school.address && <span>{t.noContactDetails}</span>}
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div>
          <strong>{school.schoolName || t.footer}</strong>
          <span>{t.footerText}</span>
        </div>
        <span>© 2026 Murama School</span>
      </footer>
    </div>
  )
}

const RootApp = window.location.pathname.replace(/\/+$/, '') === '/admin'
  ? AdminApp
  : App

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootApp />
  </StrictMode>,
)
