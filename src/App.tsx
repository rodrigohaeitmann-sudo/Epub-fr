import { useEffect, useMemo, useState } from 'react'

type ReviewResult = 'again' | 'hard' | 'good' | 'easy'
type Language = 'en-US' | 'fr-FR'

type Flashcard = {
  id: string
  expression: string
  translation: string
  context: string
  language: Language
  tags?: string
  box: number
  nextReview: string
  repetitions?: number
  lapses?: number
  lastResult?: ReviewResult | ''
}

const today = new Date().toISOString().slice(0, 10)
const endpointStorageKey = 'language-review.appsScriptUrl'

const initialCards: Flashcard[] = [
  {
    id: 'demo-1',
    expression: 'To keep track of',
    translation: 'Acompanhar / manter registro de',
    context: 'I use this app to keep track of new expressions.',
    language: 'en-US',
    tags: 'produtividade',
    box: 1,
    nextReview: today,
  },
  {
    id: 'demo-2',
    expression: 'Ça vaut le coup',
    translation: 'Vale a pena',
    context: 'Revoir les cartes tous les jours, ça vaut le coup.',
    language: 'fr-FR',
    tags: 'conversa',
    box: 2,
    nextReview: today,
  },
]

const intervals = [0, 1, 3, 7, 14, 30, 60, 120]
const resultLabels: Record<ReviewResult, string> = {
  again: 'Errei',
  hard: 'Difícil',
  good: 'Bom',
  easy: 'Fácil',
}

