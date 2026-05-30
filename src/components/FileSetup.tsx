import { useState } from 'react'
import type { LoadedBook } from '../types'
import { parseEpub } from '../lib/parseEpub'
import { parseAudioChapters } from '../lib/parseAudioChapters'
import { saveSession } from '../lib/sessionStore'

interface Props {
  onReady: (media: LoadedBook) => void
}

export default function FileSetup({ onReady }: Props) {
  const [epub, setEpub] = useState<File | null>(null)
  const [audio, setAudio] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const canStart = epub !== null && audio !== null && !busy

  async function handleStart() {
    if (!epub || !audio) return
    setError('')
    setBusy(true)
    try {
      const parsed = await parseEpub(await epub.arrayBuffer())
      const audioChapters = await parseAudioChapters(audio).catch(() => [])
      const bookId = `${epub.name}:${epub.size}`
      const coverUrl = parsed.coverBlob ? URL.createObjectURL(parsed.coverBlob) : undefined
      const book = {
        title: parsed.title,
        author: parsed.author,
        coverUrl,
        chapters: parsed.chapters,
      }
      onReady({ audioUrl: URL.createObjectURL(audio), bookId, book, audioChapters })
      // Persist for auto-reopen in the background (best-effort).
      void saveSession({
        bookId,
        audioBlob: audio,
        coverBlob: parsed.coverBlob,
        book: { title: parsed.title, author: parsed.author, chapters: parsed.chapters },
        audioChapters,
      }).catch(() => {})
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao ler o EPUB.')
      setBusy(false)
    }
  }

  return (
    <div className="setup">
      <h1>Leitor de Audiobook · FR</h1>
      <p className="setup-hint">
        Selecione um EPUB em francês e o áudio do audiobook. A tradução para o português e
        a fonética (AFI) são geradas dentro do app conforme você lê.
      </p>

      <label className="file-field">
        <span>Livro (.epub)</span>
        <input
          type="file"
          accept=".epub,application/epub+zip"
          onChange={(e) => setEpub(e.target.files?.[0] ?? null)}
        />
        {epub && <small>{epub.name}</small>}
      </label>

      <label className="file-field">
        <span>Áudio do audiobook</span>
        <input
          type="file"
          accept="audio/*"
          onChange={(e) => setAudio(e.target.files?.[0] ?? null)}
        />
        {audio && <small>{audio.name}</small>}
      </label>

      {error && <p className="setup-error">{error}</p>}

      <button className="start-btn" disabled={!canStart} onClick={handleStart}>
        {busy ? 'Abrindo…' : 'Começar'}
      </button>
    </div>
  )
}
