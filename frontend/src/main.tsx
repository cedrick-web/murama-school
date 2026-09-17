import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

function App() {
  return (
    <main className="page-shell">
      <section className="hero-card">
        <p className="eyebrow">ECOLE SECONDAIRE DE MURAMA</p>
        <h1>Welcome to the digital school platform.</h1>
        <p className="intro">
          A modern bilingual platform for school information, communication,
          academics, students, teachers, parents, and school administration.
        </p>
        <div className="status-row">
          <span className="status-dot" />
          Foundation stage is running
        </div>
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
