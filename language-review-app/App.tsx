import { useEffect, useMemo, useState } from 'react'

type ReviewResult = 'again' | 'hard' | 'good' | 'easy'
type Language = 'all' | 'en-US' | 'fr-FR'

type Flashcard = {
  id: string
  expression: string
  translation: string
  context: string
  language: 'en-US' | 'fr-FR'
  tags?: string
  ipa?: string
  box: number
  repetitions: number
  lapses: number
  nextReview: string
  lastResult?: ReviewResult | ''
}

type ReviewStats = {
  totalExpressions: number
  dueToday: number
  reviewedExpressions: number
  totalReviews: number
  totalLapses: number
}

const appsScriptUrlStorageKey = 'epub-fr.review.appsScriptUrl'
const today = new Date().toISOString().slice(0, 10)

const demoCards: Flashcard[] = [
  {
    id: 'demo-keep-track',
    expression: 'To keep track of',
    translation: 'Acompanhar / manter registro de',
    context: 'I use a review app to keep track of new expressions.',
    language: 'en-US',
    tags: 'demo · expression',
    box: 1,
    repetitions: 0,
    lapses: 0,
    nextReview: today,
  },
  {
    id: 'demo-ca-vaut-le-coup',
    expression: 'Ça vaut le coup',
    translation: 'Vale a pena',
    context: 'Réviser un peu tous les jours, ça vaut le coup.',
    language: 'fr-FR',
    tags: 'demo · conversation',
    box: 2,
    repetitions: 3,
    lapses: 1,
    nextReview: today,
  },
]

const resultLabels: Record<ReviewResult, string> = {
  again: 'Errei',
  hard: 'Difícil',
  good: 'Bom',
  easy: 'Fácil',
}

function normalizeCard(card: Partial<Flashcard>): Flashcard {
  return {
    id: String(card.id || ''),
    expression: card.expression || '',
    translation: card.translation || '',
    context: card.context || '',
    language: card.language === 'fr-FR' ? 'fr-FR' : 'en-US',
    tags: card.tags || '',
    ipa: card.ipa || '',
    box: Number(card.box || 1),
    repetitions: Number(card.repetitions || 0),
    lapses: Number(card.lapses || 0),
    nextReview: card.nextReview || today,
    lastResult: card.lastResult || '',
  }
}

function speak(text: string, language: string) {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = language
  utterance.rate = language === 'fr-FR' ? 0.88 : 0.92
  window.speechSynthesis.speak(utterance)
}

