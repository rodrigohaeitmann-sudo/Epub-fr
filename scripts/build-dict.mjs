// Builds the compact French dictionary used by the in-app word popup
// (offline FR phonetics + FR->PT translation).
//
// Output shape (src/data/fr-pt.json):
//   { "maison": { "i": "mɛzɔ̃", "t": ["casa"] }, ... }
//   i = French IPA (optional), t = list of Portuguese translations (optional).
//
// French IPA is the headline feature, so phonetics come from the large
// open-dict-data/ipa-dict French list (~245k surface forms incl. inflections),
// pruned to the most frequent words for a reasonable bundle size.
//
// FR->PT glosses are bridged FR -> EN -> PT: FreeDict fra-eng gives English
// glosses (and a French IPA fallback), then the existing English->Portuguese
// table (src/data/en-pt.json) maps those glosses to Portuguese.
//
// Sources (all GPL-compatible / open data):
//   - open-dict-data/ipa-dict           fr_FR.txt   (French IPA)
//   - hermitdave/FrequencyWords         fr_50k.txt  (frequency prune)
//   - freedict/fd-dictionaries          fra-eng.tei (FR->EN + IPA fallback)
//   - src/data/en-pt.json               (EN->PT bridge, already in repo)
//
// Usage: node scripts/build-dict.mjs
// Optional overrides via env: IPA_SRC, FREQ_SRC, FRAENG_SRC (local file paths).

import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const IPA_URL = 'https://raw.githubusercontent.com/open-dict-data/ipa-dict/master/data/fr_FR.txt'
const FREQ_URL =
  'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/fr/fr_50k.txt'
const FRAENG_URL =
  'https://raw.githubusercontent.com/freedict/fd-dictionaries/master/fra-eng/fra-eng.tei'

// Keep the IPA-only headwords to the N most frequent words. Words that also
// get a Portuguese gloss are always kept, regardless of rank.
const FREQ_LIMIT = 45000

async function source(envKey, url) {
  const local = process.env[envKey]
  if (local && existsSync(local)) return readFileSync(local, 'utf8')
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`)
  return res.text()
}

function decode(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim()
}

// Lowercase, normalise apostrophes; keep French letters/apostrophes/hyphens.
function norm(s) {
  return s.toLowerCase().replace(/[’‘]/g, "'").trim()
}

console.error('· loading sources…')
const [ipaTxt, freqTxt, fraEngXml, enPtRaw] = await Promise.all([
  source('IPA_SRC', IPA_URL),
  source('FREQ_SRC', FREQ_URL),
  source('FRAENG_SRC', FRAENG_URL),
  Promise.resolve(readFileSync('src/data/en-pt.json', 'utf8')),
])

const enPt = JSON.parse(enPtRaw)

// --- French IPA (first pronunciation only) -------------------------------
const ipa = new Map()
for (const line of ipaTxt.split('\n')) {
  const tab = line.indexOf('\t')
  if (tab < 0) continue
  const word = norm(line.slice(0, tab))
  if (!word) continue
  const prons = line.slice(tab + 1).trim()
  const first = prons.split(',')[0].replace(/\//g, '').trim()
  if (first && !ipa.has(word)) ipa.set(word, first)
}
console.error(`· ${ipa.size} French IPA forms`)

// --- Frequency rank ------------------------------------------------------
const rank = new Map()
let r = 0
for (const line of freqTxt.split('\n')) {
  const word = norm(line.split(' ')[0])
  if (word && !rank.has(word)) rank.set(word, r++)
}
console.error(`· ${rank.size} frequency-ranked words`)

// --- FR -> EN (FreeDict) with French IPA fallback ------------------------
const fraEng = new Map() // french -> { glosses:Set, pron:string }
const body = fraEngXml.slice(fraEngXml.indexOf('<body>'), fraEngXml.indexOf('</body>'))
for (const entry of body.match(/<entry>[\s\S]*?<\/entry>/g) ?? []) {
  const orth = entry.match(/<orth>([\s\S]*?)<\/orth>/)
  if (!orth) continue
  const word = norm(decode(orth[1]))
  if (!word) continue
  const pron = entry.match(/<pron>([\s\S]*?)<\/pron>/)
  const glosses = new Set()
  for (const cit of entry.match(/<cit type="trans">[\s\S]*?<\/cit>/g) ?? []) {
    const q = cit.match(/<quote>([\s\S]*?)<\/quote>/)
    if (q) {
      const g = decode(q[1]).toLowerCase()
      if (g) glosses.add(g)
    }
  }
  const cur = fraEng.get(word) ?? { glosses: new Set(), pron: '' }
  for (const g of glosses) cur.glosses.add(g)
  if (!cur.pron && pron) cur.pron = decode(pron[1])
  fraEng.set(word, cur)
}
console.error(`· ${fraEng.size} FR->EN headwords`)

// --- Bridge FR -> EN -> PT ----------------------------------------------
function bridgeToPt(glosses) {
  const out = []
  for (const g of glosses) {
    const e = enPt[g]
    if (e && Array.isArray(e.t)) {
      for (const t of e.t) if (!out.includes(t)) out.push(t)
    }
    if (out.length >= 6) break
  }
  return out.slice(0, 6)
}

// --- Assemble ------------------------------------------------------------
const dict = Object.create(null)

// Every French word that earns a Portuguese gloss (always kept).
for (const [word, info] of fraEng) {
  const t = bridgeToPt(info.glosses)
  if (t.length === 0) continue
  const i = ipa.get(word) || (info.pron ? norm(info.pron) : '')
  dict[word] = i ? { i, t } : { t }
}

// Frequent words: add IPA-only entries for the rest.
const ranked = [...rank.entries()].filter(([w]) => w.length >= 2 && ipa.has(w))
ranked.sort((a, b) => a[1] - b[1])
for (const [word] of ranked.slice(0, FREQ_LIMIT)) {
  if (dict[word]) continue
  dict[word] = { i: ipa.get(word) }
}

const out = 'src/data/fr-pt.json'
const json = JSON.stringify(dict)
writeFileSync(out, json)
const count = Object.keys(dict).length
const withT = Object.values(dict).filter((e) => e.t && e.t.length).length
const withI = Object.values(dict).filter((e) => e.i).length
console.error(
  `✓ wrote ${count} entries to ${out} ` +
    `(${withI} with IPA, ${withT} with PT) — ${(Buffer.byteLength(json) / 1024 / 1024).toFixed(2)} MB`,
)
