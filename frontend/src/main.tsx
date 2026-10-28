import { StrictMode, lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import { RequireAuth, RequireManager } from './pages/workspace/Guard'
import VisitRequestForm from './VisitRequestForm'
import MediaGallery from './MediaGallery'
import './tailwind.css'
import './styles.css'

const AdminApp = lazy(() => import('./AdminApp'))
const PortalApp = lazy(() => import('./PortalApp'))
const TeacherApp = lazy(() => import('./TeacherApp'))
const StaffPortalApp = lazy(() => import('./StaffPortalApp'))
const InvitationAcceptApp = lazy(() => import('./InvitationAcceptApp'))
const SignInPage = lazy(() => import('./pages/auth/SignInPage'))
const NewsPage = lazy(() => import('./pages/public/ContentPages').then((module) => ({ default: module.NewsPage })))
const EventsPage = lazy(() => import('./pages/public/ContentPages').then((module) => ({ default: module.EventsPage })))
const GalleryPage = lazy(() => import('./pages/public/ContentPages').then((module) => ({ default: module.GalleryPage })))
const ContactPage = lazy(() => import('./pages/public/ContentPages').then((module) => ({ default: module.ContactPage })))
const DashboardPage = lazy(() => import('./pages/workspace/LegacyModules').then((module) => ({ default: module.DashboardPage })))
const StudentsPage = lazy(() => import('./pages/workspace/LegacyModules').then((module) => ({ default: module.StudentsPage })))
const AcademicsPage = lazy(() => import('./pages/workspace/LegacyModules').then((module) => ({ default: module.AcademicsPage })))
const OperationsPage = lazy(() => import('./pages/workspace/LegacyModules').then((module) => ({ default: module.OperationsPage })))
const PortalPage = lazy(() => import('./pages/workspace/PortalPages').then((module) => ({ default: module.PortalPage })))
const AccountPage = lazy(() => import('./pages/workspace/PortalPages').then((module) => ({ default: module.AccountPage })))
const TeachersPage = lazy(() => import('./pages/workspace/DirectoryPage').then((module) => ({ default: module.TeachersPage })))
const ParentsPage = lazy(() => import('./pages/workspace/DirectoryPage').then((module) => ({ default: module.ParentsPage })))

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
interface ApiEnvelope {
  success?: boolean
  message?: string
}

const apiUrl = (import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? '' : 'http://localhost:5000')).replace(/\/+$/, '')

async function getPublicData<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl + path)
  const result = await response.json().catch(() => null) as (ApiEnvelope & Record<string, unknown>) | null
  if (!response.ok || !result || result.success !== true) {
    throw new Error(result?.message ?? ('Request failed (' + response.status + ')'))
  }
  return result as T
}

