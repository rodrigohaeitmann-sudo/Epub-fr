import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { LoadedBook, ReadingPos, Settings, Toggles, TrackKey, Translations } from './types'
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

const TOGGLES_KEY = 'epub.toggles'
const SETTINGS_KEY = 'epub.settings'
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
    const raw = localStorage.getItem(`epub.pos.${bookId}`)
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
  const [transStatus, setTransStatus] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showChapters, setShowChapters] = useState(false)
  const [showAudioChapters, setShowAudioChapters] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const inFlight = useRef<Set<string>>(new Set())

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
  useEffect(() => {
    const id = media?.bookId
    if (!id) return
    setPos(loadPos(id))
    loadTranslations(id)
      .then(setTranslations)
      .catch(() => setTranslations({}))
  }, [media?.bookId])

  useEffect(() => {
    const id = media?.bookId
    if (id) localStorage.setItem(`epub.pos.${id}`, JSON.stringify(pos))
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

  // Translate the current chapter on demand when PT is enabled.
  useEffect(() => {
    if (!media || !toggles.pt || !chapter) {
      setTransStatus(null)
      return
    }
    if (translations[chapter.id]) {
      setTransStatus(null)
      return
    }
    if (inFlight.current.has(chapter.id)) return

    inFlight.current.add(chapter.id)
    setTransStatus('Preparando tradução…')
    translateParagraphs(
      chapter.paragraphs,
      (p) => setTransStatus(`Traduzindo… ${p.done}/${p.total}`),
      (loaded) => setTransStatus(`Baixando modelo de tradução… ${Math.round(loaded * 100)}%`),
    )
      .then((pt) => {
        setTranslations((t) => ({ ...t, [chapter.id]: pt }))
        void saveTranslation(media.bookId, chapter.id, pt).catch(() => {})
        setTransStatus(null)
      })
      .catch((e) => {
        setTransStatus(e instanceof Error ? e.message : 'Falha na tradução.')
      })
      .finally(() => {
        inFlight.current.delete(chapter.id)
      })
  }, [media, toggles.pt, chapter, translations])

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
        />
      )}
    </div>
  )
}
