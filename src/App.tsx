import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type ReviewResult = 'short' | 'standard' | 'long'
type Language = 'en-US' | 'fr-FR'
type Example = { text: string; translation: string }

type Card = {
  id: string
  text: string
  original: string
  type: string
  ipa: string
  ipaComment: string
  translation: string
  examples: Example[]
  language: string
  box: number
  repetitions: number
  hardCount: number
  lastResult: string
  lastReviewedAt: string
  nextReview: string
}

type PendingReview = { id: string; text: string; result: ReviewResult; at: string }

const SCRIPT_URL_KEY = 'reviewScriptUrl'
const PENDING_KEY = 'reviewPendingQueue'
const NEW_PER_BATCH = 20

// Mesma escada de intervalos do Apps Script (apps-script/Code.gs).
const INTERVALS = [1, 3, 7, 16, 35, 70, 140]
const SHORT_INTERVAL_DAYS = 1

const RESULT_META: Record<ReviewResult, { label: string; hint: string; key: string }> = {
  short: { label: 'Pouco tempo', hint: 'ainda difícil', key: '1' },
  standard: { label: 'Tempo padrão', hint: 'lembrei com esforço', key: '2' },
  long: { label: 'Muito tempo', hint: 'fácil, já sei', key: '3' },
}

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

function scheduleDays(box: number, result: ReviewResult) {
  const maxBox = INTERVALS.length - 1
  if (result === 'short') return { box: Math.max(0, box - 1), days: SHORT_INTERVAL_DAYS }
  if (result === 'long') {
    const nextBox = Math.min(maxBox, box + 2)
    return { box: nextBox, days: INTERVALS[nextBox] }
  }
  const nextBox = Math.min(maxBox, box + 1)
  return { box: nextBox, days: INTERVALS[Math.min(maxBox, box)] }
}

function addDaysKey(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

const FRENCH_WORDS =
  /(^|\s)(le|la|les|un|une|des|du|est|et|je|tu|il|elle|on|nous|vous|ne|pas|que|qui|quoi|avec|pour|dans|sur|ça|c'est|d'un|d'une|être|avoir|très|tout|toute|aux)(\s|$|,|\.|!|\?)/i

function detectLanguage(card: Card): Language {
  const explicit = card.language.trim().toLowerCase()
  if (explicit) return explicit.startsWith('fr') ? 'fr-FR' : 'en-US'
  const text = card.text.toLowerCase()
  if (/[àâçéèêëîïôùûœ]/.test(text) || FRENCH_WORDS.test(text)) return 'fr-FR'
  return 'en-US'
}

let voicesCache: SpeechSynthesisVoice[] = []
if ('speechSynthesis' in window) {
  const loadVoices = () => {
    voicesCache = window.speechSynthesis.getVoices()
  }
  loadVoices()
  window.speechSynthesis.addEventListener('voiceschanged', loadVoices)
}

function speak(text: string, language: Language) {
  if (!('speechSynthesis' in window) || !text) return
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = language
  utterance.rate = language === 'fr-FR' ? 0.88 : 0.92
  const voice =
    voicesCache.find((item) => item.lang === language && item.localService) ||
    voicesCache.find((item) => item.lang === language) ||
    voicesCache.find((item) => item.lang.startsWith(language.slice(0, 2)))
  if (voice) utterance.voice = voice
  window.speechSynthesis.speak(utterance)
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function Highlighted({ text, term }: { text: string; term: string }) {
  const parts = useMemo(() => {
    if (!term) return [text]
    try {
      return text.split(new RegExp(`(${escapeRegExp(term)})`, 'gi'))
    } catch {
      return [text]
    }
  }, [text, term])
  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === term.toLowerCase() ? <mark key={index}>{part}</mark> : <span key={index}>{part}</span>,
      )}
    </>
  )
}

function loadPending(): PendingReview[] {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]') as PendingReview[]
  } catch {
    return []
  }
}

function savePending(pending: PendingReview[]) {
  localStorage.setItem(PENDING_KEY, JSON.stringify(pending))
}

function makeDemoCard(partial: Partial<Card> & Pick<Card, 'id' | 'text' | 'translation'>): Card {
  return {
    original: partial.text,
    type: 'palavra',
    ipa: '',
    ipaComment: '',
    examples: [],
    language: 'en',
    box: 0,
    repetitions: 0,
    hardCount: 0,
    lastResult: '',
    lastReviewedAt: '',
    nextReview: '',
    ...partial,
  }
}