const copy = {
  en: {
    navHome: 'Home',
    navSchool: 'School information',
    navUpdates: 'Announcements',
    navContact: 'Contact',
    navNews: 'News',
    navEvents: 'Events',
    navGallery: 'Gallery',
    switchLanguage: 'Kinyarwanda',
    portal: 'School portal',
    eyebrow: 'ECOLE SECONDAIRE DE MURAMA',
    heroTitle: 'A school community, connected.',
    heroLead: 'Find the school information that has been published, follow official announcements, and reach the school through its verified contact details.',
    exploreSchool: 'School information',
    latestUpdates: 'Latest announcements',
    liveUpdates: 'PUBLISHED SCHOOL UPDATES',
    updatesCaption: 'Official notices published by the school',
    publishedUpdates: 'Published updates',
    updateCount: 'available now',
    schoolDetails: 'School information',
    schoolDetailsIntro: 'School contact details and public information are maintained by the school administration.',
    contactEmail: 'Email',
    contactPhone: 'Phone',
    address: 'Address',
    notPublished: 'Not published',
    schoolInfoUnavailable: 'School information could not be loaded.',
    updatesHeading: 'Official announcements',
    updatesIntro: 'Published announcements for the school community. Updates shown here are retrieved from the school system.',
    refresh: 'Refresh',
    refreshing: 'Refreshing…',
    loadingUpdates: 'Loading published announcements…',
    noUpdates: 'There are no published announcements at the moment.',
    updatesUnavailable: 'Announcements could not be loaded. Check the connection and try again.',
    retry: 'Try again',
    publishedOn: 'Published',
    contactTitle: 'Need to reach the school?',
    contactText: 'Use the contact details maintained by the school administration. If a detail is not shown, it has not been published in the school system.',
    contactSchool: 'Contact the school',
    openPortal: 'Open administration portal',
    portalCaption: 'For authorised school accounts',
    footerLine: 'Official school information and published updates.',
    footerLink: 'School portal',
    serviceLabel: 'Connected school information',
    actualData: 'Live school data',
    bilingual: 'English and Kinyarwanda',
    secureAdmin: 'Protected administration',
    loadingSchool: 'Loading school information…',
    schoolLoadFailed: 'Some school information is temporarily unavailable.',
  },
  rw: {
    navHome: 'Ahabanza',
    navSchool: 'Ibyerekeye ishuri',
    navUpdates: 'Amatangazo',
    navContact: 'Twandikire',
    navNews: 'Amakuru',
    navEvents: 'Ibirori',
    navGallery: 'Amafoto',
    switchLanguage: 'English',
    portal: 'Urubuga rw’ishuri',
    eyebrow: 'ECOLE SECONDAIRE DE MURAMA',
    heroTitle: 'Umuryango w’ishuri uhuje.',
    heroLead: 'Menya amakuru y’ishuri yashyizwe ahagaragara, ukurikirane amatangazo yemewe, kandi uvugane n’ishuri ukoresheje amakuru yaryo yo kurigeraho.',
    exploreSchool: 'Amakuru y’ishuri',
    latestUpdates: 'Amatangazo mashya',
    liveUpdates: 'AMATANGAZO Y’ISHURI',
    updatesCaption: 'Amakuru yemewe yashyizwe ahagaragara n’ishuri',
    publishedUpdates: 'Amatangazo ari hanze',
    updateCount: 'ahari ubu',
    schoolDetails: 'Amakuru y’ishuri',
    schoolDetailsIntro: 'Amakuru yo kuvugana n’ishuri n’andi makuru rusange acungwa n’ubuyobozi bw’ishuri.',
    contactEmail: 'Imeyili',
    contactPhone: 'Telefone',
    address: 'Aderesi',
    notPublished: 'Ntabwo yashyizwe ahagaragara',
    schoolInfoUnavailable: 'Amakuru y’ishuri ntashoboye kugaragara.',
    updatesHeading: 'Amatangazo yemewe',
    updatesIntro: 'Amatangazo yashyizwe ahagaragara ku muryango w’ishuri. Aya makuru akurwa muri sisitemu y’ishuri.',
    refresh: 'Kongera kureba',
    refreshing: 'Birimo kuvugururwa…',
    loadingUpdates: 'Turimo kuzana amatangazo yashyizwe ahagaragara…',
    noUpdates: 'Nta matangazo yashyizwe ahagaragara ahari ubu.',
    updatesUnavailable: 'Amatangazo ntashoboye kugaragara. Reba umurongo wa internet wongere ugerageze.',
    retry: 'Ongera ugerageze',
    publishedOn: 'Yashyizwe hanze',
    contactTitle: 'Ukeneye kuvugana n’ishuri?',
    contactText: 'Koresha amakuru yo kuvugana n’ishuri yashyizweho n’ubuyobozi. Amakuru atagaragara ntabwo arashyirwa muri sisitemu.',
    contactSchool: 'Vugana n’ishuri',
    openPortal: 'Fungura urubuga rw’ishuri',
    portalCaption: 'Abafite konti z’ishuri bemerewe',
    footerLine: 'Amakuru yemewe y’ishuri n’amatangazo yashyizwe hanze.',
    footerLink: 'Urubuga rw’ishuri',
    serviceLabel: 'Amakuru y’ishuri ahujwe na sisitemu',
    actualData: 'Amakuru nyayo y’ishuri',
    bilingual: 'Icyongereza n’Ikinyarwanda',
    secureAdmin: 'Ubuyobozi burinzwe',
    loadingSchool: 'Turimo kuzana amakuru y’ishuri…',
    schoolLoadFailed: 'Bimwe mu makuru y’ishuri ntabonetse by’igihe gito.',
  },
} as const

function formatDate(value: string, language: Language): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const locale = language === 'en' ? 'en-RW' : 'rw-RW'
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date)
}

function SchoolMark() {
  return <span className="school-mark" aria-hidden="true">M</span>
}

function ArrowIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>
}

