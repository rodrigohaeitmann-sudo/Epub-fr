import { useEffect, useState } from 'react'
import { canSpeak, lookup, speak, type WordInfo } from '../lib/dictionary'
import { translateWord } from '../lib/translate'

interface Props {
  word: string
  onClose: () => void
}

export default function WordPopup({ word, onClose }: Props) {
  const [info, setInfo] = useState<WordInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [netTrans, setNetTrans] = useState<string | null>(null)
  const [netLoading, setNetLoading] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setInfo(null)
    setNetTrans(null)
    setNetLoading(false)
    lookup(word)
      .then((res) => {
        if (!alive) return
        setInfo(res)
        // Offline dictionary has phonetics but no gloss: fetch FR->PT online.
        if (res.translations.length === 0) {
          setNetLoading(true)
          translateWord(res.word || word)
            .then((pt) => {
              if (alive && pt && pt.toLowerCase() !== (res.word || word).toLowerCase()) {
                setNetTrans(pt)
              }
            })
            .finally(() => {
              if (alive) setNetLoading(false)
            })
        }
      })
      .catch(() => {
        if (alive) setInfo({ word, matched: null, ipa: null, translations: [] })
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [word])

  // Speak the word as soon as the popup opens.
  useEffect(() => {
    speak(word)
  }, [word])

  const display = info?.word || word.trim()

  return (
    <div className="word-sheet-backdrop" onClick={onClose}>
      <div className="word-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="word-sheet-head">
          <span className="word-sheet-term">{display}</span>
          {canSpeak() && (
            <button className="word-sheet-listen" onClick={() => speak(display)} aria-label="Ouvir">
              🔊 Ouvir
            </button>
          )}
        </div>

        {loading && <p className="word-sheet-status">Carregando…</p>}

        {!loading && info && (
          <>
            {info.ipa && <p className="word-sheet-ipa">/{info.ipa}/</p>}
            {info.translations.length > 0 ? (
              <ul className="word-sheet-trans">
                {info.translations.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            ) : netTrans ? (
              <ul className="word-sheet-trans">
                <li>{netTrans}</li>
              </ul>
            ) : netLoading ? (
              <p className="word-sheet-status">Traduzindo…</p>
            ) : (
              <p className="word-sheet-status">Tradução não encontrada.</p>
            )}
          </>
        )}

        <button className="word-sheet-close" onClick={onClose}>
          Fechar
        </button>
      </div>
    </div>
  )
}
