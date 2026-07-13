import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'

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
type SessionEntry = { id: string; text: string; translation: string; language: string; result: ReviewResult }
type SessionRecord = { at: string; entries: SessionEntry[] }

const SCRIPT_URL_KEY = 'reviewScriptUrl'
const PENDING_KEY = 'reviewPendingQueue'
const CARDS_CACHE_KEY = 'reviewCardsCache'
const SESSIONS_KEY = 'reviewSessions'
const NEW_PER_BATCH = 20
const MAX_SESSIONS = 30

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

function addDaysKey(days: number, from?: string) {
  const date = from ? new Date(from) : new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

const FRENCH_WORDS =
  /(^|\s)(le|la|les|un|une|des|du|est|et|je|tu|il|elle|on|nous|vous|ne|pas|que|qui|quoi|avec|pour|dans|sur|ça|c'est|d'un|d'une|être|avoir|très|tout|toute|aux)(\s|$|,|\.|!|\?)/i

function detectLanguage(card: Pick<Card, 'language' | 'text'>): Language {
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

function normalize(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const WORD_TOKEN = /([\p{L}\p{M}'’-]+)/u

/**
 * Texto com o termo do card destacado e cada palavra tocável: um toque abre
 * o painel de consulta (ouvir isolado + busca no banco local de cards).
 */
function SelectableText({
  text,
  term,
  language,
  onPick,
}: {
  text: string
  term: string
  language: Language
  onPick: (term: string, language: Language) => void
}) {
  const parts = useMemo(() => {
    if (!term) return [text]
    try {
      return text.split(new RegExp(`(${escapeRegExp(term)})`, 'gi'))
    } catch {
      return [text]
    }
  }, [text, term])

  function pickWord(event: ReactMouseEvent, word: string) {
    // com um trecho selecionado, quem responde é o handler de seleção do container
    if (window.getSelection()?.toString().trim()) return
    event.stopPropagation()
    onPick(word, language)
  }

  let key = 0
  return (
    <>
      {parts.map((part) =>
        part.toLowerCase() === term.toLowerCase() ? (
          <mark key={key++} className="pickable" onClick={(event) => pickWord(event, part)}>
            {part}
          </mark>
        ) : (
          part
            .split(WORD_TOKEN)
            .map((token) =>
              /[\p{L}\p{M}]/u.test(token) ? (
                <span key={key++} className="pickable" onClick={(event) => pickWord(event, token)}>
                  {token}
                </span>
              ) : (
                <span key={key++}>{token}</span>
              ),
            )
        ),
      )}
    </>
  )
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function loadPending(): PendingReview[] {
  return readJson<PendingReview[]>(PENDING_KEY, [])
}

function savePending(pending: PendingReview[]) {
  localStorage.setItem(PENDING_KEY, JSON.stringify(pending))
}

function loadSessions(): SessionRecord[] {
  return readJson<SessionRecord[]>(SESSIONS_KEY, [])
}

/** Reaplica localmente respostas ainda não sincronizadas sobre os dados do servidor. */
function applyPending(cards: Card[], pending: PendingReview[]): Card[] {
  if (!pending.length) return cards
  const byId = new Map(cards.map((card) => [card.id, { ...card }]))
  for (const review of pending) {
    const card = byId.get(review.id)
    if (!card) continue
    const next = scheduleDays(card.box, review.result)
    card.box = next.box
    card.repetitions += 1
    card.hardCount += review.result === 'short' ? 1 : 0
    card.lastResult = review.result
    card.lastReviewedAt = review.at.slice(0, 10)
    card.nextReview = addDaysKey(next.days, review.at)
  }
  return cards.map((card) => byId.get(card.id) as Card)
}

function formatSessionDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
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
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)
  const [fromCache, setFromCache] = useState(false)

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [browseId, setBrowseId] = useState<string | null>(null)
  const [picked, setPicked] = useState<{ term: string; language: Language } | null>(null)

  const [sessionEntries, setSessionEntries] = useState<SessionEntry[]>([])
  const [sessions, setSessions] = useState<SessionRecord[]>(() => loadSessions())
  const [lastSession, setLastSession] = useState<SessionRecord | null>(null)
  const [expandedSession, setExpandedSession] = useState<number | null>(null)

  const flushing = useRef(false)
  const cardsRef = useRef<Card[]>([])
  const prevQueueLength = useRef(0)
  const searchInputRef = useRef<HTMLInputElement>(null)

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
        setCards(applyPending(data.cards as Card[], loadPending()))
        setFromCache(false)
        setDataVersion((version) => version + 1)
        setStatus('ready')
      } catch (error) {
        // Sem rede (ou script fora do ar): usa a última cópia local dos cards.
        const cached = readJson<{ at: string; cards: Card[] } | null>(CARDS_CACHE_KEY, null)
        if (cached && cached.cards.length) {
          setCards(cached.cards)
          setFromCache(true)
          setDataVersion((version) => version + 1)
          setStatus('ready')
        } else {
          setStatus('error')
          setErrorMessage(error instanceof Error ? error.message : String(error))
        }
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

  // Guarda a cópia local dos cards (com o progresso já aplicado) para uso offline.
  useEffect(() => {
    if (isDemo || !cards.length) return
    try {
      localStorage.setItem(CARDS_CACHE_KEY, JSON.stringify({ at: new Date().toISOString(), cards }))
    } catch {
      // sem espaço no storage: o app segue, só perde o modo offline
    }
  }, [cards, isDemo])

  // Ao voltar a conexão, sincroniza as respostas pendentes (sem desmontar a sessão).
  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true)
      flushPending(scriptUrl)
    }
    const onOffline = () => setIsOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [scriptUrl, flushPending])

  // Retentativa periódica: cobre o caso em que o evento "online" chega
  // enquanto uma tentativa de sync ainda está falhando.
  useEffect(() => {
    if (!pendingCount || isDemo) return
    const timer = window.setInterval(() => {
      if (navigator.onLine) flushPending(scriptUrl)
    }, 15000)
    return () => window.clearInterval(timer)
  }, [pendingCount, isDemo, scriptUrl, flushPending])

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

  // Fim de sessão: salva o resumo no histórico local e o exibe no card de conclusão.
  useEffect(() => {
    if (prevQueueLength.current > 0 && queue.length === 0 && sessionEntries.length > 0) {
      const record: SessionRecord = { at: new Date().toISOString(), entries: sessionEntries }
      const updated = [record, ...loadSessions()].slice(0, MAX_SESSIONS)
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(updated))
      setSessions(updated)
      setLastSession(record)
      setSessionEntries([])
    }
    prevQueueLength.current = queue.length
  }, [queue, sessionEntries])

  const activeCard = queue.length ? cardsById.get(queue[0]) : undefined
  const activeLanguage: Language = activeCard ? detectLanguage(activeCard) : 'en-US'
  const browseCard = browseId ? cardsById.get(browseId) : undefined

  // Novas ainda não estudadas (respondidas ganham nextReview e saem do filtro).
  const remainingNew = useMemo(() => {
    const eligible = cards.filter((card) => languageFilter === 'all' || detectLanguage(card) === languageFilter)
    return eligible.filter((card) => !card.nextReview).length
  }, [cards, languageFilter])

  const pick = useCallback((term: string, language: Language) => {
    const trimmed = term.trim()
    if (trimmed) setPicked({ term: trimmed, language })
  }, [])

  // Seleção nativa (arrastar no desktop, toque longo no celular) dentro dos
  // exemplos: consulta o trecho selecionado inteiro.
  const handleTextSelection = useCallback(
    (language: Language) => {
      const text = window.getSelection()?.toString().trim() || ''
      if (!text || text.length > 80 || text.split(/\s+/).length > 8) return
      pick(text, language)
    },
    [pick],
  )

  // Pesquisa do termo tocado no banco local: cards cujo texto casa com o termo
  // (exatos primeiro) e cards que apenas o citam nos exemplos/frase original.
  const pickedMatches = useMemo(() => {
    if (!picked) return { direct: [] as Card[], mentions: [] as Card[] }
    const query = normalize(picked.term)
    if (!query) return { direct: [] as Card[], mentions: [] as Card[] }
    const loose = query.length >= 3
    const direct: Card[] = []
    const mentions: Card[] = []
    for (const card of cards) {
      const text = normalize(card.text)
      if (text === query || (loose && (text.includes(query) || query.includes(text)))) {
        direct.push(card)
      } else if (loose && normalize([card.original, ...card.examples.map((e) => e.text)].join(' ')).includes(query)) {
        mentions.push(card)
      }
    }
    direct.sort((a, b) => Number(normalize(b.text) === query) - Number(normalize(a.text) === query))
    return { direct: direct.slice(0, 3), mentions: mentions.slice(0, 3) }
  }, [picked, cards])

  const searchResults = useMemo(() => {
    const query = normalize(searchQuery.trim())
    if (!query) return []
    return cards
      .filter((card) => {
        const haystack = normalize(
          [
            card.text,
            card.original,
            card.translation,
            ...card.examples.map((example) => `${example.text} ${example.translation}`),
          ].join(' '),
        )
        return haystack.includes(query)
      })
      .slice(0, 40)
  }, [cards, searchQuery])

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
      setSessionEntries((current) => {
        const entry: SessionEntry = {
          id: activeCard.id,
          text: activeCard.text,
          translation: activeCard.translation,
          language: activeCard.language,
          result,
        }
        const existing = current.findIndex((item) => item.id === entry.id)
        if (existing >= 0) return current.map((item, index) => (index === existing ? entry : item))
        return [...current, entry]
      })
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
      if (event.target instanceof HTMLInputElement) {
        if (event.key === 'Escape') {
          setSearchOpen(false)
          setSearchQuery('')
        }
        return
      }
      if (event.key === 'Escape') {
        if (picked) setPicked(null)
        else if (browseId) setBrowseId(null)
        else if (searchOpen) {
          setSearchOpen(false)
          setSearchQuery('')
        }
        return
      }
      if (picked || browseId || searchOpen) return
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
  }, [isRevealed, activeCard, activeLanguage, answer, browseId, searchOpen, picked])

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  function saveSettings() {
    const trimmed = draftUrl.trim()
    localStorage.setItem(SCRIPT_URL_KEY, trimmed)
    setScriptUrl(trimmed)
    setShowSettings(!trimmed)
    setDoneCount(0)
  }

  function practiceNow(id: string) {
    setQueue((current) => [id, ...current.filter((item) => item !== id)])
    setBrowseId(null)
    setSearchOpen(false)
    setSearchQuery('')
    setIsRevealed(false)
  }

  function renderCardDetail(card: Card) {
    const language = detectLanguage(card)
    const original = card.original && card.original.toLowerCase() !== card.text.toLowerCase() ? card.original : ''
    return (
      <div className="browse">
        <div className="browse-top">
          <button className="back" onClick={() => setBrowseId(null)}>
            ← Voltar
          </button>
          <button className="practice" onClick={() => practiceNow(card.id)}>
            🎯 Praticar agora
          </button>
        </div>

        <div className="card-meta">
          <span className={`lang ${language === 'fr-FR' ? 'fr' : 'en'}`}>
            {language === 'fr-FR' ? '🇫🇷 Francês' : '🇬🇧 Inglês'}
          </span>
          {card.type && <span>{card.type}</span>}
          <span>caixa {card.box}</span>
          {card.repetitions > 0 && <span>{card.repetitions}× revisada</span>}
          {card.nextReview && <span>volta {card.nextReview}</span>}
        </div>

        <h2 className="expression">{card.text}</h2>
        {card.ipa && <p className="ipa">{card.ipa}</p>}

        <div className="listen-row">
          <button className="listen" onClick={() => speak(card.text, language)}>
            🔊 Ouvir
          </button>
          {original && (
            <button className="listen ghost" onClick={() => speak(original, language)}>
              💬 Ouvir frase original
            </button>
          )}
        </div>

        {original && (
          <p
            className="original selectable"
            onMouseUp={() => handleTextSelection(language)}
            onTouchEnd={() => handleTextSelection(language)}
          >
            capturado de:{' '}
            <em>
              “<SelectableText text={original} term={card.text} language={language} onPick={pick} />”
            </em>
          </p>
        )}

        <div className="answer">
          <p className="translation">{card.translation || 'Sem tradução na planilha.'}</p>
          {card.ipaComment && (
            <p className="ipa-tip">
              <span aria-hidden="true">🗣️</span> {card.ipaComment}
            </p>
          )}
          {card.examples.length > 0 && (
            <div className="examples">
              <h3>
                Exemplos <span className="examples-hint">· toque numa palavra para ouvir ou consultar</span>
              </h3>
              {card.examples.map((example, index) => (
                <div className="example" key={index}>
                  <div className="example-line">
                    <p
                      className="example-text selectable"
                      onMouseUp={() => handleTextSelection(language)}
                      onTouchEnd={() => handleTextSelection(language)}
                    >
                      <SelectableText text={example.text} term={card.text} language={language} onPick={pick} />
                    </p>
                    <button
                      className="mini-listen"
                      aria-label="Ouvir exemplo"
                      onClick={() => speak(example.text, language)}
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
      </div>
    )
  }

  function renderSummary(record: SessionRecord, title: string) {
    const counts = record.entries.reduce(
      (tally, entry) => {
        tally[entry.result] += 1
        return tally
      },
      { short: 0, standard: 0, long: 0 } as Record<ReviewResult, number>,
    )
    return (
      <div className="summary">
        <div className="summary-head">
          <h3>{title}</h3>
          <span>{formatSessionDate(record.at)}</span>
        </div>
        <div className="summary-counts">
          <span className="count short">{counts.short} difícil</span>
          <span className="count standard">{counts.standard} padrão</span>
          <span className="count long">{counts.long} fácil</span>
        </div>
        <ul className="summary-list">
          {record.entries.map((entry) => {
            const known = cardsById.has(entry.id)
            return (
              <li key={entry.id}>
                <button
                  className="entry"
                  disabled={!known}
                  onClick={() => known && setBrowseId(entry.id)}
                >
                  <span className={`dot ${entry.result}`} aria-hidden="true" />
                  <span className="entry-text">{entry.text}</span>
                  <span className="entry-translation">{entry.translation}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    )
  }

  const dueTotal = queue.length
  const showOriginal =
    !!activeCard && !!activeCard.original && activeCard.original.toLowerCase() !== activeCard.text.toLowerCase()
  const previousSessions = lastSession ? sessions.slice(1) : sessions

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
          {!isOnline && <span className="chip offline">✈️ offline</span>}
          {isOnline && fromCache && <span className="chip offline">dados locais</span>}
          {pendingCount > 0 && <span className="chip pending">{pendingCount} p/ sincronizar</span>}
          {isDemo && <span className="chip demo">modo demo</span>}
          <button
            className="icon-button"
            onClick={() => {
              setSearchOpen((value) => !value)
              setSearchQuery('')
              setBrowseId(null)
            }}
            aria-label="Buscar expressões"
          >
            🔍
          </button>
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

      {searchOpen && (
        <section className="searchbar">
          <input
            ref={searchInputRef}
            type="search"
            placeholder="Buscar expressão, tradução ou exemplo…"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            aria-label="Buscar expressões"
          />
          <button
            onClick={() => {
              setSearchOpen(false)
              setSearchQuery('')
            }}
          >
            Fechar
          </button>
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
          {browseCard ? (
            renderCardDetail(browseCard)
          ) : searchOpen ? (
            <div className="search-results">
              {searchQuery.trim() === '' ? (
                <p className="search-hint">Digite para buscar entre {cards.length} expressões salvas.</p>
              ) : searchResults.length === 0 ? (
                <p className="search-hint">Nada encontrado para “{searchQuery}”.</p>
              ) : (
                <ul>
                  {searchResults.map((card) => {
                    const language = detectLanguage(card)
                    return (
                      <li key={card.id}>
                        <button className="result" onClick={() => setBrowseId(card.id)}>
                          <span className="result-text">
                            {card.text}
                            <small>{language === 'fr-FR' ? '🇫🇷' : '🇬🇧'} {card.nextReview ? `caixa ${card.box}` : 'nova'}</small>
                          </span>
                          <span className="result-translation">{card.translation}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          ) : status === 'loading' && !cards.length ? (
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
                <p
                  className="original selectable"
                  onMouseUp={() => handleTextSelection(activeLanguage)}
                  onTouchEnd={() => handleTextSelection(activeLanguage)}
                >
                  capturado de:{' '}
                  <em>
                    “
                    <SelectableText
                      text={activeCard.original}
                      term={activeCard.text}
                      language={activeLanguage}
                      onPick={pick}
                    />
                    ”
                  </em>
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
                      <h3>
                        Exemplos <span className="examples-hint">· toque numa palavra para ouvir ou consultar</span>
                      </h3>
                      {activeCard.examples.map((example, index) => (
                        <div className="example" key={index}>
                          <div className="example-line">
                            <p
                              className="example-text selectable"
                              onMouseUp={() => handleTextSelection(activeLanguage)}
                              onTouchEnd={() => handleTextSelection(activeLanguage)}
                            >
                              <SelectableText
                                text={example.text}
                                term={activeCard.text}
                                language={activeLanguage}
                                onPick={pick}
                              />
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
                {lastSession
                  ? 'Sessão salva. Toque numa expressão para revê-la.'
                  : 'Nenhum card vencido para o filtro selecionado.'}
              </p>

              {lastSession && renderSummary(lastSession, 'Resumo da sessão')}

              {remainingNew > 0 && (
                <button className="more-new" onClick={() => setDataVersion((version) => version + 1)}>
                  Estudar +{Math.min(NEW_PER_BATCH, remainingNew)} palavras novas
                </button>
              )}

              {previousSessions.length > 0 && (
                <div className="history">
                  <h3>Sessões anteriores</h3>
                  <ul>
                    {previousSessions.map((record, index) => (
                      <li key={record.at}>
                        <button
                          className="history-item"
                          onClick={() => setExpandedSession(expandedSession === index ? null : index)}
                        >
                          <span>{formatSessionDate(record.at)}</span>
                          <span>{record.entries.length} cards</span>
                        </button>
                        {expandedSession === index && renderSummary(record, 'Sessão')}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {picked && (
        <div className="sheet-backdrop" onClick={() => setPicked(null)}>
          <div className="word-sheet" role="dialog" aria-label={`Consulta: ${picked.term}`} onClick={(event) => event.stopPropagation()}>
            <div className="word-sheet-head">
              <strong className="word-term">{picked.term}</strong>
              <div className="word-sheet-actions">
                <button className="listen" onClick={() => speak(picked.term, picked.language)}>
                  🔊 Ouvir
                </button>
                <button className="word-close" aria-label="Fechar" onClick={() => setPicked(null)}>
                  ✕
                </button>
              </div>
            </div>

            {pickedMatches.direct.length > 0 ? (
              <ul className="word-matches">
                {pickedMatches.direct.map((match) => (
                  <li key={match.id}>
                    <button
                      onClick={() => {
                        setPicked(null)
                        setBrowseId(match.id)
                      }}
                    >
                      <span className="match-text">{match.text}</span>
                      <span className="match-translation">{match.translation || 'sem tradução'}</span>
                      <span className="match-open">ver card →</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="word-none">Não está na sua lista de palavras.</p>
            )}

            {pickedMatches.mentions.length > 0 && (
              <div className="word-mentions">
                <h4>Aparece nos exemplos de</h4>
                <ul className="word-matches">
                  {pickedMatches.mentions.map((match) => (
                    <li key={match.id}>
                      <button
                        onClick={() => {
                          setPicked(null)
                          setBrowseId(match.id)
                        }}
                      >
                        <span className="match-text">{match.text}</span>
                        <span className="match-translation">{match.translation || 'sem tradução'}</span>
                        <span className="match-open">ver card →</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <button
              className="word-search"
              onClick={() => {
                setSearchQuery(picked.term)
                setSearchOpen(true)
                setBrowseId(null)
                setPicked(null)
              }}
            >
              🔍 Buscar “{picked.term}” no app
            </button>
          </div>
        </div>
      )}

      <footer className="foot">
        <span>{cards.length} itens na planilha</span>
        <span>atalhos: espaço revela · P ouve · 1 / 2 / 3 respondem</span>
      </footer>
    </main>
  )
}
