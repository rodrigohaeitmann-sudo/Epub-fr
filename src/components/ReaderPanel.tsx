import { useEffect, useRef, useState } from 'react'
import type { Chapter, Toggles } from '../types'
import WordPopup from './WordPopup'

interface Props {
  chapter: Chapter | null
  translation?: string[]
  toggles: Toggles
  activeParagraph: number
  lineOffset: number
  onChangeLineOffset: (n: number) => void
  onSelectParagraph: (index: number) => void
  status?: string | null
}

const HAS_LETTER = /\p{L}/u
const OVERLAY_HIDE_MS = 2800

// Drop surrounding punctuation/quotes, keep apostrophes/hyphens inside the word.
function cleanWord(tok: string): string {
  return tok.replace(/^[^\p{L}]+/u, '').replace(/[^\p{L}]+$/u, '')
}

function FrenchText({ text, onWord }: { text: string; onWord: (w: string) => void }) {
  const tokens = text.split(/(\s+)/)
  return (
    <>
      {tokens.map((tok, i) =>
        HAS_LETTER.test(tok) ? (
          <button key={i} type="button" className="word" onClick={() => onWord(cleanWord(tok))}>
            {tok}
          </button>
        ) : (
          <span key={i}>{tok}</span>
        ),
      )}
    </>
  )
}

const formatOffset = (n: number) => (n > 0 ? `+${n}` : String(n))

