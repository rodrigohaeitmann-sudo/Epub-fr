import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type {
  Chapter,
  LoadedBook,
  ReadingPos,
  Settings,
  Toggles,
  TrackKey,
  Translations,
} from './types'
import { useAudio } from './hooks/useAudio'
import { loadSession, loadTranslations, saveTranslation, saveSession } from './lib/sessionStore'
import { translateParagraphs } from './lib/translate'
import { parseAudioChapters } from './lib/parseAudioChapters'
import FileSetup from './components/FileSetup'
import AudioStage from './components/AudioStage'
import TextToggles from './components/TextToggles'
import ReaderPanel from './components/ReaderPanel'
import ControlsFooter from './components/ControlsFooter'
import ChapterNav from './components/ChapterNav'
import AudioChapterNav from './components/AudioChapterNav'
import SearchPanel from './components/SearchPanel'
import SettingsPanel from './components/SettingsPanel'

// All persisted keys are namespaced to this French edition so they don't
// collide with the other reader app served from the same github.io origin.
const TOGGLES_KEY = 'epub-fr.toggles'
const SETTINGS_KEY = 'epub-fr.settings'

// Translate in blocks of this many paragraphs. Big books with no chapter
// division are one huge "chapter"; translating it whole is slow, so we
// translate one block on open and let the user extend on demand.
const BLOCK_SIZE = 100
const DEFAULT_TOGGLES: Toggles = { fr: true, pt: true }
const DEFAULT_SETTINGS: Settings = { fontScale: 1, fontFamily: 'system', speed: 1, lineOffset: 0 }

