// FR -> PT translation. Prefers Chrome's on-device Translator API (desktop
// Chrome/Edge); falls back to a free network translation when the on-device
// API is unavailable (e.g. Android, Safari, Firefox).

const SOURCE = 'fr'
const TARGET = 'pt'

function getStatic(): TranslatorStatic | undefined {
  if (typeof Translator !== 'undefined') return Translator
  if (typeof window !== 'undefined' && window.Translator) return window.Translator
  return undefined
}

export function isTranslatorSupported(): boolean {
  return getStatic() !== undefined
}

export async function getAvailability(): Promise<TranslatorAvailability> {
  const T = getStatic()
  if (!T) return 'unavailable'
  try {
    return await T.availability({ sourceLanguage: SOURCE, targetLanguage: TARGET })
  } catch {
    return 'unavailable'
  }
}

let translatorPromise: Promise<TranslatorInstance> | null = null

function getTranslator(onDownload?: (loaded: number) => void): Promise<TranslatorInstance> {
  if (!translatorPromise) {
    const T = getStatic()
    if (!T) return Promise.reject(new Error('Translator API indisponível.'))
    translatorPromise = T.create({
      sourceLanguage: SOURCE,
      targetLanguage: TARGET,
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => onDownload?.(e.loaded))
      },
    }).catch((err) => {
      translatorPromise = null
      throw err
    })
  }
  return translatorPromise
}

// Split long text on sentence/word boundaries to keep request URLs reasonable.
function splitChunks(text: string, max = 1500): string[] {
  if (text.length <= max) return [text]
  const parts: string[] = []
  let rest = text
  while (rest.length > max) {
    let cut = rest.lastIndexOf('. ', max)
    if (cut < max * 0.5) cut = rest.lastIndexOf(' ', max)
    if (cut <= 0) cut = max
    parts.push(rest.slice(0, cut + 1))
    rest = rest.slice(cut + 1)
  }
  if (rest) parts.push(rest)
  return parts
}

async function networkTranslate(text: string): Promise<string> {
  const chunks = splitChunks(text)
  const results: string[] = []
  for (const chunk of chunks) {
    const url =
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${SOURCE}` +
      `&tl=${TARGET}&dt=t&q=${encodeURIComponent(chunk)}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`tradução de rede falhou (${res.status})`)
    // Response shape: [[[ "translated", "original", ... ], ...], ...]
    const data: unknown = await res.json()
    const segments = Array.isArray(data) && Array.isArray(data[0]) ? data[0] : []
    const out = segments
      .map((s) => (Array.isArray(s) && typeof s[0] === 'string' ? s[0] : ''))
      .join('')
    results.push(out)
  }
  return results.join('')
}

// Single-word FR -> PT via the network, used by the word popup when the
// offline dictionary has phonetics but no translation. Returns '' on failure.
export async function translateWord(word: string): Promise<string> {
  const w = word.trim()
  if (!w) return ''
  try {
    return (await networkTranslate(w)).trim()
  } catch {
    return ''
  }
}

export interface TranslateProgress {
  done: number
  total: number
}

// Translate a chapter's paragraphs in order. Returns one PT string per input.
export async function translateParagraphs(
  texts: string[],
  onProgress?: (p: TranslateProgress) => void,
  onDownload?: (loaded: number) => void,
): Promise<string[]> {
  let chromeT: TranslatorInstance | null = null
  if (isTranslatorSupported()) {
    try {
      chromeT = await getTranslator(onDownload)
    } catch {
      chromeT = null
    }
  }

  const out: string[] = []
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i]
    if (!text.trim()) {
      out.push('')
      onProgress?.({ done: i + 1, total: texts.length })
      continue
    }
    try {
      out.push(chromeT ? await chromeT.translate(text) : await networkTranslate(text))
    } catch {
      // On-device failed mid-way: retry over the network.
      try {
        out.push(await networkTranslate(text))
      } catch {
        out.push('')
      }
    }
    onProgress?.({ done: i + 1, total: texts.length })
  }
  return out
}