function addDays(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function normalizeCard(card: Partial<Flashcard>): Flashcard {
  return {
    id: String(card.id),
    expression: card.expression || '',
    translation: card.translation || '',
    context: card.context || '',
    language: card.language === 'fr-FR' ? 'fr-FR' : 'en-US',
    tags: card.tags || '',
    box: Number(card.box || 1),
    nextReview: card.nextReview || today,
    repetitions: Number(card.repetitions || 0),
    lapses: Number(card.lapses || 0),
    lastResult: card.lastResult || '',
  }
}

function speak(text: string, language: string) {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = language
  utterance.rate = language === 'fr-FR' ? 0.86 : 0.9
  window.speechSynthesis.speak(utterance)
}

export default function App() {
  const [cards, setCards] = useState(initialCards)
  const [activeIndex, setActiveIndex] = useState(0)
  const [isRevealed, setIsRevealed] = useState(false)
  const [languageFilter, setLanguageFilter] = useState<'all' | Language>('all')
  const [appsScriptUrl, setAppsScriptUrl] = useState(() => localStorage.getItem(endpointStorageKey) || '')
  const [syncStatus, setSyncStatus] = useState('Use cards demonstrativos ou conecte o Web App do Google Apps Script.')
  const [isSyncing, setIsSyncing] = useState(false)

  const dueCards = useMemo(
    () =>
      cards.filter(
        (card) => card.nextReview <= today && (languageFilter === 'all' || card.language === languageFilter),
      ),
    [cards, languageFilter],
  )

  const activeCard = dueCards[activeIndex] ?? dueCards[0]
  const reviewedToday = cards.filter((card) => card.lastResult).length
  const accuracy = reviewedToday
    ? Math.round((cards.filter((card) => card.lastResult === 'good' || card.lastResult === 'easy').length / reviewedToday) * 100)
    : 0

  useEffect(() => {
    localStorage.setItem(endpointStorageKey, appsScriptUrl)
  }, [appsScriptUrl])

  async function loadDueCards() {
    if (!appsScriptUrl) {
      setSyncStatus('Cole a URL publicada do Apps Script para buscar a planilha.')
      return
    }

    setIsSyncing(true)
    setSyncStatus('Sincronizando cards vencidos da planilha...')
    const params = new URLSearchParams({ action: 'due', language: languageFilter })
    const response = await fetch(`${appsScriptUrl}?${params.toString()}`)
    const data = await response.json()
    const nextCards = Array.isArray(data) ? data.map(normalizeCard) : []
    setCards(nextCards)
    setActiveIndex(0)
    setIsRevealed(false)
    setSyncStatus(`${nextCards.length} cards vencidos carregados da planilha.`)
    setIsSyncing(false)
  }

  async function persistReview(card: Flashcard, result: ReviewResult, nextBox: number, nextReview: string) {
    if (!appsScriptUrl || card.id.startsWith('demo-')) return
    setSyncStatus('Salvando progresso na aba Progresso...')
    await fetch(appsScriptUrl, {
      method: 'POST',
      body: JSON.stringify({ action: 'review', expressionId: card.id, result }),
    })
    setSyncStatus(`Progresso salvo: caixa ${nextBox}, próxima revisão em ${nextReview}.`)
  }

  function reviewCard(result: ReviewResult) {
    if (!activeCard) return
    const direction = result === 'again' ? -1 : result === 'hard' ? 0 : result === 'good' ? 1 : 2
    const nextBox = Math.min(intervals.length - 1, Math.max(1, activeCard.box + direction))
    const nextReview = addDays(result === 'again' ? 0 : intervals[nextBox])

    setCards((currentCards) =>
      currentCards.map((card) =>
        card.id === activeCard.id
          ? {
              ...card,
              box: nextBox,
              nextReview,
              repetitions: Number(card.repetitions || 0) + 1,
              lapses: Number(card.lapses || 0) + (result === 'again' ? 1 : 0),
              lastResult: result,
            }
          : card,
      ),
    )
    setIsRevealed(false)
    setActiveIndex((index) => Math.max(0, Math.min(index, dueCards.length - 2)))
    persistReview(activeCard, result, nextBox, nextReview)
  }

  return (
    <main className="app-shell">
      <section className="hero" aria-labelledby="app-title">
        <div>
          <p className="eyebrow">Flashcards + Google Sheets</p>
          <h1 id="app-title">Vocabulário Inglês/Francês</h1>
          <p className="hero-copy">
            Use sua planilha como banco de expressões e salve o progresso em uma aba separada para
            revisar novamente no dia certo.
          </p>
        </div>
        <div className="sheet-panel">
          <label htmlFor="apps-script-url">URL do Web App Google Apps Script</label>
          <input
            id="apps-script-url"
            placeholder="https://script.google.com/macros/s/.../exec"
            value={appsScriptUrl}
            onChange={(event) => setAppsScriptUrl(event.target.value)}
          />
          <button disabled={isSyncing} onClick={loadDueCards}>{isSyncing ? 'Sincronizando...' : 'Buscar revisões'}</button>
          <small>{syncStatus}</small>
        </div>
      </section>

      <section className="stats" aria-label="Resumo da revisão">
        <article><strong>{dueCards.length}</strong><span>cards para hoje</span></article>
        <article><strong>{reviewedToday}</strong><span>respondidos</span></article>
        <article><strong>{accuracy}%</strong><span>acertos bons/fáceis</span></article>
      </section>

      <section className="study-layout">
        <aside className="queue-card">
          <h2>Fila</h2>
          <div className="filters">
            <button className={languageFilter === 'all' ? 'active' : ''} onClick={() => setLanguageFilter('all')}>Todas</button>
            <button className={languageFilter === 'en-US' ? 'active' : ''} onClick={() => setLanguageFilter('en-US')}>Inglês</button>
            <button className={languageFilter === 'fr-FR' ? 'active' : ''} onClick={() => setLanguageFilter('fr-FR')}>Francês</button>
          </div>
          <ol>
            {dueCards.map((card, index) => (
              <li key={card.id} className={card.id === activeCard?.id ? 'selected' : ''}>
                <button onClick={() => { setActiveIndex(index); setIsRevealed(false) }}>
                  <span>{card.expression}</span>
                  <small>Caixa {card.box}</small>
                </button>
              </li>
            ))}
          </ol>
        </aside>

        <section className="flashcard" aria-live="polite">
          {activeCard ? (
            <>
              <div className="card-meta">
                <span>{activeCard.language === 'en-US' ? 'Inglês' : 'Francês'}</span>
                <span>Caixa {activeCard.box}</span>
                {activeCard.tags && <span>{activeCard.tags}</span>}
              </div>
              <h2>{activeCard.expression}</h2>
              <button className="listen" onClick={() => speak(activeCard.expression, activeCard.language)}>🔊 Ouvir expressão</button>
              {isRevealed ? (
                <div className="answer">
                  <p>{activeCard.translation}</p>
                  <blockquote>{activeCard.context}</blockquote>
                </div>
              ) : (
                <button className="reveal" onClick={() => setIsRevealed(true)}>Mostrar resposta</button>
              )}
              <div className="review-actions">
                {(Object.keys(resultLabels) as ReviewResult[]).map((result) => (
                  <button key={result} disabled={!isRevealed} onClick={() => reviewCard(result)} className={result}>{resultLabels[result]}</button>
                ))}
              </div>
            </>
          ) : (
            <div className="done-state"><h2>Revisão concluída 🎉</h2><p>Nenhum card vencido para o filtro selecionado.</p></div>
          )}
        </section>
      </section>

      <section className="implementation-plan">
        <h2>Como implantar o banco no Google Sheets</h2>
        <ol>
          <li>Abra a planilha, vá em Extensões → Apps Script e cole o arquivo <code>google-apps-script/Code.gs</code>.</li>
          <li>Execute <code>ensureSchema_</code> uma vez para criar/validar as abas <strong>Expressoes</strong> e <strong>Progresso</strong>.</li>
          <li>Publique como Web App com acesso permitido para você; copie a URL terminada em <code>/exec</code>.</li>
          <li>Cole essa URL no campo acima. O app busca cards vencidos por <code>doGet</code> e salva revisões por <code>doPost</code>.</li>
          <li>A aba <strong>Expressoes</strong> guarda o conteúdo estudado; a aba <strong>Progresso</strong> guarda caixa, repetições, lapsos e próxima revisão.</li>
        </ol>
      </section>
    </main>
  )
}
