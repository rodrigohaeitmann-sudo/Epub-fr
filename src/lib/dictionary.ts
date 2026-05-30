import dictUrl from '../data/fr-pt.json?url'

interface Entry {
  t?: string[]
  i?: string
}

type Dict = Record<string, Entry>

export interface WordInfo {
  word: string
  matched: string | null
  ipa: string | null
  translations: string[]
}

let cache: Promise<Dict> | null = null

function load(): Promise<Dict> {
  if (!cache) {
    cache = fetch(dictUrl).then((r) => {
      if (!r.ok) throw new Error(`dict ${r.status}`)
      return r.json() as Promise<Dict>
    })
  }
  return cache
}

// Lowercase, normalise apostrophes, strip surrounding punctuation/quotes while
// keeping French letters (accents/diacritics), inner apostrophes and hyphens.
function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/^[^\p{L}]+/u, '')
    .replace(/[^\p{L}'-]+$/u, '')
}

// French elisions: l', d', j', n', m', t', s', c', qu', jusqu', lorsqu', etc.
// Tapping "l'eau" should look up "eau". Returns the part after the apostrophe.
function deElide(w: string): string | null {
  const m = w.match(/^(?:[cdjlmnst]|qu|jusqu|lorsqu|puisqu|quoiqu)'(.+)$/u)
  return m ? m[1] : null
}

// Map common French inflections back to a likely lemma. Order matters; the
// first form found in the dictionary wins. The dictionary already stores many
// surface forms (plurals, conjugations), so these are mostly a safety net.
function stems(w: string): string[] {
  const out: string[] = []
  const push = (s: string) => {
    if (s.length >= 2 && !out.includes(s)) out.push(s)
  }

  // Plural / feminine endings.
  if (w.endsWith('aux')) push(w.slice(0, -3) + 'al') // chevaux -> cheval
  if (w.endsWith('eaux')) push(w.slice(0, -1)) // bateaux -> bateau
  if (w.endsWith('s')) push(w.slice(0, -1)) // plural
  if (w.endsWith('x')) push(w.slice(0, -1)) // choux -> chou
  if (w.endsWith('e')) push(w.slice(0, -1)) // grande -> grand
  if (w.endsWith('es')) push(w.slice(0, -2))
  if (w.endsWith('ère')) push(w.slice(0, -3) + 'er') // première -> premier
  if (w.endsWith('ève')) push(w.slice(0, -3) + 'ever')

  // Verb endings -> infinitive guesses (-er group is the common case).
  for (const suf of ['aient', 'ait', 'ais', 'ant', 'ées', 'ée', 'és', 'é', 'es', 'ent', 'ons', 'ez', 'as', 'ai', 'a', 'e']) {
    if (w.endsWith(suf)) push(w.slice(0, -suf.length) + 'er')
  }
  return out
}

function get(dict: Dict, key: string): Entry | null {
  if (!Object.prototype.hasOwnProperty.call(dict, key)) return null
  const e = dict[key]
  return e && (Array.isArray(e.t) || typeof e.i === 'string') ? e : null
}

export async function lookup(raw: string): Promise<WordInfo> {
  const word = normalize(raw)
  const info: WordInfo = { word, matched: null, ipa: null, translations: [] }
  if (!word) return info

  const dict = await load()
  const elided = deElide(word)
  const candidates = [word, ...(elided ? [elided] : []), ...stems(elided ?? word)]
  for (const key of candidates) {
    const e = get(dict, key)
    if (e) {
      info.matched = key
      info.ipa = e.i ?? null
      info.translations = e.t ?? []
      break
    }
  }
  return info
}

let voicesReady = false
function ensureVoices() {
  if (voicesReady || typeof speechSynthesis === 'undefined') return
  speechSynthesis.getVoices()
  voicesReady = true
}

export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function speak(text: string): void {
  if (!canSpeak() || !text) return
  ensureVoices()
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'fr-FR'
  u.rate = 0.9
  const frVoice = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith('fr'))
  if (frVoice) u.voice = frVoice
  speechSynthesis.speak(u)
}