export default function App() {
  const [appsScriptUrl, setAppsScriptUrl] = useState(() => localStorage.getItem(appsScriptUrlStorageKey) || '')
  const [draftUrl, setDraftUrl] = useState(appsScriptUrl)
  const [cards, setCards] = useState<Flashcard[]>(demoCards)
  const [stats, setStats] = useState<ReviewStats | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [isAnswerVisible, setIsAnswerVisible] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [statusMessage, setStatusMessage] = useState(appsScriptUrl ? 'Script conectado.' : 'Modo demonstração. Configure o Apps Script no menu.')
  const [languageFilter, setLanguageFilter] = useState<Language>('all')

  const visibleCards = useMemo(
    () => cards.filter((card) => languageFilter === 'all' || card.language === languageFilter),
    [cards, languageFilter],
  )
  const activeCard = visibleCards[activeIndex] ?? visibleCards[0]
  const localStats = stats || {
    totalExpressions: cards.length,
    dueToday: cards.filter((card) => card.nextReview <= today).length,
    reviewedExpressions: cards.filter((card) => card.repetitions > 0).length,
    totalReviews: cards.reduce((sum, card) => sum + card.repetitions, 0),
    totalLapses: cards.reduce((sum, card) => sum + card.lapses, 0),
  }

  useEffect(() => {
    localStorage.setItem(appsScriptUrlStorageKey, appsScriptUrl)
  }, [appsScriptUrl])

  function saveSettings() {
    const nextUrl = draftUrl.trim()
    setAppsScriptUrl(nextUrl)
    setStatusMessage(nextUrl ? 'URL do Apps Script salva para futuras sessões.' : 'URL removida. Voltando ao modo demonstração.')
    setIsSettingsOpen(false)
  }

  async function syncWithSheet() {
    if (!appsScriptUrl) {
      setStatusMessage('Abra Configurações e informe a URL /exec do Apps Script antes de sincronizar.')
      setIsSettingsOpen(true)
      return
    }

    setIsSyncing(true)
    setStatusMessage('Carregando revisões vencidas da planilha...')
    const dueParams = new URLSearchParams({ action: 'due', language: languageFilter })
    const statsParams = new URLSearchParams({ action: 'stats' })
    const [dueResponse, statsResponse] = await Promise.all([
      fetch(`${appsScriptUrl}?${dueParams.toString()}`),
      fetch(`${appsScriptUrl}?${statsParams.toString()}`),
    ])
    const dueData = await dueResponse.json()
    const statsData = await statsResponse.json()
    const nextCards = Array.isArray(dueData) ? dueData.map(normalizeCard) : []
    setCards(nextCards)
    setStats(statsData)
    setActiveIndex(0)
    setIsAnswerVisible(false)
    setStatusMessage(`${nextCards.length} card(s) vencido(s) carregado(s).`)
    setIsSyncing(false)
  }

  async function reviewCard(result: ReviewResult) {
    if (!activeCard) return

    if (appsScriptUrl && !activeCard.id.startsWith('demo-')) {
      setStatusMessage('Salvando progresso na aba Progresso...')
      await fetch(appsScriptUrl, {
        method: 'POST',
        body: JSON.stringify({ action: 'review', expressionId: activeCard.id, result }),
      })
      setCards((currentCards) => currentCards.filter((card) => card.id !== activeCard.id))
      setStatusMessage('Progresso salvo. Card removido da fila de hoje.')
    } else {
      setCards((currentCards) => currentCards.filter((card) => card.id !== activeCard.id))
      setStatusMessage('Resposta registrada no modo demonstração.')
    }

    setActiveIndex((index) => Math.max(0, Math.min(index, visibleCards.length - 2)))
    setIsAnswerVisible(false)
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Revisão espaçada</p>
          <h1>Expressões em inglês e francês</h1>
        </div>
        <button className="settings-button" onClick={() => setIsSettingsOpen(true)} aria-haspopup="dialog">
          ⚙️ Configurações
        </button>
      </header>

      <section className="hero-card">
        <div>
          <span className="connection-pill">{appsScriptUrl ? 'Google Sheets conectado' : 'Modo demonstração'}</span>
          <h2>Revise apenas o que venceu hoje.</h2>
          <p>
            O app lê a aba <strong>palavras</strong>, salva seu desempenho em <strong>Progresso</strong> e mantém a URL do Apps Script guardada neste navegador.
          </p>
        </div>
        <button className="primary-action" onClick={syncWithSheet} disabled={isSyncing}>
          {isSyncing ? 'Sincronizando...' : 'Sincronizar agora'}
        </button>
      </section>

      <section className="dashboard" aria-label="Resumo">
        <article><strong>{localStats.dueToday}</strong><span>vencidas hoje</span></article>
        <article><strong>{localStats.totalExpressions}</strong><span>expressões</span></article>
        <article><strong>{localStats.reviewedExpressions}</strong><span>já revisadas</span></article>
        <article><strong>{localStats.totalLapses}</strong><span>erros acumulados</span></article>
      </section>

      <section className="study-grid">
        <aside className="queue-panel">
          <div className="panel-header">
            <h2>Fila</h2>
            <span>{visibleCards.length} cards</span>
          </div>
          <div className="filters" aria-label="Filtrar idioma">
            <button className={languageFilter === 'all' ? 'active' : ''} onClick={() => setLanguageFilter('all')}>Todos</button>
            <button className={languageFilter === 'en-US' ? 'active' : ''} onClick={() => setLanguageFilter('en-US')}>Inglês</button>
            <button className={languageFilter === 'fr-FR' ? 'active' : ''} onClick={() => setLanguageFilter('fr-FR')}>Francês</button>
          </div>
          <ol className="queue-list">
            {visibleCards.map((card, index) => (
              <li key={card.id}>
                <button className={card.id === activeCard?.id ? 'selected' : ''} onClick={() => { setActiveIndex(index); setIsAnswerVisible(false) }}>
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
                <span>{activeCard.language === 'fr-FR' ? 'Francês' : 'Inglês'}</span>
                <span>Caixa {activeCard.box}</span>
                {activeCard.tags && <span>{activeCard.tags}</span>}
              </div>
              <h2>{activeCard.expression}</h2>
              {activeCard.ipa && <p className="ipa">/{activeCard.ipa}/</p>}
              <button className="listen-button" onClick={() => speak(activeCard.expression, activeCard.language)}>🔊 Ouvir</button>

              {isAnswerVisible ? (
                <div className="answer-box">
                  <strong>{activeCard.translation || 'Sem tradução cadastrada'}</strong>
                  {activeCard.context && <p>{activeCard.context}</p>}
                </div>
              ) : (
                <button className="reveal-button" onClick={() => setIsAnswerVisible(true)}>Mostrar resposta</button>
              )}

              <div className="review-actions">
                {(Object.keys(resultLabels) as ReviewResult[]).map((result) => (
                  <button key={result} disabled={!isAnswerVisible} className={result} onClick={() => reviewCard(result)}>
                    {resultLabels[result]}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="done-state">
              <h2>Nenhum card na fila 🎉</h2>
              <p>Sincronize com a planilha ou altere o filtro para continuar.</p>
            </div>
          )}
        </section>
      </section>

      <p className="status-line" role="status">{statusMessage}</p>

      {isSettingsOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div className="modal-header">
              <div>
                <p className="eyebrow">Configurações</p>
                <h2 id="settings-title">Conexão com Google Apps Script</h2>
              </div>
              <button className="icon-button" onClick={() => setIsSettingsOpen(false)} aria-label="Fechar configurações">×</button>
            </div>
            <label htmlFor="apps-script-url">URL do Web App publicada com final /exec</label>
            <input
              id="apps-script-url"
              placeholder="https://script.google.com/macros/s/.../exec"
              value={draftUrl}
              onChange={(event) => setDraftUrl(event.target.value)}
            />
            <p>
              Essa URL fica salva no navegador via localStorage para que você não precise informá-la novamente nas próximas sessões.
            </p>
            <div className="modal-actions">
              <button className="secondary-action" onClick={() => setDraftUrl('')}>Limpar URL</button>
              <button className="primary-action" onClick={saveSettings}>Salvar configurações</button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}
