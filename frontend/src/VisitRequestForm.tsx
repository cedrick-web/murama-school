import { FormEvent, useState } from 'react'
import './visit-request.css'

type Language = 'en' | 'rw'
interface Props { language: Language }
interface ApiResult { success?: boolean; message?: string; requestId?: number }
const apiUrl = (import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? '' : 'http://localhost:5000')).replace(/\/$/, '')

const text = {
  en: {
    kicker: 'PLAN A VISIT',
    title: 'Arrange a school visit',
    intro: 'Send the school a visit request. The date is a preference, not a confirmed appointment; staff will contact you to confirm.',
    name: 'Full name',
    email: 'Email address',
    phone: 'Phone number',
    type: 'I am a',
    parent: 'Parent / guardian',
    student: 'Student',
    prospective: 'Prospective parent',
    other: 'Other visitor',
    date: 'Preferred date',
    time: 'Preferred time (optional)',
    purpose: 'Reason for visiting',
    purposeHint: 'Tell the school briefly what you need help with (10–3000 characters).',
    submit: 'Send visit request',
    submitting: 'Sending request…',
    contact: 'Provide at least an email address or a phone number.',
    success: 'Your visit request was received. The school will contact you to confirm the appointment.',
    failure: 'The request could not be sent. Please check the details and try again.',
    required: 'Please complete the required fields.',
  },
  rw: {
    kicker: 'TEGURA URUZINDUKO',
    title: 'Saba gusura ishuri',
    intro: 'Ohereza ubusabe bwo gusura ishuri. Itariki uhisemo ntiba yemejwe kugeza igihe abakozi b’ishuri bakuvugishije.',
    name: 'Amazina yose',
    email: 'Imeyili',
    phone: 'Nimero ya telefone',
    type: 'Ndi',
    parent: 'Umubyeyi / umurera',
    student: 'Umunyeshuri',
    prospective: 'Umubyeyi ushaka kwandikisha umwana',
    other: 'Undi mushyitsi',
    date: 'Itariki wifuza',
    time: 'Isaha wifuza (si ngombwa)',
    purpose: 'Impamvu yo gusura',
    purposeHint: 'Sobanura muri make icyo ukeneye kuganiraho n’ishuri (inyuguti 10–3000).',
    submit: 'Ohereza ubusabe',
    submitting: 'Birimo koherezwa…',
    contact: 'Tanga nibura imeyili cyangwa nimero ya telefone.',
    success: 'Ubusabe bwawe bwakiriwe. Ishuri rizakuvugisha kugira ngo ryemeze gahunda.',
    failure: 'Ubusabe ntibwoherejwe. Reba amakuru wongere ugerageze.',
    required: 'Uzuza amakuru asabwa.',
  },
}
function todayInRwanda(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kigali', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return value('year') + '-' + value('month') + '-' + value('day')
}

export default function VisitRequestForm({ language }: Props) {
  const t = text[language]
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [visitorType, setVisitorType] = useState('PARENT')
  const [preferredDate, setPreferredDate] = useState('')
  const [preferredTime, setPreferredTime] = useState('')
  const [purpose, setPurpose] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [requestId, setRequestId] = useState<number | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSuccess('')
    setRequestId(null)
    if (!email.trim() && !phone.trim()) {
      setError(t.contact)
      return
    }
    setBusy(true)
    try {
      const response = await fetch(apiUrl + '/api/public/visits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: fullName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          visitorType,
          preferredDate,
          preferredTime,
          purpose: purpose.trim(),
        }),
      })
      const result = await response.json().catch(() => null) as ApiResult | null
      if (!response.ok || !result?.success) throw new Error(result?.message ?? t.failure)
      setRequestId(result.requestId ?? null)
      setSuccess(result.message ?? t.success)
      setFullName('')
      setEmail('')
      setPhone('')
      setVisitorType('PARENT')
      setPreferredDate('')
      setPreferredTime('')
      setPurpose('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t.failure)
    } finally {
      setBusy(false)
    }
  }

  return <section className="visit-request-section" id="visit-request">
    <div className="visit-request-intro"><span className="visit-request-kicker">{t.kicker}</span><h2>{t.title}</h2><p>{t.intro}</p><div className="visit-request-note"><span aria-hidden="true">i</span><span>{language === 'en' ? 'Submitting this form does not confirm a visit. Please wait for a response from the school.' : 'Kohereza iyi fomu ntibihita byemeza uruzinduko. Tegereza igisubizo kiva ku ishuri.'}</span></div></div>
    <form className="visit-request-form" onSubmit={submit}>
      {error && <div className="visit-request-alert" role="alert">{error}</div>}
      {success && <div className="visit-request-success" role="status"><strong>{language === 'en' ? 'Request received' : 'Ubusabe bwakiriwe'}</strong><p>{success}</p>{requestId !== null && <small>{language === 'en' ? 'Reference number' : 'Nimero y’ubusabe'}: ESM-V{requestId}</small>}</div>}
      <div className="visit-request-fields">
        <label>{t.name}<input value={fullName} onChange={(e) => setFullName(e.target.value)} required minLength={2} maxLength={120} autoComplete="name" /></label>
        <label>{t.type}<select value={visitorType} onChange={(e) => setVisitorType(e.target.value)}><option value="PARENT">{t.parent}</option><option value="STUDENT">{t.student}</option><option value="PROSPECTIVE_PARENT">{t.prospective}</option><option value="OTHER">{t.other}</option></select></label>
        <label>{t.email}<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} autoComplete="email" /></label>
        <label>{t.phone}<input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} autoComplete="tel" /></label>
        <label>{t.date}<input type="date" value={preferredDate} onChange={(e) => setPreferredDate(e.target.value)} min={todayInRwanda()} required /></label>
        <label>{t.time}<input type="time" value={preferredTime} onChange={(e) => setPreferredTime(e.target.value)} /></label>
        <label className="visit-request-purpose">{t.purpose}<textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} minLength={10} maxLength={3000} rows={4} required placeholder={t.purposeHint} /></label>
      </div>
      <button type="submit" disabled={busy}>{busy ? t.submitting : t.submit}<span aria-hidden="true">↗</span></button>
    </form>
  </section>
}