export default function ReaderPanel({
  chapter,
  translation,
  toggles,
  activeParagraph,
  lineOffset,
  onChangeLineOffset,
  onSelectParagraph,
  status,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const [overlayVisible, setOverlayVisible] = useState(false)
  const ptRef = useRef<HTMLDivElement>(null)
  const enRef = useRef<HTMLDivElement>(null)
  const ptParas = useRef<Array<HTMLDivElement | null>>([])
  const enParas = useRef<Array<HTMLDivElement | null>>([])
  const syncing = useRef(false)
  const lastChapterId = useRef<string | null>(null)
  const hideTimer = useRef<number | null>(null)

  const showEn = toggles.fr
  const showPt = toggles.pt
  const dual = showEn && showPt

  // Measure the rendered PT line-height so the offset is in actual text lines.
  function lineHeightPx(): number {
    const el = ptParas.current.find((p) => p) || enParas.current.find((p) => p)
    if (!el) return 24
    const lh = parseFloat(getComputedStyle(el).lineHeight)
    return Number.isFinite(lh) && lh > 0 ? lh : 24
  }

  function offsetPx(): number {
    return lineOffset * lineHeightPx()
  }

  // Paragraph-aligned scroll sync. The panes hold the same paragraphs at the
  // same indices, but their heights differ wildly (especially when the PT pane
  // is only partially translated). Mapping by total-height ratio would drift,
  // so we anchor on the topmost visible paragraph and place its counterpart at
  // the same viewport position in the other pane.

  // Last paragraph whose top is at/above the given scrollTop (binary search;
  // offsetTop is monotonic since paragraphs stack vertically).
  function anchorIndex(paras: Array<HTMLDivElement | null>, scrollTop: number): number {
    let lo = 0
    let hi = paras.length - 1
    let ans = 0
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const el = paras[mid]
      if (el && el.offsetTop <= scrollTop) {
        ans = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    return ans
  }

  function syncPanes(
    src: HTMLDivElement,
    srcParas: Array<HTMLDivElement | null>,
    dst: HTMLDivElement,
    dstParas: Array<HTMLDivElement | null>,
    extraOffset: number,
  ) {
    const idx = anchorIndex(srcParas, src.scrollTop)
    const sEl = srcParas[idx]
    const dEl = dstParas[idx]
    if (!sEl || !dEl) return
    // How far we've scrolled into the anchor paragraph (0..1), carried over so
    // motion stays smooth within a paragraph rather than jumping at edges.
    const frac = sEl.offsetHeight > 0 ? (src.scrollTop - sEl.offsetTop) / sEl.offsetHeight : 0
    const clamped = Math.max(0, Math.min(1, frac))
    const dstMax = dst.scrollHeight - dst.clientHeight
    const target = dEl.offsetTop + clamped * dEl.offsetHeight + extraOffset
    dst.scrollTop = Math.max(0, Math.min(dstMax, target))
  }

  function syncFromEn() {
    const en = enRef.current
    const pt = ptRef.current
    if (!en || !pt || syncing.current) return
    syncing.current = true
    syncPanes(en, enParas.current, pt, ptParas.current, offsetPx())
    requestAnimationFrame(() => {
      syncing.current = false
    })
  }

  function syncFromPt() {
    const en = enRef.current
    const pt = ptRef.current
    if (!en || !pt || syncing.current) return
    syncing.current = true
    syncPanes(pt, ptParas.current, en, enParas.current, -offsetPx())
    requestAnimationFrame(() => {
      syncing.current = false
    })
  }

  // Bring the active paragraph to the top of each pane on chapter change.
  // Selecting a paragraph (to look up a word) must NOT scroll, only highlight.
  useEffect(() => {
    if (!chapter || lastChapterId.current === chapter.id) return
    lastChapterId.current = chapter.id
    syncing.current = true
    const toTop = (
      pane: HTMLDivElement | null,
      el: HTMLElement | null | undefined,
      extra = 0,
    ) => {
      if (pane && el) pane.scrollTop = Math.max(0, el.offsetTop - 12 + extra)
    }
    if (showPt) toTop(ptRef.current, ptParas.current[activeParagraph], dual ? offsetPx() : 0)
    if (showEn) toTop(enRef.current, enParas.current[activeParagraph])
    const id = requestAnimationFrame(() => {
      syncing.current = false
    })
    return () => cancelAnimationFrame(id)
  }, [activeParagraph, chapter?.id, showEn, showPt, dual])

  // Re-apply the line offset (visually nudge PT) whenever it changes.
  useEffect(() => {
    if (!dual) return
    syncFromEn()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineOffset, dual])

  function reveal() {
    setOverlayVisible(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setOverlayVisible(false), OVERLAY_HIDE_MS)
  }

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
  }, [])

  function adjust(delta: number) {
    onChangeLineOffset(lineOffset + delta)
    reveal()
  }

  if (!chapter) {
    return (
      <div className="reader">
        <p className="reader-empty">—</p>
      </div>
    )
  }

  const paras = chapter.paragraphs
  ptParas.current = []
  enParas.current = []

  return (
    <div className="reader">
      <div className="reader-chapter-title">{chapter.title}</div>
      <div className="panes">
        {showPt && (
          <div
            className={`pane pane-pt ${dual ? '' : 'pane-solo'}`}
            ref={ptRef}
            onScroll={dual ? syncFromPt : undefined}
            onClick={dual ? reveal : undefined}
          >
            {status && <p className="reader-status">{status}</p>}
            {paras.map((_, i) => (
              <div
                key={i}
                ref={(el) => {
                  ptParas.current[i] = el
                }}
                className={`para ${i === activeParagraph ? 'para-active' : ''}`}
                onClick={() => onSelectParagraph(i)}
              >
                <p className="para-pt">{translation?.[i] ?? ''}</p>
              </div>
            ))}
            {dual && overlayVisible && (
              <div className="sync-overlay-wrap">
                <div
                  className="sync-overlay"
                  onClick={(e) => {
                    e.stopPropagation()
                    reveal()
                  }}
                >
                  <button
                    className="sync-btn"
                    aria-label="Retroceder uma linha"
                    onClick={() => adjust(-1)}
                  >
                    −
                  </button>
                  <span className="sync-value">{formatOffset(lineOffset)} linhas</span>
                  <button
                    className="sync-btn"
                    aria-label="Avançar uma linha"
                    onClick={() => adjust(1)}
                  >
                    +
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {showEn && (
          <div
            className={`pane pane-fr ${dual ? '' : 'pane-solo'}`}
            ref={enRef}
            onScroll={dual ? syncFromEn : undefined}
          >
            {paras.map((text, i) => (
              <div
                key={i}
                ref={(el) => {
                  enParas.current[i] = el
                }}
                className={`para ${i === activeParagraph ? 'para-active' : ''}`}
                onClick={() => onSelectParagraph(i)}
              >
                <p className="para-fr">
                  <FrenchText text={text} onWord={setSelected} />
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {selected && <WordPopup word={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