function App() {
  const [language, setLanguage] = useState<Language>('en')
  const [school, setSchool] = useState<PublicSchool>({
    schoolName: 'Ecole Secondaire de Murama',
    contactEmail: '',
    contactPhone: '',
    address: '',
  })
  const [announcements, setAnnouncements] = useState<PublicAnnouncement[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [announcementsError, setAnnouncementsError] = useState(false)
  const [schoolError, setSchoolError] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const t = copy[language]

  const loadPublicData = useCallback(async () => {
    setRefreshing(true)
    const [schoolResult, announcementsResult] = await Promise.allSettled([
      getPublicData<{ school: PublicSchool }>('/api/public/school'),
      getPublicData<{ announcements: PublicAnnouncement[] }>('/api/public/announcements'),
    ])

    if (schoolResult.status === 'fulfilled') {
      setSchool(schoolResult.value.school)
      setSchoolError(false)
    } else {
      setSchoolError(true)
    }

    if (announcementsResult.status === 'fulfilled') {
      setAnnouncements(announcementsResult.value.announcements)
      setAnnouncementsError(false)
    } else {
      setAnnouncementsError(true)
    }

    setLoading(false)
    setRefreshing(false)
  }, [])

  useEffect(() => {
    void loadPublicData()
  }, [loadPublicData])

  const schoolName = school.schoolName || 'Ecole Secondaire de Murama'
  const publishedDate = announcements.length > 0 ? formatDate(announcements[0].publishedAt, language) : ''
  const missingSchoolDetail = loading ? t.loadingSchool : schoolError ? t.schoolInfoUnavailable : t.notPublished
  const menuItems = [
    { label: t.navHome, href: '#home' },
    { label: t.navSchool, href: '#school' },
    { label: language === 'en' ? 'Gallery' : 'Amafoto na videwo', href: '#gallery' },
    { label: t.navUpdates, href: '#updates' },
    { label: t.navContact, href: '#contact' },
    { label: t.navNews, href: '/news' },
    { label: t.navEvents, href: '/events' },
    { label: t.navGallery, href: '/gallery' },
  ]

  return (
    <div className="public-site">
      <a className="skip-link" href="#main-content">{language === 'en' ? 'Skip to content' : 'Jya ku makuru nyamukuru'}</a>
      <header className="public-header">
        <a className="public-brand" href="#home" aria-label={schoolName}>
          <SchoolMark />
          <span className="public-brand-copy"><strong>{schoolName}</strong><small>{t.serviceLabel}</small></span>
        </a>

        <button className="mobile-nav-toggle" type="button" aria-expanded={menuOpen} aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} onClick={() => setMenuOpen((current) => !current)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">{menuOpen ? <path d="m6 6 12 12M18 6 6 18"/> : <path d="M4 6h16M4 12h16M4 18h16"/>}</svg>
        </button>

        <nav className={'public-nav' + (menuOpen ? ' is-open' : '')} aria-label="Main navigation">
          {menuItems.map((item) => (
            <a key={item.href} href={item.href} onClick={() => setMenuOpen(false)}>{item.label}</a>
          ))}
          <a className="public-nav-admin" href="/signin" onClick={() => setMenuOpen(false)}>{t.portal}<ArrowIcon /></a>
          <button className="language-toggle" type="button" onClick={() => setLanguage(language === 'en' ? 'rw' : 'en')}>{t.switchLanguage}</button>
        </nav>
      </header>

      <main id="main-content">
        <section className="public-hero" id="home">
          <div className="public-hero-copy">
            <div className="hero-eyebrow"><span />{t.eyebrow}</div>
            <h1>{t.heroTitle}</h1>
            <p className="public-hero-lead">{t.heroLead}</p>
            <div className="public-hero-actions">
              <a className="public-button primary" href="#school">{t.exploreSchool}<ArrowIcon /></a>
              <a className="public-text-link" href="#updates">{t.latestUpdates}<span aria-hidden="true">↓</span></a>
            </div>
            <div className="public-hero-assurance">
              <span className="assurance-mark"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg></span>
              <span><strong>{t.actualData}</strong><small>{language === 'en' ? 'Information is loaded from the school API' : 'Amakuru akurwa muri sisitemu y’ishuri'}</small></span>
            </div>
          </div>

          <aside className="public-live-panel" aria-label={t.latestUpdates}>
            <div className="public-live-panel-head">
              <span className="live-indicator"><span />{t.liveUpdates}</span>
              <span className="public-live-number">{announcements.length.toString().padStart(2, '0')}</span>
            </div>
            <div className="public-live-panel-main">
              <p className="live-panel-label">{t.publishedUpdates}</p>
              <h2>{loading ? '…' : announcements.length.toLocaleString(language === 'en' ? 'en-RW' : 'rw-RW')}</h2>
              <p>{t.updateCount}</p>
            </div>
            <div className="public-live-panel-divider" />
            {loading ? (
              <p className="live-panel-empty" aria-live="polite">{t.loadingUpdates}</p>
            ) : announcementsError ? (
              <div className="live-panel-empty"><p>{t.updatesUnavailable}</p><button type="button" onClick={() => void loadPublicData()}>{t.retry}</button></div>
            ) : announcements.length > 0 ? (
              <a className="live-featured-update" href="#updates">
                <span className="featured-update-date">{publishedDate}</span>
                <strong>{announcements[0].title}</strong>
                <span className="featured-update-link">{t.latestUpdates}<ArrowIcon /></span>
              </a>
            ) : (
              <p className="live-panel-empty">{t.noUpdates}</p>
            )}
            <div className="public-live-panel-foot"><span>{t.updatesCaption}</span><span aria-hidden="true">↗</span></div>
          </aside>
        </section>

        <section className="public-proof-strip" aria-label={t.serviceLabel}>
          <div><span className="proof-number">01</span><span><strong>{t.actualData}</strong><small>{language === 'en' ? 'School details from the connected API' : 'Amakuru ava muri sisitemu y’ishuri'}</small></span></div>
          <div><span className="proof-number">02</span><span><strong>{t.bilingual}</strong><small>{language === 'en' ? 'Switch language at any time' : 'Hindura ururimi igihe cyose'}</small></span></div>
          <div><span className="proof-number">03</span><span><strong>{t.secureAdmin}</strong><small>{language === 'en' ? 'Administrator access is separated' : 'Ubuyobozi bufite urubuga rwihariye'}</small></span></div>
        </section>

        <section className="public-school-section" id="school">
          <div className="public-section-heading">
            <span className="section-kicker">{language === 'en' ? 'THE SCHOOL' : 'ISHURI'}</span>
            <h2>{t.schoolDetails}</h2>
            <p>{t.schoolDetailsIntro}</p>
          </div>
          <div className="public-school-grid">
            <article className="school-info-card school-info-primary">
              <div className="school-info-card-top"><span className="school-info-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 9 9-6 9 6v11H3V9Z"/><path d="M9 20v-7h6v7M7 9h.01M17 9h.01"/></svg></span><span className="info-card-index">ESM / 01</span></div>
              <h3>{schoolName}</h3>
              <p>{school.address || missingSchoolDetail}</p>
              {schoolError && <span className="inline-data-warning">{t.schoolInfoUnavailable}</span>}
            </article>

            <article className="school-info-card">
              <div className="school-info-card-top"><span className="school-info-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></svg></span><span className="info-card-index">CONTACT / 02</span></div>
              <h3>{t.contactEmail}</h3>
              {school.contactEmail ? <a className="school-info-value" href={'mailto:' + school.contactEmail}>{school.contactEmail}</a> : <p className="school-info-unpublished">{missingSchoolDetail}</p>}
            </article>

            <article className="school-info-card">
              <div className="school-info-card-top"><span className="school-info-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h3l2 5-2 1.5a15 15 0 0 0 4.5 4.5L16 12l5 2v3a3 3 0 0 1-3 3A15 15 0 0 1 4 6a3 3 0 0 1 3-3Z"/></svg></span><span className="info-card-index">CONTACT / 03</span></div>
              <h3>{t.contactPhone}</h3>
              {school.contactPhone ? <a className="school-info-value" href={'tel:' + school.contactPhone}>{school.contactPhone}</a> : <p className="school-info-unpublished">{t.notPublished}</p>}
            </article>
          </div>
        </section>

        <MediaGallery language={language} />

        <section className="public-updates-section" id="updates">
          <div className="public-updates-header">
            <div className="public-section-heading">
              <span className="section-kicker">{language === 'en' ? 'SCHOOL COMMUNICATION' : 'ITUMANAHO RY’ISHURI'}</span>
              <h2>{t.updatesHeading}</h2>
              <p>{t.updatesIntro}</p>
            </div>
            <button className="public-refresh-button" type="button" onClick={() => void loadPublicData()} disabled={refreshing}>
              <svg viewBox="0 0 24 24" aria-hidden="true" className={refreshing ? 'is-spinning' : ''}><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.7 9A7 7 0 0 1 18 6.5L20 12M4 12l2 5.5A7 7 0 0 0 18.3 15"/></svg>
              {refreshing ? t.refreshing : t.refresh}
            </button>
          </div>

          {loading ? (
            <div className="public-updates-state" aria-live="polite"><span className="state-spinner" />{t.loadingUpdates}</div>
          ) : announcementsError ? (
            <div className="public-updates-state is-error" role="alert"><p>{t.updatesUnavailable}</p><button type="button" onClick={() => void loadPublicData()}>{t.retry}</button></div>
          ) : announcements.length === 0 ? (
            <div className="public-updates-state"><span className="empty-state-mark">—</span><p>{t.noUpdates}</p></div>
          ) : (
            <div className="public-announcement-grid">
              {announcements.map((announcement, index) => (
                <article className="public-announcement-card" key={announcement.id}>
                  <div className="public-announcement-card-top"><span className="announcement-index">{String(index + 1).padStart(2, '0')}</span><time dateTime={announcement.publishedAt}>{formatDate(announcement.publishedAt, language)}</time></div>
                  <h3>{announcement.title}</h3>
                  <p>{announcement.message}</p>
                  <div className="announcement-card-bottom"><span>{t.publishedOn}</span><ArrowIcon /></div>
                </article>
              ))}
            </div>
          )}
        </section>

        <VisitRequestForm language={language} />

        <section className="public-contact-section" id="contact">
          <div className="contact-section-copy">
            <span className="section-kicker">{language === 'en' ? 'GET IN TOUCH' : 'TWANDIKIRE'}</span>
            <h2>{t.contactTitle}</h2>
            <p>{t.contactText}</p>
          </div>
          <div className="contact-section-actions">
            {school.contactEmail && <a className="public-button primary" href={'mailto:' + school.contactEmail}>{t.contactEmail}<ArrowIcon /></a>}
            {school.contactPhone && <a className="public-button outline" href={'tel:' + school.contactPhone}>{t.contactPhone}<ArrowIcon /></a>}
            {!school.contactEmail && !school.contactPhone && <span className="contact-not-published">{missingSchoolDetail}</span>}
            <a className="contact-admin-link" href="/signin">{t.openPortal}<ArrowIcon /></a>
            <a className="contact-admin-link" href="/portal">{language === 'en' ? 'Student & parent portal' : 'Urubuga rw’abanyeshuri n’ababyeyi'}<ArrowIcon /></a>
            <a className="contact-admin-link" href="/teacher">{language === 'en' ? 'Teacher workspace' : 'Urubuga rw’abarimu'}<ArrowIcon /></a>
            <small>{t.portalCaption}</small>
          </div>
        </section>
      </main>

      <footer className="public-footer">
        <a className="footer-brand" href="#home"><SchoolMark /><span><strong>{schoolName}</strong><small>{t.footerLine}</small></span></a>
        <span className="footer-copyright">© {new Date().getFullYear()} {schoolName}</span>
        <a className="footer-admin-link" href="/signin">{t.footerLink}<ArrowIcon /></a>
      </footer>
    </div>
  )
}

function AuthenticatedWorkspace() {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<RequireAuth />}>
          <Route path="portal" element={<PortalPage />} />
          <Route path="account" element={<AccountPage />} />
          <Route element={<RequireManager />}>
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="students/*" element={<StudentsPage />} />
            <Route path="academics/*" element={<AcademicsPage />} />
            <Route path="operations/*" element={<OperationsPage />} />
            <Route path="users" element={<Navigate to="/admin/users" replace />} />
            <Route path="teachers" element={<TeachersPage />} />
            <Route path="parents" element={<ParentsPage />} />
            <Route path="settings" element={<Navigate to="/admin/settings" replace />} />
            <Route path="announcements" element={<Navigate to="/admin/announcements" replace />} />
            <Route path="activity" element={<Navigate to="/admin/activity" replace />} />
            <Route path="content" element={<Navigate to="/admin/announcements" replace />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/app/portal" replace />} />
      </Routes>
    </AuthProvider>
  )
}

function RootApp() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Loading Murama School…</div>}>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/admin/*" element={<AdminApp />} />
          <Route path="/portal/*" element={<PortalApp />} />
          <Route path="/teacher/*" element={<TeacherApp />} />
          <Route path="/staff/*" element={<StaffPortalApp />} />
          <Route path="/invite/*" element={<InvitationAcceptApp />} />
          <Route path="/signin" element={<AuthProvider><SignInPage /></AuthProvider>} />
          <Route path="/app/*" element={<AuthenticatedWorkspace />} />
          <Route path="/news" element={<NewsPage />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/gallery" element={<GalleryPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootApp />
  </StrictMode>,
)
