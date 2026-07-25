import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { frenchIpa } from './ipa'

type ReviewResult = 'short' | 'standard' | 'long'
type Language = 'en-US' | 'fr-FR'
type Example = { text: string; translation: string }
type Conjugation = { tense: string; fr: string; pt: string }

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
  grammarClass?: string
  verbType?: string
  conjugations?: Conjugation[]
  source?: CardSource
  theme?: string
  box: number
  repetitions: number
  hardCount: number
  lastResult: string
  lastReviewedAt: string
  nextReview: string
}

type CardSource = 'words' | 'phrases'
type PendingReview = { id: string; text: string; result: ReviewResult; at: string; target?: CardSource }
type SessionEntry = { id: string; text: string; translation: string; language: string; result: ReviewResult }
type SessionRecord = { at: string; entries: SessionEntry[]; mode?: string }

type StudyMode = 'suggested' | 'review' | 'new' | 'phrases' | 'phrasesReview' | 'phrasesNew' | 'practice'

const MODE_LABEL: Record<StudyMode, string> = {
  suggested: 'Estudo sugerido',
  review: 'Revisão',
  new: 'Novas',
  phrases: 'Frases sugeridas',
  phrasesReview: 'Frases · revisão',
  phrasesNew: 'Frases · novas',
  practice: 'Prática',
}

const BLOCK_SIZE = 10
const SUGGESTED_REVIEW_SHARE = 5

const SCRIPT_URL_KEY = 'reviewScriptUrl'
const PENDING_KEY = 'reviewPendingQueue'
const CARDS_CACHE_KEY = 'reviewCardsCache'
const PHRASES_URL_KEY = 'phrasesScriptUrl'
const PHRASES_CACHE_KEY = 'reviewPhrasesCache'
const THEMES_KEY = 'phraseThemes'
const TRANSLATION_CACHE_KEY = 'lookupTranslations'
const SESSIONS_KEY = 'reviewSessions'
const MAX_SESSIONS = 30

// Mesma escada de intervalos do Apps Script (apps-script/Code.gs).
const INTERVALS = [1, 3, 7, 16, 35, 70, 140]
const SHORT_INTERVAL_DAYS = 1

const RESULT_META: Record<ReviewResult, { label: string; key: string }> = {
  short: { label: 'Difícil', key: '1' },
  standard: { label: 'Médio', key: '2' },
  long: { label: 'Fácil', key: '3' },
}

const THEME_KEY = 'revfr-theme'

