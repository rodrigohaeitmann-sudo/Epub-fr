import { useMemo, useState } from 'react'

type Flashcard = {
  id: number
  expression: string
  translation: string
  context: string
  language: 'en-US' | 'fr-FR'
  box: number
  nextReview: string
  lastResult?: 'again' | 'hard' | 'good' | 'easy'
}

const today = new Date().toISOString().slice(0, 10)

const initialCards: Flashcard[] = [
  {
    id: 1,
    expression: 'To keep track of',
    translation: 'Acompanhar / manter registro de',
    context: 'I use this app to keep track of new expressions.',
    language: 'en-US',
    box: 1,
    nextReview: today,
  },
  {
    id: 2,
    expression: 'Ça vaut le coup',
    translation: 'Vale a pena',
    context: 'Revoir les cartes tous les jours, ça vaut le coup.',
    language: 'fr-FR',
    box: 2,
    nextReview: today,
  },
  {
    id: 3,
    expression: 'Break it down',
    translation: 'Dividir em partes / explicar passo a passo',
    context: 'Can you break it down for me?',
    language: 'en-US',
    box: 3,
    nextReview: '2026-07-05',
  },
]

const intervals = [0, 1, 3, 7, 14, 30]
const resultLabels = {
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
  const [languageFilter, setLanguageFilter] = useState<'all' | Flashcard['language']>('all')
  const [sheetUrl, setSheetUrl] = useState('https://docs.google.com/spreadsheets/d/16-aQt2D31-0tjq8gWAf6tDUYzZ6cbK-uzMq8IQ5mtr8/edit?usp=sharing')

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

  function reviewCard(result: keyof typeof resultLabels) {
    if (!activeCard) return
    const direction = result === 'again' ? -1 : result === 'hard' ? 0 : result === 'good' ? 1 : 2
    const nextBox = Math.min(5, Math.max(1, activeCard.box + direction))
    const nextReview = addDays(result === 'again' ? 0 : intervals[nextBox])

    setCards((currentCards) =>
      currentCards.map((card) =>
        card.id === activeCard.id ? { ...card, box: nextBox, nextReview, lastResult: result } : card,
      ),
    )
    setIsRevealed(false)
    setActiveIndex((index) => Math.max(0, Math.min(index, dueCards.length - 2)))
  }

  return (
    <main className="app-shell">
      <section className="hero" aria-labelledby="app-title">
        <div>
          <p className="eyebrow">Flashcards + revisão espaçada</p>
          <h1 id="app-title">Vocabulário Inglês/Francês</h1>
          <p className="hero-copy">
            Revise expressões vindas da sua planilha, ouça a pronúncia e reprograme cada card de
            acordo com sua resposta.
          </p>
        </div>
        <div className="sheet-panel">
          <label htmlFor="sheet-url">Planilha de origem</label>
          <input id="sheet-url" value={sheetUrl} onChange={(event) => setSheetUrl(event.target.value)} />
          <small>Próximo passo: publicar CSV/Google Sheets API para sincronizar automaticamente.</small>
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
                {(Object.keys(resultLabels) as Array<keyof typeof resultLabels>).map((result) => (
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
        <h2>Plano de implementação</h2>
        <ol>
          <li>Definir colunas da planilha: expressão, idioma, tradução, contexto, tags e data de criação.</li>
          <li>Importar dados via CSV publicado ou Google Sheets API e normalizar registros em cards.</li>
          <li>Persistir progresso no navegador e, depois, sincronizar com backend ou planilha auxiliar.</li>
          <li>Aplicar algoritmo Leitner/SM-2 com botões Errei, Difícil, Bom e Fácil.</li>
          <li>Usar Web Speech API para pronúncia em inglês e francês, com fallback textual.</li>
          <li>Adicionar busca, estatísticas por idioma/tag e modo offline PWA.</li>
        </ol>
      </section>
    </main>
  )
}
