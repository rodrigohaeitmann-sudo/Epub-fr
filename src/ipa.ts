/**
 * Transcrição fonética aproximada (IPA) para francês, por regras.
 *
 * Serve de apoio quando a palavra tocada não está na planilha (que traz o IPA
 * revisado). É uma aproximação: cobre os dígrafos, as vogais nasais e as
 * consoantes finais mudas mais comuns, mas não conhece exceções lexicais nem
 * liaison. Por isso o app sempre rotula o resultado como "aproximado" e dá
 * preferência ao IPA vindo do card.
 */

type Rule = [RegExp, string]

const VOWEL = 'aeiouyâàéèêëîïôùûüœ·'
const NOT_VOWEL_OR_NASAL = `(?![${VOWEL}nm])`

// Palavras muito frequentes cuja grafia foge das regras.
const EXCEPTIONS: Record<string, string> = {
  femme: 'fam',
  monsieur: 'məsjø',
  fils: 'fis',
  oeil: 'œj',
  œil: 'œj',
  eu: 'y',
  est: 'ɛ',
  et: 'e',
  les: 'le',
  des: 'de',
  mes: 'me',
  tes: 'te',
  ses: 'se',
  ces: 'se',
  qui: 'ki',
  aujourd: 'oʒuʁ',
}

// Aplicadas em ordem: grupos mais longos antes dos mais curtos.
const RULES: Rule[] = [
  // terminações vocálicas em -il/-ill (travail, soleil, feuille)
  [new RegExp(`^ail$|^ail(?=[^${VOWEL}])`), 'aj'],
  [new RegExp(`^eil$|^eil(?=[^${VOWEL}])`), 'ɛj'],
  [new RegExp(`^(euil|œil|oeil)$`), 'œj'],

  // nasais compostas (antes dos ditongos orais correspondentes)
  [new RegExp(`^oin${NOT_VOWEL_OR_NASAL}`), 'wɛ̃'],
  [new RegExp(`^(ain|aim|ein|eim)${NOT_VOWEL_OR_NASAL}`), 'ɛ̃'],
  [new RegExp(`^ien${NOT_VOWEL_OR_NASAL}`), 'jɛ̃'],
  [new RegExp(`^(ean|aen)${NOT_VOWEL_OR_NASAL}`), 'ɑ̃'],

  // dígrafos vocálicos orais
  [/^eau/, 'o'],
  [/^au/, 'o'],
  [/^(œu|oeu)/, 'œ'],
  [new RegExp(`^eu(?=[^${VOWEL}])`), 'œ'],
  [/^eu/, 'ø'],
  [/^ou/, 'u'],
  [/^oi/, 'wa'],
  [/^(ai|aî)/, 'ɛ'],
  [/^(ei|ey)/, 'ɛ'],

  // nasais simples
  [new RegExp(`^(in|im|yn|ym)${NOT_VOWEL_OR_NASAL}`), 'ɛ̃'],
  [new RegExp(`^(an|am|en|em)${NOT_VOWEL_OR_NASAL}`), 'ɑ̃'],
  [new RegExp(`^(on|om)${NOT_VOWEL_OR_NASAL}`), 'ɔ̃'],
  [new RegExp(`^(un|um)${NOT_VOWEL_OR_NASAL}`), 'œ̃'],

  // consoantes e dígrafos consonantais
  [/^ch/, 'ʃ'],
  [/^ph/, 'f'],
  [/^th/, 't'],
  [/^gn/, 'ɲ'],
  [/^qu/, 'k'],
  [/^g/, 'ɡ'],
  [/^ç/, 's'],
  [/^c/, 'k'],
  [/^j/, 'ʒ'],
  [/^h/, ''],
  [/^r/, 'ʁ'],
  [/^x/, 'ks'],
  [new RegExp(`^y(?=[${VOWEL}])`), 'j'],
  [/^y/, 'i'],

  // vogais simples e acentuadas
  [/^é/, 'e'],
  [/^(è|ê|ë)/, 'ɛ'],
  [/^(à|â)/, 'a'],
  [/^ô/, 'o'],
  [/^(î|ï)/, 'i'],
  [new RegExp(`^i(?=[${VOWEL}])`), 'j'],
  [/^(û|ù)/, 'y'],
  [/^u/, 'y'],
  [/^o/, 'ɔ'],
  [/^i/, 'i'],
  [/^a/, 'a'],
  // "e" travado por consoante dupla ou final soa /ɛ/; solto vira schwa
  [new RegExp(`^e(?=[^${VOWEL}]{2}|[^${VOWEL}]$)`), 'ɛ'],
  [/^e/, 'ə'],
]

// Grupo final tipicamente mudo (c, r, f, l costumam soar em francês).
const SILENT_TAIL = /(?:ent|[tsdxzpg]+)$/

function transcribeWord(raw: string): string {
  const clean = raw.toLowerCase().trim()
  if (!clean) return ''
  if (EXCEPTIONS[clean]) return EXCEPTIONS[clean]

  let word = clean
  // g/c antes de e, i, y são suaves — decidido antes de o "e" final cair
  word = word.replace(/gu(?=[eiy])/g, 'ǥ').replace(/g(?=[eiyéèê])/g, 'ǧ')
  word = word.replace(/c(?=[eiyéèê])/g, 'ȼ')
  // "s" entre vogais soa /z/
  word = word.replace(new RegExp(`([${VOWEL}])s([${VOWEL}])`, 'g'), '$1§$2')
  // -ill- resolvido antes de simplificar duplas (fille, travailler)
  word = word.replace(/ill/g, '¥')
  // duplas soam simples; nn/mm ficam, pois é o que bloqueia a nasalização
  word = word.replace(/([bcdfglprstz])\1/g, '$1')

  // "e" final é mudo, mas mantém audível a consoante anterior e impede a nasal
  // o "e" final não soa, mas mantém a consoante audível e impede a nasalização
  const hadFinalE = new RegExp(`[^${VOWEL}]e$`).test(word)
  if (hadFinalE) word = `${word.slice(0, -1)}·`
  else if (word.length > 2) {
    const trimmed = word.replace(SILENT_TAIL, '')
    if (trimmed.length >= 2) word = trimmed
  }

  let out = ''
  let rest = word
  let guard = 0
  while (rest && guard++ < 80) {
    if (rest[0] === '§') {
      out += 'z'
      rest = rest.slice(1)
      continue
    }
    if (rest[0] === '¥') {
      out += 'ij'
      rest = rest.slice(1)
      continue
    }
    const marker = { 'ǧ': 'ʒ', 'ǥ': 'ɡ', 'ȼ': 's', '·': '' }[rest[0]]
    if (marker !== undefined) {
      out += marker
      rest = rest.slice(1)
      continue
    }
    const rule = RULES.find(([pattern]) => pattern.test(rest))
    if (rule) {
      const [pattern, replacement] = rule
      out += replacement
      rest = rest.replace(pattern, '')
      continue
    }
    if (/[a-zà-ÿ]/.test(rest[0])) out += rest[0]
    rest = rest.slice(1)
  }

  return out
    .replace(/ə$/, '')
    .replace(/([aeiouɛɔœøɑy])ij/g, '$1j')
    .replace(/(.)\1+/g, '$1')
}

/** Transcrição aproximada de uma palavra ou trecho em francês. */
export function frenchIpa(text: string): string {
  const words = text.split(/[\s'’]+/).map((word) => word.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ''))
  const parts = words.filter(Boolean).map(transcribeWord).filter(Boolean)
  return parts.length ? `/${parts.join(' ')}/` : ''
}