const FONT_STACKS: Record<Settings['fontFamily'], string> = {
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return { ...fallback, ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return fallback
}

function loadPos(bookId?: string): ReadingPos {
  if (!bookId) return { chapter: 0, paragraph: 0 }
  try {
    const raw = localStorage.getItem(`epub-fr.pos.${bookId}`)
    if (raw) return JSON.parse(raw)
  } catch {
    /* ignore */
  }
  return { chapter: 0, paragraph: 0 }
}

export default function App() {
  const [media, setMedia] = useState<LoadedBook | null>(null)
  const [restoring, setRestoring] = useState(true)
  const [toggles, setToggles] = useState<Toggles>(() => loadJson(TOGGLES_KEY, DEFAULT_TOGGLES))
  const [settings, setSettings] = useState<Settings>(() => loadJson(SETTINGS_KEY, DEFAULT_SETTINGS))
  const [pos, setPos] = useState<ReadingPos>({ chapter: 0, paragraph: 0 })
  const [translations, setTranslations] = useState<Translations>({})
  const [transLoadedFor, setTransLoadedFor] = useState<string | null>(null)
  const [transStatus, setTransStatus] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showChapters, setShowChapters] = useState(false)
  const [showAudioChapters, setShowAudioChapters] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const inFlight = useRef<Set<string>>(new Set())
  // Latest translations, readable inside async callbacks without stale closures.
  const translationsRef = useRef<Translations>(translations)
  useEffect(() => {
    translationsRef.current = translations
  }, [translations])

  const { audioRef, currentTime, duration, isPlaying, togglePlay, seekTo, skipBy } = useAudio(
    media?.bookId,
  )

  // Wire OS / headphone media keys: triple-press (previoustrack) and
  // double-press (nexttrack) become 5-second skips for the audiobook.
  useEffect(() => {
    if (!media || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    try {
      ms.metadata = new MediaMetadata({
        title: media.book.title,
        artist: media.book.author ?? '',
        album: 'Audiobook',
        artwork: media.book.coverUrl
          ? [{ src: media.book.coverUrl, sizes: '512x512', type: 'image/jpeg' }]
          : [],
      })
    } catch {
      /* ignore */
    }
    const setHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(action, handler)
      } catch {
        /* not supported */
      }
    }
    setHandler('previoustrack', () => skipBy(-5))
    setHandler('nexttrack', () => skipBy(5))
    setHandler('seekbackward', (d) => skipBy(-(d.seekOffset || 5)))
    setHandler('seekforward', (d) => skipBy(d.seekOffset || 5))
    setHandler('play', () => audioRef.current?.play())
    setHandler('pause', () => audioRef.current?.pause())
    return () => {
      setHandler('previoustrack', null)
      setHandler('nexttrack', null)
      setHandler('seekbackward', null)
      setHandler('seekforward', null)
      setHandler('play', null)
      setHandler('pause', null)
    }
  }, [media, skipBy, audioRef])

  useEffect(() => {
    localStorage.setItem(TOGGLES_KEY, JSON.stringify(toggles))
  }, [toggles])

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  }, [settings])

  // Reopen the last session automatically (e.g. after the app is backgrounded).
  useEffect(() => {
    loadSession()
      .then(async (session) => {
        if (!session) return
        const coverUrl = session.coverBlob ? URL.createObjectURL(session.coverBlob) : undefined
        let audioChapters = session.audioChapters ?? []
        // Sessions saved before audio-chapter support (or that failed to parse)
        // won't have chapters; re-extract them from the stored audio.
        if (audioChapters.length === 0) {
          audioChapters = await parseAudioChapters(session.audioBlob).catch(() => [])
          if (audioChapters.length > 0) {
            void saveSession({ ...session, audioChapters }).catch(() => {})
          }
        }
        setMedia({
          audioUrl: URL.createObjectURL(session.audioBlob),
          bookId: session.bookId,
          book: { ...session.book, coverUrl },
          audioChapters,
        })
      })
      .catch(() => undefined)
      .finally(() => setRestoring(false))
  }, [])

  // Load reading position + cached translations whenever the book changes.
  // transLoadedFor gates auto-translation so it never races (and clobbers) the
  // cached translations still coming back from IndexedDB.
  useEffect(() => {
    const id = media?.bookId
    if (!id) return
    setTransLoadedFor(null)
    setPos(loadPos(id))
    loadTranslations(id)
      .then((t) => setTranslations(t))
      .catch(() => setTranslations({}))
      .finally(() => setTransLoadedFor(id))
  }, [media?.bookId])

  useEffect(() => {
    const id = media?.bookId
    if (id) localStorage.setItem(`epub-fr.pos.${id}`, JSON.stringify(pos))
  }, [pos, media?.bookId])

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = settings.speed
  }, [settings.speed, media?.bookId, audioRef])

  useEffect(() => {
    if (!media || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    try {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'
    } catch {
      /* ignore */
    }
  }, [isPlaying, media])

  const chapters = media?.book.chapters ?? []
  const chapterIndex = Math.min(Math.max(pos.chapter, 0), Math.max(0, chapters.length - 1))
  const chapter = chapters[chapterIndex] ?? null
  const paraCount = chapter?.paragraphs.length ?? 0
  const paragraphIndex = Math.min(Math.max(pos.paragraph, 0), Math.max(0, paraCount - 1))
  const chapterTranslation = chapter ? translations[chapter.id] : undefined
  const translatedCount = chapterTranslation
    ? chapterTranslation.reduce((n, s) => (typeof s === 'string' ? n + 1 : n), 0)
    : 0

  // Index of the first not-yet-translated paragraph at or after `from`, or -1.
  const firstUntranslatedFrom = useCallback((ch: Chapter, from: number): number => {
    const arr = translationsRef.current[ch.id] ?? []
    for (let i = Math.max(0, from); i < ch.paragraphs.length; i++) {
      if (typeof arr[i] !== 'string') return i
    }
    return -1
  }, [])

  // Translate one block of up to BLOCK_SIZE paragraphs starting at `start`,
  // skipping any already done. Fills the translation array in place and caches.
  const translateBlock = useCallback(
    async (ch: Chapter, start: number) => {
      if (inFlight.current.has(ch.id)) return
      const total = ch.paragraphs.length
      if (total === 0) return
      const from = Math.max(0, Math.min(start, total - 1))
      const end = Math.min(total, from + BLOCK_SIZE)
      const base = (translationsRef.current[ch.id] ?? []).slice()
      const indices: number[] = []
      for (let i = from; i < end; i++) if (typeof base[i] !== 'string') indices.push(i)
      if (indices.length === 0) {
        setTransStatus(null)
        return
      }

      inFlight.current.add(ch.id)
      setTransStatus('Preparando tradução…')
      try {
        const texts = indices.map((i) => ch.paragraphs[i])
        const pt = await translateParagraphs(
          texts,
          (p) => setTransStatus(`Traduzindo… ${p.done}/${p.total}`),
          (loaded) => setTransStatus(`Baixando modelo de tradução… ${Math.round(loaded * 100)}%`),
        )
        indices.forEach((idx, k) => {
          base[idx] = pt[k] ?? ''
        })
        translationsRef.current = { ...translationsRef.current, [ch.id]: base }
        setTranslations((t) => ({ ...t, [ch.id]: base }))
        const bookId = media?.bookId
        if (bookId) void saveTranslation(bookId, ch.id, base).catch(() => {})
        setTransStatus(null)
      } catch (e) {
        setTransStatus(e instanceof Error ? e.message : 'Falha na tradução.')
      } finally {
        inFlight.current.delete(ch.id)
      }
    },
    [media],
  )

  // On opening a chapter with PT enabled, translate just the first block
  // (anchored at the current paragraph) instead of the whole thing.
  useEffect(() => {
    if (!media || !toggles.pt || !chapter) {
      setTransStatus(null)
      return
    }
    // Wait for the cached translations to finish loading for this book.
    if (transLoadedFor !== media.bookId) return
    const start = firstUntranslatedFrom(chapter, paragraphIndex)
    if (start < 0) {
      setTransStatus(null)
      return
    }
    void translateBlock(chapter, start)
    // Only re-run when the chapter or PT toggle changes, not on every position
    // change — extending the translation past the first block is manual.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media?.bookId, toggles.pt, chapter?.id, transLoadedFor])

  // Continue translating the next block, starting from the current paragraph.
  function handleTranslateMore() {
    if (!chapter) return
    const start = firstUntranslatedFrom(chapter, paragraphIndex)
    if (start < 0) {
      setTransStatus('Tudo já traduzido a partir daqui.')
      return
    }
    void translateBlock(chapter, start)
  }

  function handleToggle(key: TrackKey) {
    setToggles((t) => ({ ...t, [key]: !t[key] }))
  }

  function goToChapter(i: number) {
    setPos({ chapter: i, paragraph: 0 })
    setShowChapters(false)
  }

  function selectParagraph(i: number) {
    setPos({ chapter: chapterIndex, paragraph: i })
  }

  function handleBack() {
    if (media) {
      URL.revokeObjectURL(media.audioUrl)
      if (media.book.coverUrl) URL.revokeObjectURL(media.book.coverUrl)
    }
    setMedia(null)
    setTranslations({})
  }

  if (restoring) {
    return <div className="splash" />
  }

  if (!media) {
    return <FileSetup onReady={setMedia} />
  }

  const stageStyle = {
    '--sub-scale': String(settings.fontScale),
    '--sub-font': FONT_STACKS[settings.fontFamily],
  } as CSSProperties

  return (
    <div className="player" style={stageStyle}>
      <AudioStage
        audioRef={audioRef}
        src={media.audioUrl}
        book={media.book}
        currentTime={currentTime}
        duration={duration}
        audioChapters={media.audioChapters}
        onSeek={seekTo}
        onBack={handleBack}
        onOpenSearch={() => setShowSearch(true)}
        onOpenChapters={() => setShowChapters(true)}
        onOpenAudioChapters={() => setShowAudioChapters(true)}
        onOpenSettings={() => setShowSettings(true)}
      />
      <TextToggles toggles={toggles} onToggle={handleToggle} />
      <ReaderPanel
        chapter={chapter}
        translation={chapter ? translations[chapter.id] : undefined}
        toggles={toggles}
        activeParagraph={paragraphIndex}
        lineOffset={settings.lineOffset}
        onChangeLineOffset={(n) => setSettings((s) => ({ ...s, lineOffset: n }))}
        onSelectParagraph={selectParagraph}
        status={transStatus}
      />
      <ControlsFooter isPlaying={isPlaying} onTogglePlay={togglePlay} onSkip={skipBy} />
      {showChapters && (
        <ChapterNav
          chapters={chapters}
          current={chapterIndex}
          onSelect={goToChapter}
          onClose={() => setShowChapters(false)}
        />
      )}
      {showAudioChapters && (
        <AudioChapterNav
          chapters={media.audioChapters}
          currentTime={currentTime}
          onSelect={(start) => {
            seekTo(start)
            setShowAudioChapters(false)
          }}
          onClose={() => setShowAudioChapters(false)}
        />
      )}
      {showSearch && (
        <SearchPanel
          chapters={chapters}
          onSelect={(ci, pi) => {
            setPos({ chapter: ci, paragraph: pi })
            setShowSearch(false)
          }}
          onClose={() => setShowSearch(false)}
        />
      )}
      {showSettings && (
        <SettingsPanel
          settings={settings}
          onChange={setSettings}
          onClose={() => setShowSettings(false)}
          translatedCount={translatedCount}
          totalParagraphs={paraCount}
          currentParagraph={paragraphIndex}
          transStatus={transStatus}
          onTranslateMore={handleTranslateMore}
        />
      )}
    </div>
  )
}