function initialTheme(): 'light' | 'dark' {
  const stored = localStorage.getItem(THEME_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
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

function shuffle<T>(items: T[]): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/**
 * Ordem de revisão do app: primeiro as vencidas (mais difíceis antes, depois
 * as mais atrasadas), em seguida as que estão mais perto da hora de revisar.
 */
function reviewOrder(cards: Card[], today: string): Card[] {
  const due = cards.filter((card) => card.nextReview <= today)
  const upcoming = cards.filter((card) => card.nextReview > today)
  due.sort((a, b) => b.hardCount - a.hardCount || a.nextReview.localeCompare(b.nextReview) || a.box - b.box)
  upcoming.sort((a, b) => a.nextReview.localeCompare(b.nextReview) || b.hardCount - a.hardCount)
  return [...due, ...upcoming]
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
  const [phrasesUrl, setPhrasesUrl] = useState(() => localStorage.getItem(PHRASES_URL_KEY) || '')
  const [draftPhrasesUrl, setDraftPhrasesUrl] = useState(phrasesUrl)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => initialTheme())
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  const [cards, setCards] = useState<Card[]>([])
  const [phrases, setPhrases] = useState<Card[]>([])
  const [selectedThemes, setSelectedThemes] = useState<string[]>(() => readJson<string[]>(THEMES_KEY, []))
  const [queue, setQueue] = useState<string[]>([])
  const [screen, setScreen] = useState<'home' | 'study' | 'stats' | 'settings'>(scriptUrl ? 'home' : 'settings')
  const [mode, setMode] = useState<StudyMode | null>(null)
  const [blockSize, setBlockSize] = useState(0)
  const [languageFilter, setLanguageFilter] = useState<'all' | Language>('all')
  const [isRevealed, setIsRevealed] = useState(false)
  const [pendingCount, setPendingCount] = useState(() => loadPending().length)
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)
  const [fromCache, setFromCache] = useState(false)

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [browseId, setBrowseId] = useState<string | null>(null)
  const [picked, setPicked] = useState<{ term: string; language: Language } | null>(null)
  const [conjugationCard, setConjugationCard] = useState<Card | null>(null)
  const [lookup, setLookup] = useState<{ translation: string; source: 'card' | 'online' | 'none'; loading: boolean }>({
    translation: '',
    source: 'none',
    loading: false,
  })

  const [sessionEntries, setSessionEntries] = useState<SessionEntry[]>([])
  const [sessions, setSessions] = useState<SessionRecord[]>(() => loadSessions())
  const [lastSession, setLastSession] = useState<SessionRecord | null>(null)
  const [expandedSession, setExpandedSession] = useState<number | null>(null)

  const flushing = useRef(false)
  const cardsRef = useRef<Card[]>([])
  const phrasesRef = useRef<Card[]>([])
  const prevQueueLength = useRef(0)
  // Cards já reapresentados neste bloco por "pouco tempo": cada um volta uma única vez.
  const requeuedIds = useRef<Set<string>>(new Set())
  const searchInputRef = useRef<HTMLInputElement>(null)

  const allCards = useMemo(() => [...cards, ...phrases], [cards, phrases])
  const cardsById = useMemo(() => new Map(allCards.map((card) => [card.id, card])), [allCards])
  const isDemo = !scriptUrl

  // Envia a fila pendente, separando por backend (palavras x frases).
  const flushPending = useCallback(async (wordsUrl: string, phrUrl: string) => {
    if (flushing.current) return
    const pending = loadPending()
    if (!pending.length) return
    flushing.current = true
    try {
      const remaining: PendingReview[] = []
      const groups: Array<[string, PendingReview[]]> = [
        [wordsUrl, pending.filter((item) => (item.target ?? 'words') === 'words')],
        [phrUrl, pending.filter((item) => item.target === 'phrases')],
      ]
      for (const [url, reviews] of groups) {
        if (!reviews.length) continue
        if (!url) {
          remaining.push(...reviews)
          continue
        }
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'reviewBatch', reviews }),
          })
          const data = await response.json()
          if (!data.ok) remaining.push(...reviews)
        } catch {
          remaining.push(...reviews)
        }
      }
      savePending(remaining)
      setPendingCount(remaining.length)
    } finally {
      flushing.current = false
    }
  }, [])

  const loadCards = useCallback(
    async (url: string, phrUrl: string) => {
      if (!url) {
        setCards(DEMO_CARDS)
        setPhrases([])
        setStatus('ready')
        return
      }
      setStatus('loading')
      setErrorMessage('')
      await flushPending(url, phrUrl)

      // Frases (planilha independente): falha aqui não derruba o app.
      if (phrUrl) {
        try {
          const response = await fetch(`${phrUrl}${phrUrl.includes('?') ? '&' : '?'}action=cards`)
          const data = await response.json()
          if (!data.ok) throw new Error(data.error || 'Resposta inválida do script de frases.')
          const tagged = (data.cards as Card[]).map((card) => ({ ...card, source: 'phrases' as const }))
          setPhrases(applyPending(tagged, loadPending()))
        } catch {
          const cached = readJson<{ at: string; cards: Card[] } | null>(PHRASES_CACHE_KEY, null)
          if (cached && cached.cards.length) setPhrases(cached.cards)
        }
      } else {
        setPhrases([])
      }

      try {
        const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}action=cards`)
        const data = await response.json()
        if (!data.ok) throw new Error(data.error || 'Resposta inválida do script.')
        const tagged = (data.cards as Card[]).map((card) => ({ ...card, source: 'words' as const }))
        setCards(applyPending(tagged, loadPending()))
        setFromCache(false)
        setStatus('ready')
      } catch (error) {
        // Sem rede (ou script fora do ar): usa a última cópia local dos cards.
        const cached = readJson<{ at: string; cards: Card[] } | null>(CARDS_CACHE_KEY, null)
        if (cached && cached.cards.length) {
          setCards(cached.cards)
          setFromCache(true)
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
    loadCards(scriptUrl, phrasesUrl)
  }, [scriptUrl, phrasesUrl, loadCards])

  // Aplica o tema (claro/noturno) e persiste a preferência (chave revfr-theme).
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(THEME_KEY, theme)
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#101317' : '#f5f6f7')
  }, [theme])

  useEffect(() => {
    cardsRef.current = cards
  }, [cards])

  useEffect(() => {
    phrasesRef.current = phrases
  }, [phrases])

  useEffect(() => {
    localStorage.setItem(THEMES_KEY, JSON.stringify(selectedThemes))
  }, [selectedThemes])

  useEffect(() => {
    if (!phrases.length) return
    try {
      localStorage.setItem(PHRASES_CACHE_KEY, JSON.stringify({ at: new Date().toISOString(), cards: phrases }))
    } catch {
      // sem espaço no storage
    }
  }, [phrases])

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
      flushPending(scriptUrl, phrasesUrl)
    }
    const onOffline = () => setIsOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [scriptUrl, phrasesUrl, flushPending])

  // Retentativa periódica: cobre o caso em que o evento "online" chega
  // enquanto uma tentativa de sync ainda está falhando.
  useEffect(() => {
    if (!pendingCount || isDemo) return
    const timer = window.setInterval(() => {
      if (navigator.onLine) flushPending(scriptUrl, phrasesUrl)
    }, 15000)
    return () => window.clearInterval(timer)
  }, [pendingCount, isDemo, scriptUrl, phrasesUrl, flushPending])

  // Fim de bloco: salva o resumo no histórico local e o exibe no card de conclusão.
  useEffect(() => {
    if (prevQueueLength.current > 0 && queue.length === 0 && sessionEntries.length > 0) {
      const record: SessionRecord = {
        at: new Date().toISOString(),
        entries: sessionEntries,
        mode: MODE_LABEL[mode ?? 'practice'],
      }
      const updated = [record, ...loadSessions()].slice(0, MAX_SESSIONS)
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(updated))
      setSessions(updated)
      setLastSession(record)
      setSessionEntries([])
    }
    prevQueueLength.current = queue.length
  }, [queue, sessionEntries, mode])

  const activeCard = queue.length ? cardsById.get(queue[0]) : undefined
  const activeLanguage: Language = activeCard ? detectLanguage(activeCard) : 'en-US'
  const browseCard = browseId ? cardsById.get(browseId) : undefined

  // Sempre que a frente do card aparece (próximo card ou virada de volta),
  // o app fala a palavra/expressão automaticamente.
  useEffect(() => {
    if (screen !== 'study' || !activeCard || isRevealed) return
    if (browseId || searchOpen || picked || conjugationCard) return
    speak(activeCard.text, detectLanguage(activeCard))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCard?.id, isRevealed, screen])

  // Pools do menu inicial (respeitando o filtro de idioma). Cards já estudados
  // hoje ficam de fora dos próximos blocos — só voltam a partir do dia seguinte.
  const pools = useMemo(() => {
    const today = todayKey()
    const eligible = cards.filter((card) => languageFilter === 'all' || detectLanguage(card) === languageFilter)
    const seen = eligible.filter((card) => !!card.nextReview)
    const reviewable = seen.filter((card) => !(card.lastReviewedAt === today && card.nextReview > today))
    return {
      seen: seen.length,
      reviewable: reviewable.length,
      due: seen.filter((card) => card.nextReview <= today).length,
      fresh: eligible.filter((card) => !card.nextReview).length,
    }
  }, [cards, languageFilter])

  // Pools das frases (planilha independente): temas = abas; filtro por tema.
  const phrasePools = useMemo(() => {
    const today = todayKey()
    const themes = Array.from(new Set(phrases.map((card) => card.theme || 'Frases')))
    const eligible = phrases.filter(
      (card) => !selectedThemes.length || selectedThemes.includes(card.theme || 'Frases'),
    )
    const seen = eligible.filter((card) => !!card.nextReview)
    const reviewable = seen.filter((card) => !(card.lastReviewedAt === today && card.nextReview > today))
    return {
      themes,
      total: eligible.length,
      due: seen.filter((card) => card.nextReview <= today).length,
      fresh: eligible.filter((card) => !card.nextReview).length,
      reviewable: reviewable.length,
    }
  }, [phrases, selectedThemes])

  /**
   * Monta o bloco de estudo conforme o modo:
   * - suggested: 5 revisões (na ordem de prioridade) + 5 novas aleatórias,
   *   completando de um lado quando falta do outro, até 10;
   * - review: 10 já vistas, difíceis e mais próximas da revisão primeiro;
   * - new: 10 ainda não respondidas, em ordem aleatória;
   * - phrases: 10 frases dos temas escolhidos — vencidas primeiro (ordem de
   *   prioridade), completando com novas aleatórias.
   */
  function startStudy(nextMode: StudyMode, singleId?: string) {
    const today = todayKey()
    const eligible = cardsRef.current.filter(
      (card) => languageFilter === 'all' || detectLanguage(card) === languageFilter,
    )
    // Já estudados hoje não entram em novos blocos: voltam no dia seguinte.
    const reviewable = eligible.filter(
      (card) => !!card.nextReview && !(card.lastReviewedAt === today && card.nextReview > today),
    )
    const ordered = reviewOrder(reviewable, today)
    const fresh = shuffle(eligible.filter((card) => !card.nextReview))

    let block: Card[] = []
    if (nextMode === 'practice' && singleId) {
      const card = cardsById.get(singleId)
      block = card ? [card] : []
    } else if (nextMode === 'phrases' || nextMode === 'phrasesReview' || nextMode === 'phrasesNew') {
      const pool = phrasesRef.current.filter(
        (card) => !selectedThemes.length || selectedThemes.includes(card.theme || 'Frases'),
      )
      const reviewablePhrases = pool.filter(
        (card) => !!card.nextReview && !(card.lastReviewedAt === today && card.nextReview > today),
      )
      const orderedPhrases = reviewOrder(reviewablePhrases, today)
      const freshPhrases = shuffle(pool.filter((card) => !card.nextReview))

      if (nextMode === 'phrasesReview') {
        block = orderedPhrases.slice(0, BLOCK_SIZE)
      } else if (nextMode === 'phrasesNew') {
        block = freshPhrases.slice(0, BLOCK_SIZE)
      } else {
        const reviews = orderedPhrases.slice(0, SUGGESTED_REVIEW_SHARE)
        const news = freshPhrases.slice(0, BLOCK_SIZE - reviews.length)
        block = [...reviews, ...news]
        if (block.length < BLOCK_SIZE && reviews.length < orderedPhrases.length) {
          block = [...orderedPhrases.slice(0, BLOCK_SIZE - news.length), ...news]
        }
        block = block.slice(0, BLOCK_SIZE)
      }
    } else if (nextMode === 'review') {
      block = ordered.slice(0, BLOCK_SIZE)
    } else if (nextMode === 'new') {
      block = fresh.slice(0, BLOCK_SIZE)
    } else {
      const reviews = ordered.slice(0, SUGGESTED_REVIEW_SHARE)
      const news = fresh.slice(0, BLOCK_SIZE - reviews.length)
      block = [...reviews, ...news]
      if (block.length < BLOCK_SIZE && reviews.length < ordered.length) {
        block = [...ordered.slice(0, BLOCK_SIZE - news.length), ...news]
      }
      block = block.slice(0, BLOCK_SIZE)
    }
    if (!block.length) return

    setMode(nextMode)
    setQueue(block.map((card) => card.id))
    setBlockSize(block.length)
    requeuedIds.current = new Set()
    setSessionEntries([])
    setLastSession(null)
    setIsRevealed(false)
    setBrowseId(null)
    setSearchOpen(false)
    setSearchQuery('')
    setPicked(null)
    setScreen('study')
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
  }

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
    for (const card of allCards) {
      const text = normalize(card.text)
      if (text === query || (loose && (text.includes(query) || query.includes(text)))) {
        direct.push(card)
      } else if (loose && normalize([card.original, ...card.examples.map((e) => e.text)].join(' ')).includes(query)) {
        mentions.push(card)
      }
    }
    direct.sort((a, b) => Number(normalize(b.text) === query) - Number(normalize(a.text) === query))
    return { direct: direct.slice(0, 3), mentions: mentions.slice(0, 3) }
  }, [picked, allCards])

  // IPA do trecho tocado: usa o da planilha quando a palavra é um card,
  // senão gera uma transcrição aproximada (só para francês).
  const pickedIpa = useMemo(() => {
    if (!picked) return { value: '', approximate: false }
    const exact = pickedMatches.direct.find(
      (card) => normalize(card.text) === normalize(picked.term) && card.ipa,
    )
    if (exact) return { value: exact.ipa, approximate: false }
    if (picked.language === 'fr-FR') {
      const generated = frenchIpa(picked.term)
      if (generated) return { value: generated, approximate: true }
    }
    return { value: '', approximate: false }
  }, [picked, pickedMatches])

  // Tradução do trecho tocado: card exato → cache local → serviço do Apps
  // Script (online). O resultado fica em cache para funcionar offline depois.
  useEffect(() => {
    if (!picked) {
      setLookup({ translation: '', source: 'none', loading: false })
      return
    }
    const term = picked.term
    const key = `${picked.language}|${normalize(term)}`

    const exact = pickedMatches.direct.find((card) => normalize(card.text) === normalize(term))
    if (exact?.translation) {
      setLookup({ translation: exact.translation, source: 'card', loading: false })
      return
    }

    const cache = readJson<Record<string, string>>(TRANSLATION_CACHE_KEY, {})
    if (cache[key]) {
      setLookup({ translation: cache[key], source: 'online', loading: false })
      return
    }

    const url = scriptUrl || phrasesUrl
    if (!url || !navigator.onLine) {
      setLookup({ translation: '', source: 'none', loading: false })
      return
    }

    let cancelled = false
    setLookup({ translation: '', source: 'none', loading: true })
    const from = picked.language === 'fr-FR' ? 'fr' : 'en'
    fetch(`${url}${url.includes('?') ? '&' : '?'}action=translate&from=${from}&to=pt&q=${encodeURIComponent(term)}`)
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return
        if (data.ok && data.translation) {
          const updated = { ...readJson<Record<string, string>>(TRANSLATION_CACHE_KEY, {}), [key]: data.translation }
          try {
            localStorage.setItem(TRANSLATION_CACHE_KEY, JSON.stringify(updated))
          } catch {
            // storage cheio: segue sem cache
          }
          setLookup({ translation: data.translation, source: 'online', loading: false })
        } else {
          setLookup({ translation: '', source: 'none', loading: false })
        }
      })
      .catch(() => {
        if (!cancelled) setLookup({ translation: '', source: 'none', loading: false })
      })
    return () => {
      cancelled = true
    }
  }, [picked, pickedMatches, scriptUrl, phrasesUrl])

  const searchResults = useMemo(() => {
    const query = normalize(searchQuery.trim())
    if (!query) return []
    return allCards
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
  }, [allCards, searchQuery])

  const sendReview = useCallback(
    (card: Card, result: ReviewResult) => {
      if (isDemo) return
      const review: PendingReview = {
        id: card.id,
        text: card.text,
        result,
        at: new Date().toISOString(),
        target: card.source === 'phrases' ? 'phrases' : 'words',
      }
      const pending = [...loadPending(), review]
      savePending(pending)
      setPendingCount(pending.length)
      flushPending(scriptUrl, phrasesUrl)
    },
    [isDemo, scriptUrl, phrasesUrl, flushPending],
  )

  const answer = useCallback(
    (result: ReviewResult) => {
      if (!activeCard || !isRevealed) return
      const next = scheduleDays(activeCard.box, result)
      const nextReview = addDaysKey(next.days)

      sendReview(activeCard, result)
      const applyProgress = (current: Card[]) =>
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
        )
      if (activeCard.source === 'phrases') setPhrases(applyProgress)
      else setCards(applyProgress)
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
        // "Pouco tempo": reaparece no fim do bloco, mas UMA única vez —
        // se for marcado difícil de novo, sai do bloco e volta amanhã.
        if (result === 'short' && !requeuedIds.current.has(activeCard.id)) {
          requeuedIds.current.add(activeCard.id)
          return [...rest, activeCard.id]
        }
        return rest
      })
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
        if (conjugationCard) setConjugationCard(null)
        else if (picked) setPicked(null)
        else if (browseId) setBrowseId(null)
        else if (searchOpen) {
          setSearchOpen(false)
          setSearchQuery('')
        } else if (screen === 'stats' || screen === 'settings') {
          setScreen('home')
        }
        return
      }
      if (picked || browseId || searchOpen || conjugationCard || screen !== 'study') return
      if (event.code === 'Space' || event.key === 'Enter') {
        if (activeCard) {
          event.preventDefault()
          setIsRevealed((value) => !value)
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
  }, [isRevealed, activeCard, activeLanguage, answer, browseId, searchOpen, picked, conjugationCard, screen])

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  function saveSettings() {
    const trimmed = draftUrl.trim()
    const trimmedPhrases = draftPhrasesUrl.trim()
    localStorage.setItem(SCRIPT_URL_KEY, trimmed)
    localStorage.setItem(PHRASES_URL_KEY, trimmedPhrases)
    setScriptUrl(trimmed)
    setPhrasesUrl(trimmedPhrases)
    if (trimmed) setScreen('home')
  }

  function practiceNow(id: string) {
    if (screen === 'study' && queue.length > 0) {
      // no meio de um bloco: o card entra na frente da fila atual
      setQueue((current) => [id, ...current.filter((item) => item !== id)])
      setBrowseId(null)
      setSearchOpen(false)
      setSearchQuery('')
      setIsRevealed(false)
      return
    }
    startStudy('practice', id)
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
          {(card.grammarClass || card.type) && <span>{card.grammarClass || card.type}</span>}
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
          {(card.conjugations?.length ?? 0) > 0 && (
            <button className="conj-button" onClick={() => setConjugationCard(card)}>
              📖 Conjugação{card.verbType ? ` · ${card.verbType}` : ''}
            </button>
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
          <h3>{record.mode ? `${title} · ${record.mode}` : title}</h3>
          <span>{formatSessionDate(record.at)}</span>
        </div>
        <div className="summary-counts">
          <span className="count short">{counts.short} difícil</span>
          <span className="count standard">{counts.standard} médio</span>
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

  const showOriginal =
    !!activeCard && !!activeCard.original && activeCard.original.toLowerCase() !== activeCard.text.toLowerCase()
  const studying = screen === 'study'

  function renderSettings() {
    return (
      <div className="subscreen">
        <div className="subscreen-head">
          <button className="back" aria-label="Voltar" onClick={() => setScreen('home')}>
            ←
          </button>
          <h2>Ajustes</h2>
        </div>

        <div className="setting-block">
          <span className="setting-title">Tema</span>
          <div className="theme-toggle">
            <button className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}>
              ☀️ Claro
            </button>
            <button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}>
              🌙 Noturno
            </button>
          </div>
        </div>

        <div className="setting-block">
          <label htmlFor="script-url">URL do App da Web — Palavras (Apps Script)</label>
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
            Na planilha de vocabulário: Extensões → Apps Script → cole <code>apps-script/Code.gs</code> → Implantar →
            App da Web (executar como você, acesso: qualquer pessoa com o link) → copie a URL <code>/exec</code>.
            O progresso é gravado na aba <strong>Progresso</strong>; a aba de palavras nunca é alterada.
          </small>
        </div>

        <div className="setting-block">
          <label htmlFor="phrases-url">URL do App da Web — Frases (opcional)</label>
          <div className="settings-row">
            <input
              id="phrases-url"
              placeholder="https://script.google.com/macros/s/.../exec"
              value={draftPhrasesUrl}
              onChange={(event) => setDraftPhrasesUrl(event.target.value)}
            />
            <button onClick={saveSettings}>Salvar</button>
          </div>
          <small>
            Na planilha de frases (independente): cole <code>apps-script/Frases.gs</code> e publique da mesma forma.
            Cada aba vira um tema (o "Guia de pronúncia" é ignorado); o progresso vai para a aba{' '}
            <strong>Progresso</strong> dela.
          </small>
        </div>
      </div>
    )
  }

  function renderStats() {
    const seenCards = cards.filter((card) => !!card.nextReview)
    const totalReviews = cards.reduce((sum, card) => sum + card.repetitions, 0)
    const boxCounts = INTERVALS.map((_, box) => seenCards.filter((card) => card.box === box).length)
    const maxBox = Math.max(1, ...boxCounts)
    return (
      <div className="subscreen">
        <div className="subscreen-head">
          <button className="back" aria-label="Voltar" onClick={() => setScreen('home')}>
            ←
          </button>
          <h2>Estatísticas</h2>
        </div>

        <div className="stats-grid">
          <div className="stat-tile">
            <strong>{pools.due}</strong>
            <span>para revisar hoje</span>
          </div>
          <div className="stat-tile">
            <strong>{pools.seen}</strong>
            <span>já estudadas</span>
          </div>
          <div className="stat-tile">
            <strong>{pools.fresh}</strong>
            <span>novas na fila</span>
          </div>
          <div className="stat-tile">
            <strong>{totalReviews}</strong>
            <span>revisões feitas</span>
          </div>
        </div>

        <div className="boxes-panel">
          <span className="setting-title">Caixas (Leitner)</span>
          {boxCounts.map((count, box) => (
            <div className="box-row" key={box}>
              <span className="name">caixa {box} · {INTERVALS[box]}d</span>
              <span className="bar">
                <i style={{ width: `${(count / maxBox) * 100}%` }} />
              </span>
              <span className="value">{count}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const progressPercent = blockSize ? Math.min((sessionEntries.length / blockSize) * 100, 100) : 0

  function exitStudy() {
    setScreen('home')
    setQueue([])
    setSessionEntries([])
    setIsRevealed(false)
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
  }

  return (
    <main className="app-shell">
      {!studying && (
        <header className="topbar">
          <div className="brand">
            <h1>Revisão EN·FR</h1>
            <p>revisão espaçada da sua planilha</p>
          </div>
          <div className="chips">
            {!isOnline && <span className="chip offline">✈️ offline</span>}
            {isOnline && fromCache && <span className="chip offline">dados locais</span>}
            {pendingCount > 0 && <span className="chip pending">{pendingCount} p/ sincronizar</span>}
            {isDemo && <span className="chip demo">demo</span>}
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
            <button
              className="icon-button"
              onClick={() => {
                setScreen(screen === 'stats' ? 'home' : 'stats')
                setSearchOpen(false)
                setSearchQuery('')
                setBrowseId(null)
              }}
              aria-label="Estatísticas"
            >
              📊
            </button>
            <button
              className="icon-button"
              onClick={() => {
                setScreen(screen === 'settings' ? 'home' : 'settings')
                setSearchOpen(false)
                setSearchQuery('')
                setBrowseId(null)
              }}
              aria-label="Ajustes"
            >
              ⚙️
            </button>
          </div>
        </header>
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

      {screen === 'home' && !browseCard && !searchOpen && (
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
          <button
            className="refresh"
            onClick={() => loadCards(scriptUrl, phrasesUrl)}
            disabled={status === 'loading'}
          >
            {status === 'loading' ? 'Carregando…' : '↻ Recarregar'}
          </button>
        </div>
      )}

      {studying && (
        <div className="study-bar">
          <button className="exit" aria-label="Sair da sessão" onClick={exitStudy}>
            ✕
          </button>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
          </div>
          <span className="study-count">
            {queue.length ? `${Math.min(sessionEntries.length + 1, blockSize)}/${blockSize}` : `${blockSize}/${blockSize}`}
          </span>
        </div>
      )}

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
          ) : screen === 'settings' ? (
            renderSettings()
          ) : screen === 'stats' ? (
            renderStats()
          ) : status === 'loading' && !cards.length ? (
            <div className="done-state">
              <h2>Carregando cards…</h2>
            </div>
          ) : screen === 'home' ? (
            <div className="home">
              <div className="hero-panel">
                <div className="hero-number">{pools.due}</div>
                <div className="hero-label">
                  para revisar hoje · {pools.fresh} nova{pools.fresh === 1 ? '' : 's'} na fila
                </div>
              </div>

              <p className="section-label">O que estudar agora?</p>
              <div className="mode-grid">
                <button
                  className="mode-card suggested"
                  disabled={pools.reviewable + pools.fresh === 0}
                  onClick={() => startStudy('suggested')}
                >
                  <span className="mode-icon" aria-hidden="true">✨</span>
                  <strong>Estudo sugerido</strong>
                  <span className="mode-desc">5 revisões + 5 novas aleatórias</span>
                  <small>o equilíbrio ideal para o dia a dia</small>
                </button>
                <button
                  className="mode-card review"
                  disabled={pools.reviewable === 0}
                  onClick={() => startStudy('review')}
                >
                  <span className="mode-icon" aria-hidden="true">🔁</span>
                  <strong>Revisão</strong>
                  <span className="mode-desc">10 cards já vistos, difíceis primeiro</span>
                  <small>
                    {pools.reviewable === 0 && pools.seen > 0
                      ? 'todas revisadas por hoje 🎉'
                      : pools.due > 0
                        ? `${pools.due} vencido${pools.due === 1 ? '' : 's'} hoje · ${pools.reviewable} disponíveis`
                        : `nada vencido · ${pools.reviewable} disponíveis`}
                  </small>
                </button>
                <button className="mode-card fresh" disabled={pools.fresh === 0} onClick={() => startStudy('new')}>
                  <span className="mode-icon" aria-hidden="true">🌱</span>
                  <strong>Novas</strong>
                  <span className="mode-desc">10 cards que você ainda não estudou</span>
                  <small>{pools.fresh} disponíve{pools.fresh === 1 ? 'l' : 'is'}</small>
                </button>
              </div>

              {phrases.length > 0 && (
                <>
                  <p className="section-label">Frases por tema</p>
                  <div className="theme-chips">
                    {phrasePools.themes.map((themeName) => (
                      <button
                        key={themeName}
                        className={selectedThemes.includes(themeName) ? 'active' : ''}
                        onClick={() =>
                          setSelectedThemes((current) =>
                            current.includes(themeName)
                              ? current.filter((item) => item !== themeName)
                              : [...current, themeName],
                          )
                        }
                      >
                        {themeName}
                      </button>
                    ))}
                  </div>
                  <div className="mode-grid">
                    <button
                      className="mode-card phrases"
                      disabled={phrasePools.reviewable + phrasePools.fresh === 0}
                      onClick={() => startStudy('phrases')}
                    >
                      <span className="mode-icon" aria-hidden="true">💬</span>
                      <strong>Frases sugeridas</strong>
                      <span className="mode-desc">5 revisões + 5 frases novas</span>
                      <small>
                        {phrasePools.reviewable + phrasePools.fresh === 0 && phrasePools.total > 0
                          ? 'todas revisadas por hoje 🎉'
                          : `${selectedThemes.length ? 'temas escolhidos' : 'todos os temas'} · ${phrasePools.total} frases`}
                      </small>
                    </button>
                    <button
                      className="mode-card phrases-review"
                      disabled={phrasePools.reviewable === 0}
                      onClick={() => startStudy('phrasesReview')}
                    >
                      <span className="mode-icon" aria-hidden="true">🔁</span>
                      <strong>Revisar frases</strong>
                      <span className="mode-desc">10 frases já vistas, difíceis primeiro</span>
                      <small>
                        {phrasePools.reviewable === 0 && phrasePools.total > phrasePools.fresh
                          ? 'todas revisadas por hoje 🎉'
                          : `${phrasePools.due} vencida${phrasePools.due === 1 ? '' : 's'} hoje · ${phrasePools.reviewable} disponíveis`}
                      </small>
                    </button>
                    <button
                      className="mode-card phrases-new"
                      disabled={phrasePools.fresh === 0}
                      onClick={() => startStudy('phrasesNew')}
                    >
                      <span className="mode-icon" aria-hidden="true">🌱</span>
                      <strong>Frases novas</strong>
                      <span className="mode-desc">10 frases que você ainda não estudou</span>
                      <small>{phrasePools.fresh} disponíve{phrasePools.fresh === 1 ? 'l' : 'is'}</small>
                    </button>
                  </div>
                </>
              )}

              {sessions.length > 0 && (
                <div className="history">
                  <h3>Blocos de estudo já feitos</h3>
                  <ul>
                    {sessions.map((record, index) => (
                      <li key={record.at}>
                        <button
                          className="history-item"
                          onClick={() => setExpandedSession(expandedSession === index ? null : index)}
                        >
                          <span>{record.mode || 'Estudo'}</span>
                          <span>{formatSessionDate(record.at)}</span>
                          <span>{record.entries.length} cards</span>
                        </button>
                        {expandedSession === index && renderSummary(record, 'Bloco')}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : activeCard ? (
            <>
              <div
                className="flipcard"
                onClick={(event) => {
                  // vira só no "momento oportuno": nunca a partir de botões,
                  // palavras tocáveis ou da área de exemplos (consulta)
                  const target = event.target as Element
                  if (target.closest('button, .pickable, .examples, .ipa-tip')) return
                  if (window.getSelection()?.toString().trim()) return
                  setIsRevealed((value) => !value)
                }}
              >
                <div className={`flip-inner ${isRevealed ? 'flipped' : ''}`}>
                  <div className="face front">
                    <div className="card-meta">
                      <span className="lang">{activeLanguage === 'fr-FR' ? '🇫🇷 Francês' : '🇬🇧 Inglês'}</span>
                      {activeCard.theme ? (
                        <span>{activeCard.theme}</span>
                      ) : (
                        (activeCard.grammarClass || activeCard.type) && (
                          <span>{activeCard.grammarClass || activeCard.type}</span>
                        )
                      )}
                      <span>caixa {activeCard.box}</span>
                      {activeCard.repetitions > 0 && <span>{activeCard.repetitions}× revisada</span>}
                    </div>

                    <h2 className="expression">{activeCard.text}</h2>
                    {activeCard.ipa && <p className="ipa">{activeCard.ipa}</p>}

                    {showOriginal && (
                      <p className="original">
                        capturado de: <em>“{activeCard.original}”</em>
                      </p>
                    )}

                    <div className="listen-row front-listen">
                      <button
                        className="listen xl"
                        onClick={(event) => {
                          event.stopPropagation()
                          speak(activeCard.text, activeLanguage)
                        }}
                      >
                        🔊 Ouvir
                      </button>
                      {showOriginal && (
                        <button
                          className="listen ghost xl"
                          onClick={(event) => {
                            event.stopPropagation()
                            speak(activeCard.original, activeLanguage)
                          }}
                        >
                          💬 Frase
                        </button>
                      )}
                    </div>

                    <p className="flip-hint">toque para virar</p>
                  </div>

                  <div className="face back">
                    <p className="translation">{activeCard.translation || 'Sem tradução na planilha.'}</p>

                    {activeCard.source === 'phrases' && (
                      <div className="examples">
                        <div className="example">
                          <div className="example-line">
                            <p
                              className="example-text selectable"
                              onMouseUp={() => handleTextSelection(activeLanguage)}
                              onTouchEnd={() => handleTextSelection(activeLanguage)}
                            >
                              <SelectableText text={activeCard.text} term="" language={activeLanguage} onPick={pick} />
                            </p>
                            <button
                              className="mini-listen"
                              aria-label="Ouvir frase"
                              onClick={(event) => {
                                event.stopPropagation()
                                speak(activeCard.text, activeLanguage)
                              }}
                            >
                              🔊
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {activeCard.ipaComment && (
                      <p className="ipa-tip">
                        <span aria-hidden="true">🗣️</span> {activeCard.ipaComment}
                      </p>
                    )}

                    {(activeCard.conjugations?.length ?? 0) > 0 && (
                      <button
                        className="conj-button"
                        onClick={(event) => {
                          event.stopPropagation()
                          setConjugationCard(activeCard)
                        }}
                      >
                        📖 Conjugação{activeCard.verbType ? ` · ${activeCard.verbType}` : ''}
                      </button>
                    )}

                    {activeCard.examples.length > 0 && (
                      <div className="examples">
                        <h3>
                          Exemplos <span className="examples-hint">· toque numa palavra para consultar</span>
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
                                onClick={(event) => {
                                  event.stopPropagation()
                                  speak(example.text, activeLanguage)
                                }}
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
              </div>

              {isRevealed && (
                <div className="review-actions">
                  {(Object.keys(RESULT_META) as ReviewResult[]).map((result) => {
                    const days = scheduleDays(activeCard.box, result).days
                    return (
                      <button key={result} className={result} onClick={() => answer(result)}>
                        <strong>{RESULT_META[result].label}</strong>
                        <small>{days === 1 ? 'volta amanhã' : `volta em ${days} dias`}</small>
                      </button>
                    )
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="done-state">
              <div className="done-icon" aria-hidden="true">✓</div>
              <h2>Bloco concluído</h2>
              <p>
                {lastSession
                  ? 'Progresso salvo. Toque numa expressão para revê-la.'
                  : 'Nada para estudar neste modo agora.'}
              </p>

              {lastSession && renderSummary(lastSession, 'Resumo')}

              <div className="done-actions">
                <button className="more-new" onClick={() => setScreen('home')}>
                  Voltar ao início
                </button>
                {mode && mode !== 'practice' && (
                  <button className="again" onClick={() => startStudy(mode)}>
                    Nova sessão
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {conjugationCard && (
        <div className="sheet-backdrop" onClick={() => setConjugationCard(null)}>
          <div
            className="word-sheet conj-sheet"
            role="dialog"
            aria-label={`Conjugação: ${conjugationCard.text}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="word-sheet-head">
              <div>
                <strong className="word-term">{conjugationCard.text}</strong>
                {conjugationCard.verbType && <p className="conj-type">{conjugationCard.verbType}</p>}
              </div>
              <div className="word-sheet-actions">
                <button
                  className="listen"
                  onClick={() => speak(conjugationCard.text, detectLanguage(conjugationCard))}
                >
                  🔊
                </button>
                <button className="word-close" aria-label="Fechar" onClick={() => setConjugationCard(null)}>
                  ✕
                </button>
              </div>
            </div>

            {(conjugationCard.conjugations ?? []).map((tense) => {
              const frLines = tense.fr.split('\n').map((line) => line.trim()).filter(Boolean)
              const ptLines = tense.pt.split('\n').map((line) => line.trim())
              return (
                <div className="tense" key={tense.tense}>
                  <h4>{tense.tense}</h4>
                  {frLines.map((line, index) => (
                    <button
                      className="conj-row"
                      key={index}
                      onClick={() => speak(line, detectLanguage(conjugationCard))}
                    >
                      <span className="conj-fr">{line}</span>
                      <span className="conj-pt">{ptLines[index] || ''}</span>
                    </button>
                  ))}
                </div>
              )
            })}
            <p className="conj-hint">toque numa forma para ouvi-la</p>
          </div>
        </div>
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

            <div className="lookup-info">
              {lookup.loading ? (
                <p className="lookup-translation loading">traduzindo…</p>
              ) : lookup.translation ? (
                <p className="lookup-translation">
                  {lookup.translation}
                  {lookup.source === 'online' && <span className="lookup-tag">tradução automática</span>}
                </p>
              ) : (
                <p className="lookup-translation empty">sem tradução disponível offline</p>
              )}
              {pickedIpa.value && (
                <p className="lookup-ipa">
                  {pickedIpa.value}
                  {pickedIpa.approximate && <span className="lookup-tag">aproximado</span>}
                </p>
              )}
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

      {!studying && (
        <footer className="foot">
          <span>
            {cards.length} palavras{phrases.length > 0 ? ` · ${phrases.length} frases` : ''}
          </span>
          <span>atalhos: espaço vira · P ouve · 1 / 2 / 3 respondem</span>
        </footer>
      )}
    </main>
  )
}
