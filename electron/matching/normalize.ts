// Text normalization shared by the catalog index and incoming chat messages.
// Every key we build for a title is built the same way for a message, so the
// two sides always meet in the same space.

const PUNCT = /[\p{P}\p{S}]+/gu;
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;
const URL_RE = /\bhttps?:\/\/\S+/gi;
const MENTION = /(^|\s)@\S+/g;
// text emoticons that would otherwise leave stray tokens ("<3" -> "3")
const EMOTICON = /<\/?3+|[:;=xX8][-']?[)(DPpOo3\]\[|/\\]+(?=\s|$)|\^\^|\bT_T\b|\bo7\b/g;

// Leading noise people type before the actual vote.
const VOTE_PREFIX =
  /^(?:!?(?:vote|voting|poll|pick|choose|my vote|i vote(?: for)?)\b[:\s-]*)+/;

// Trailing noise that does not identify a show.
const TRAILING_NOISE =
  /\s+(?:pls|plz|please|pleaseee+|for sure|ofc|obviously|lets go+|let'?s go+|gogo+|easy|ez)$/;

// Season / part markers. Polls run on franchises (shows without a prequel),
// so "frieren season 2" should land on Frieren.
const SEASON_MARKERS = [
  /\b(?:season|seasons|szn|cour|part|pt|arc)\s*\d+\b/g,
  /\b\d+(?:st|nd|rd|th)\s+(?:season|cour|part)\b/g,
  /\b(?:first|second|third|fourth|fifth|final)\s+(?:season|cour|part)\b/g,
  /\bs\d{1,2}\b/g,
  /\b(?:ii|iii|iv)\b$/g,
];

export function stripDiacritics(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}+/gu, '');
}

/** Base normalization: lowercase, no diacritics, punctuation -> space. */
export function normalize(text: string): string {
  return stripDiacritics(text.normalize('NFKC'))
    .toLowerCase()
    .replace(/[×✕]/g, ' x ')
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(PUNCT, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Romaji folding: long vowels are written many ways (Kyōjin, Kyoujin, Kyojin,
 * Kyoojin), particles too (wo/o, he/e). Fold them all to one spelling.
 */
export function foldRomaji(text: string): string {
  return text
    .replace(/ou/g, 'o')
    .replace(/oo/g, 'o')
    .replace(/uu/g, 'u')
    .replace(/aa/g, 'a')
    .replace(/ii/g, 'i')
    .replace(/ee/g, 'e')
    .replace(/\bwo\b/g, 'o')
    .replace(/\bwa\b/g, 'ha')
    .replace(/([a-z])\1{2,}/g, '$1'); // frierennnn -> frieren
}

export function stripSeasonMarkers(text: string): string {
  let out = text;
  for (const re of SEASON_MARKERS) out = out.replace(re, ' ');
  return out.replace(/\s+/g, ' ').trim();
}

/** Canonical key used for exact lookups and n-gram indexing. */
export function canonical(text: string): string {
  return foldRomaji(normalize(text));
}

export function compact(key: string): string {
  return key.replace(/\s+/g, '');
}

/**
 * Clean a raw chat message into a candidate vote string, or null if it
 * clearly isn't one (empty, too long, a link, ...).
 */
export function cleanMessage(raw: string): string | null {
  let text = raw
    .replace(URL_RE, ' ')
    .replace(MENTION, ' ')
    .replace(EMOJI, ' ')
    .replace(EMOTICON, ' ');
  text = normalize(text);
  text = text.replace(VOTE_PREFIX, '').replace(TRAILING_NOISE, '').trim();
  // light novel titles get long, so the caps are generous
  if (text.length < 2 || text.length > 180) return null;
  if (text.split(' ').length > 30) return null;
  return text;
}