const DEMO_CARDS: Card[] = [
  makeDemoCard({
    id: 'demo-1',
    text: 'snag',
    original: 'I snagged this on the way here',
    type: 'palavra',
    ipa: '/snæɡ/',
    ipaComment: "Vogal /æ/ aberta, entre 'é' e 'á'; o 'g' final é pronunciado.",
    translation: 'pegar rapidamente, conseguir (informal); enroscar',
    examples: [
      { text: 'I snagged the last ticket to the show.', translation: 'Consegui o último ingresso para o show.' },
      { text: 'My sweater snagged on the fence.', translation: 'Meu suéter enroscou na cerca.' },
    ],
  }),
  makeDemoCard({
    id: 'demo-2',
    text: 'obsèques',
    original: 'obsèques',
    type: 'palavra',
    ipa: '/ɔp.sɛk/',
    ipaComment: "ob-SÉK': o 'b' soa 'p' antes do 's'; o 's' final é mudo. Sempre no plural.",
    translation: 'funeral, exéquias',
    language: 'fr',
    examples: [
      { text: 'Les obsèques auront lieu vendredi.', translation: 'O funeral será na sexta-feira.' },
    ],
  }),
]

export default function App() {
  const [scriptUrl, setScriptUrl] = useState(() => localStorage.getItem(SCRIPT_URL_KEY) || '')
  const [draftUrl, setDraftUrl] = useState(scriptUrl)
  const [showSettings, setShowSettings] = useState(!scriptUrl)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  const [cards, setCards] = useState<Card[]>([])
  const [queue, setQueue] = useState<string[]>([])
  const [languageFilter, setLanguageFilter] = useState<'all' | Language>('all')
  const [isRevealed, setIsRevealed] = useState(false)
  const [doneCount, setDoneCount] = useState(0)
  const [pendingCount, setPendingCount] = useState(() => loadPending().length)
  const [dataVersion, setDataVersion] = useState(0)
  const flushing = useRef(false)
  const cardsRef = useRef<Card[]>([])

  const cardsById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards])
  const isDemo = !scriptUrl

  const flushPending = useCallback(async (url: string) => {
    if (flushing.current || !url) return
    const pending = loadPending()
    if (!pending.length) return
    flushing.current = true
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'reviewBatch', reviews: pending }),
      })
      const data = await response.json()
      if (data.ok) {
        savePending([])
        setPendingCount(0)
      }
    } catch {
      // continua na fila local; tentaremos de novo depois
    } finally {
      flushing.current = false
    }
  }, [])

  const loadCards = useCallback(
    async (url: string) => {
      if (!url) {
        setCards(DEMO_CARDS)
        setDataVersion((version) => version + 1)
        setStatus('ready')
        return
      }
      setStatus('loading')
      setErrorMessage('')
      try {
        await flushPending(url)
        const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}action=cards`)
        const data = await response.json()
        if (!data.ok) throw new Error(data.error || 'Resposta inválida do script.')
        setCards(data.cards as Card[])
        setDataVersion((version) => version + 1)
        setStatus('ready')
      } catch (error) {
        setStatus('error')
        setErrorMessage(error instanceof Error ? error.message : String(error))
      }
    },
    [flushPending],
  )

  useEffect(() => {
    loadCards(scriptUrl)
  }, [scriptUrl, loadCards])

  useEffect(() => {
    cardsRef.current = cards
  }, [cards])

  // Monta a fila da sessão: vencidas primeiro (mais atrasadas antes), depois novas.
  // Depende de dataVersion (não de cards) para não desmontar a fila a cada resposta —
  // cards marcados como "pouco tempo" reaparecem no fim da sessão.
  useEffect(() => {
    const today = todayKey()
    const eligible = cardsRef.current.filter(
      (card) => languageFilter === 'all' || detectLanguage(card) === languageFilter,
    )
    const dueReviewed = eligible
      .filter((card) => card.nextReview && card.nextReview <= today)
      .sort((a, b) => a.nextReview.localeCompare(b.nextReview))
    const fresh = eligible.filter((card) => !card.nextReview).slice(0, NEW_PER_BATCH)
    setQueue([...dueReviewed, ...fresh].map((card) => card.id))
    setIsRevealed(false)
  }, [dataVersion, languageFilter])

  const activeCard = queue.length ? cardsById.get(queue[0]) : undefined
  const activeLanguage: Language = activeCard ? detectLanguage(activeCard) : 'en-US'

  // Novas ainda não estudadas (respondidas ganham nextReview e saem do filtro).
  const remainingNew = useMemo(() => {
    const eligible = cards.filter((card) => languageFilter === 'all' || detectLanguage(card) === languageFilter)
    return eligible.filter((card) => !card.nextReview).length
  }, [cards, languageFilter])

  const sendReview = useCallback(
    (card: Card, result: ReviewResult) => {
      if (isDemo) return
      const review: PendingReview = { id: card.id, text: card.text, result, at: new Date().toISOString() }
      const pending = [...loadPending(), review]
      savePending(pending)
      setPendingCount(pending.length)
      flushPending(scriptUrl)
    },
    [isDemo, scriptUrl, flushPending],
  )

  const answer = useCallback(
    (result: ReviewResult) => {
      if (!activeCard || !isRevealed) return
      const next = scheduleDays(activeCard.box, result)
      const nextReview = addDaysKey(next.days)

      sendReview(activeCard, result)
      setCards((current) =>
        current.map((card) =>
          card.id === activeCard.id
            ? {
                ...card,
                box: next.box,
                repetitions: card.repetitions + 1,
                hardCount: card.hardCount + (result === 'short' ? 1 : 0),
                lastResult: result,
                lastReviewedAt: todayKey(),
                nextReview,
              }
            : card,
        ),
      )
      setQueue((current) => {
        const rest = current.slice(1)
        // "Pouco tempo": além de voltar amanhã, reaparece no fim desta sessão.
        return result === 'short' ? [...rest, activeCard.id] : rest
      })
      setDoneCount((count) => count + 1)
      setIsRevealed(false)
      if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    },
    [activeCard, isRevealed, sendReview],
  )

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement) return
      if (event.code === 'Space' || event.key === 'Enter') {
        if (!isRevealed && activeCard) {
          event.preventDefault()
          setIsRevealed(true)
        }
        return
      }
      if (event.key.toLowerCase() === 'p' && activeCard) {
        speak(activeCard.text, activeLanguage)
        return
      }
      const result = (Object.keys(RESULT_META) as ReviewResult[]).find((key) => RESULT_META[key].key === event.key)
      if (result) answer(result)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isRevealed, activeCard, activeLanguage, answer])

  function saveSettings() {
    const trimmed = draftUrl.trim()
    localStorage.setItem(SCRIPT_URL_KEY, trimmed)
    setScriptUrl(trimmed)
    setShowSettings(!trimmed)
    setDoneCount(0)
  }

  const dueTotal = queue.length
  const showOriginal =
    !!activeCard && !!activeCard.original && activeCard.original.toLowerCase() !== activeCard.text.toLowerCase()

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <h1>Revisão EN·FR</h1>
          <p>revisão espaçada da sua planilha</p>
        </div>
        <div className="chips">
          <span className="chip due">{dueTotal} na fila</span>
          <span className="chip done">{doneCount} feitas</span>
          {pendingCount > 0 && <span className="chip pending">{pendingCount} p/ sincronizar</span>}
          {isDemo && <span className="chip demo">modo demo</span>}
          <button className="icon-button" onClick={() => setShowSettings((value) => !value)} aria-label="Configurações">
            ⚙️
          </button>
        </div>
      </header>

      {showSettings && (
        <section className="settings">
          <label htmlFor="script-url">URL do App da Web (Apps Script)</label>
          <div className="settings-row">
            <input
              id="script-url"
              placeholder="https://script.google.com/macros/s/.../exec"
              value={draftUrl}
              onChange={(event) => setDraftUrl(event.target.value)}
            />
            <button onClick={saveSettings}>Salvar</button>
          </div>
          <small>
            Na planilha: Extensões → Apps Script → cole o código de <code>apps-script/Code.gs</code> → Implantar →
            App da Web (executar como você, acesso: qualquer pessoa com o link) → copie a URL <code>/exec</code>.
            O progresso é gravado na aba <strong>Progresso</strong>; a aba de palavras nunca é alterada.
          </small>
        </section>
      )}

      <div className="filters" role="tablist" aria-label="Filtro de idioma">
        {(
          [
            ['all', 'Todas'],
            ['en-US', 'Inglês'],
            ['fr-FR', 'Francês'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            className={languageFilter === value ? 'active' : ''}
            onClick={() => setLanguageFilter(value)}
          >
            {label}
          </button>
        ))}
        <button className="refresh" onClick={() => loadCards(scriptUrl)} disabled={status === 'loading'}>
          {status === 'loading' ? 'Carregando…' : '↻ Recarregar'}
        </button>
      </div>

      {status === 'error' && (
        <section className="notice error">
          <strong>Não consegui carregar a planilha.</strong>
          <p>{errorMessage}</p>
          <p>
            Confira se a URL termina em <code>/exec</code> e se a implantação tem acesso “Qualquer pessoa com o link”.
          </p>
        </section>
      )}

      {status !== 'error' && (
        <section className="flashcard" aria-live="polite">
          {status === 'loading' && !cards.length ? (
            <div className="done-state">
              <h2>Carregando cards…</h2>
            </div>
          ) : activeCard ? (
            <>
              <div className="card-meta">
                <span className={`lang ${activeLanguage === 'fr-FR' ? 'fr' : 'en'}`}>
                  {activeLanguage === 'fr-FR' ? '🇫🇷 Francês' : '🇬🇧 Inglês'}
                </span>
                {activeCard.type && <span>{activeCard.type}</span>}
                <span>caixa {activeCard.box}</span>
                {activeCard.repetitions > 0 && <span>{activeCard.repetitions}× revisada</span>}
              </div>

              <h2 className="expression">{activeCard.text}</h2>
              {activeCard.ipa && <p className="ipa">{activeCard.ipa}</p>}

              <div className="listen-row">
                <button className="listen" onClick={() => speak(activeCard.text, activeLanguage)}>
                  🔊 Ouvir
                </button>
                {showOriginal && (
                  <button className="listen ghost" onClick={() => speak(activeCard.original, activeLanguage)}>
                    💬 Ouvir frase original
                  </button>
                )}
              </div>

              {showOriginal && (
                <p className="original">
                  capturado de: <em>“{activeCard.original}”</em>
                </p>
              )}

              {isRevealed ? (
                <div className="answer">
                  <p className="translation">{activeCard.translation || 'Sem tradução na planilha.'}</p>

                  {activeCard.ipaComment && (
                    <p className="ipa-tip">
                      <span aria-hidden="true">🗣️</span> {activeCard.ipaComment}
                    </p>
                  )}

                  {activeCard.examples.length > 0 && (
                    <div className="examples">
                      <h3>Exemplos</h3>
                      {activeCard.examples.map((example, index) => (
                        <div className="example" key={index}>
                          <div className="example-line">
                            <p className="example-text">
                              <Highlighted text={example.text} term={activeCard.text} />
                            </p>
                            <button
                              className="mini-listen"
                              aria-label="Ouvir exemplo"
                              onClick={() => speak(example.text, activeLanguage)}
                            >
                              🔊
                            </button>
                          </div>
                          {example.translation && <p className="example-translation">{example.translation}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <button className="reveal" onClick={() => setIsRevealed(true)}>
                  Mostrar resposta <kbd>espaço</kbd>
                </button>
              )}

              <div className="review-actions">
                {(Object.keys(RESULT_META) as ReviewResult[]).map((result) => {
                  const days = scheduleDays(activeCard.box, result).days
                  return (
                    <button key={result} className={result} disabled={!isRevealed} onClick={() => answer(result)}>
                      <strong>{RESULT_META[result].label}</strong>
                      <span>{RESULT_META[result].hint}</span>
                      <small>{days === 1 ? 'volta amanhã' : `volta em ${days} dias`}</small>
                    </button>
                  )
                })}
              </div>
            </>
          ) : (
            <div className="done-state">
              <h2>Revisão concluída 🎉</h2>
              <p>
                {doneCount > 0
                  ? `Você revisou ${doneCount} ${doneCount === 1 ? 'card' : 'cards'} nesta sessão.`
                  : 'Nenhum card vencido para o filtro selecionado.'}
              </p>
              {remainingNew > 0 && (
                <button className="more-new" onClick={() => setDataVersion((version) => version + 1)}>
                  Estudar +{Math.min(NEW_PER_BATCH, remainingNew)} palavras novas
                </button>
              )}
            </div>
          )}
        </section>
      )}

      <footer className="foot">
        <span>{cards.length} itens na planilha</span>
        <span>atalhos: espaço revela · P ouve · 1 / 2 / 3 respondem</span>
      </footer>
    </main>
  )
}
