// Benchmark: legacy SQL/LIKE matcher vs the new TF-IDF + Jaro-Winkler matcher.
//
//   pnpm bench:matching        (builds electron/ first)
//
// Queries are generated deterministically from the catalog (seeded RNG) to
// mimic chat: typos, missing spaces, shouting, emoji, "!vote" prefixes,
// season suffixes, truncation, plus a hand-written set of real chat-style
// votes and a set of non-vote chatter that must NOT match anything.

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(fileURLToPath(import.meta.url), '../..');
// --db <file>: v1 (got-poll, table "anime") or v2 (table "shows") catalog.
// The legacy matcher can only run against a v1 file.
const dbArg = process.argv.includes('--db') ? process.argv[process.argv.indexOf('--db') + 1] : 'assets/shows.db';
const db = new DatabaseSync(path.resolve(root, dbArg), { readOnly: true });
const isV1 = !!db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'anime'").get();

let shows;
let sequels = [];
if (isV1) {
  shows = db.prepare('SELECT * FROM anime WHERE has_prequel = 0').all().map((r) => ({
    id: r.id,
    titleRomaji: r.title_romaji,
    titleEnglish: r.title_english,
    synonyms: (r.synonyms || '').split(',').map((s) => s.trim()).filter(Boolean),
    popularity: r.popularity || 0,
  }));
} else {
  const rows = db.prepare('SELECT * FROM shows').all();
  const ids = new Set(rows.map((r) => r.id));
  const eligible = (r) => r.parent_id === null || (r.parent_id !== -1 && !ids.has(r.parent_id));
  const byId = new Map(rows.map((r) => [r.id, r]));
  shows = rows.filter(eligible).map((r) => ({
    id: r.id,
    titleRomaji: r.title_romaji,
    titleEnglish: r.title_english,
    synonyms: JSON.parse(r.synonyms),
    popularity: r.popularity || 0,
  }));
  for (const r of rows) {
    if (eligible(r)) continue;
    let cur = r;
    for (let i = 0; cur && !eligible(cur) && i < 40; i++) cur = byId.get(cur.parent_id);
    if (!cur) continue;
    for (const t of [r.title_romaji, r.title_english, ...JSON.parse(r.synonyms)]) {
      if (t && /^[\p{Script=Latin}\p{N}\p{P}\p{S}\s]+$/u.test(t)) sequels.push({ title: t, rootId: cur.id });
    }
  }
}
const byId = new Map(shows.map((s) => [s.id, s]));

// ---------------------------------------------------------------- legacy
// Verbatim port of got-poll/electron/db.ts searchShow (minus ignores/formats).
const legacy = !isV1 ? null : (() => {
  const normalizeSearchText = (text) =>
    text
      .toLowerCase()
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\b(the|a|an|no|no\.|vol|volume|season|episode|ep)\b/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  const createSearchPatterns = (query) => {
    const words = normalizeSearchText(query).split(' ');
    const patterns = [words.join(' '), words.join(''), words.reverse().join(' '), words.join('.*')];
    if (words.length > 1) patterns.push(...words);
    return [...new Set(patterns)];
  };
  const sim = (a, b) => {
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return 0.8;
    const w1 = a.split(/\s+/), w2 = b.split(/\s+/);
    return w1.filter((w) => w2.includes(w)).length / Math.max(w1.length, w2.length);
  };
  const exact = db.prepare(`
    SELECT id FROM anime WHERE has_prequel = 0 AND start_year IS NOT NULL AND season IS NOT NULL
    AND (LOWER(title_romaji) = ? OR (title_english IS NOT NULL AND LOWER(title_english) = ?) OR
      (synonyms != '' AND (LOWER(synonyms) LIKE ? OR LOWER(synonyms) LIKE ? OR LOWER(synonyms) LIKE ? OR LOWER(synonyms) LIKE ?)))
    ORDER BY popularity DESC LIMIT 1`);
  const cache = new Map();
  return (message) => {
    const q = message.trim().toLowerCase();
    if (cache.has(q)) return cache.get(q);
    let out = -1;
    const e = exact.get(q, q, `${q},%`, `%,${q},%`, `%,${q}`, q);
    if (e) out = e.id;
    else {
      const pats = createSearchPatterns(q);
      const cond = pats.map(() => `LOWER(title_romaji) LIKE ? OR (title_english IS NOT NULL AND LOWER(title_english) LIKE ?) OR (synonyms != '' AND LOWER(synonyms) LIKE ?)`).join(' OR ');
      const rs = db.prepare(`SELECT id, title_romaji, title_english, synonyms FROM anime WHERE has_prequel = 0 AND (${cond}) ORDER BY popularity DESC LIMIT 30`)
        .all(...pats.flatMap((p) => [`%${p}%`, `%${p}%`, `%${p}%`]));
      if (rs.length) {
        const score = (r) => Math.max(...[r.title_romaji, r.title_english, ...(r.synonyms || '').split(',')]
          .filter(Boolean).map((t) => sim(q, t.trim().toLowerCase())));
        out = rs.reduce((b, c) => (score(c) > score(b) ? c : b)).id;
      }
    }
    cache.set(q, out);
    return out;
  };
})();

// ---------------------------------------------------------------- queries
let seed = 1337;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = (a) => a[Math.floor(rand() * a.length)];
const letters = 'abcdefghijklmnopqrstuvwxyz';

const typo = (s) => {
  const i = 1 + Math.floor(rand() * Math.max(1, s.length - 2));
  switch (Math.floor(rand() * 4)) {
    case 0: return s.slice(0, i) + s.slice(i + 1); // deletion
    case 1: return s.slice(0, i) + pick(letters) + s.slice(i); // insertion
    case 2: return s.slice(0, i) + pick(letters) + s.slice(i + 1); // substitution
    default: return s.slice(0, i - 1) + s[i] + s[i - 1] + s.slice(i + 1); // transposition
  }
};

/** queries built from a romaji title that differs from the English one */
const romajiQueries = new Set();
const popular = [...shows].sort((a, b) => b.popularity - a.popularity).slice(0, 1500);
const generated = [];
for (const s of popular) {
  const useEnglish = s.titleEnglish && rand() < 0.5;
  const title = (useEnglish ? s.titleEnglish : s.titleRomaji).toLowerCase();
  if (title.length < 4) continue;
  const isRomaji = !useEnglish && s.titleEnglish && s.titleEnglish.toLowerCase() !== title;
  const before = generated.length;
  generated.push(['exact', title, s.id]);
  generated.push(['typo', typo(title), s.id]);
  if (title.length > 10) generated.push(['2 typos', typo(typo(title)), s.id]);
  if (title.includes(' ')) generated.push(['no spaces', title.replace(/[^a-z0-9]/g, ''), s.id]);
  generated.push(['chat noise', `${pick(['!vote ', 'vote ', '', ''])}${title.toUpperCase()}${pick([' 🔥🔥', '!!!', ' pls', ' <3', ''])}`, s.id]);
  generated.push(['season suffix', `${title} ${pick(['season 2', 's3', '2nd season', 'part 2'])}`, s.id]);
  const noPunct = title.replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ');
  if (noPunct !== title) generated.push(['no punctuation', noPunct, s.id]);
  if (isRomaji) for (let i = before; i < generated.length; i++) romajiQueries.add(generated[i][1]);
}

// keep the run short – the legacy matcher does ~30 LIKE scans per query
while (generated.length > 2500) generated.splice(Math.floor(rand() * generated.length), 1);

// Hand-written chat-style votes. Expected id resolved by exact title so the
// list stays readable; anything that doesn't resolve is reported.
const curatedSpec = [
  ['aot', 'Shingeki no Kyojin'], ['snk', 'Shingeki no Kyojin'], ['attack on titan', 'Shingeki no Kyojin'],
  ['shingeki', 'Shingeki no Kyojin'], ['jjk', 'Jujutsu Kaisen'], ['jujutsu kaisen', 'Jujutsu Kaisen'],
  ['jujutsu', 'Jujutsu Kaisen'], ['demon slayer', 'Kimetsu no Yaiba'], ['kimetsu', 'Kimetsu no Yaiba'],
  ['frieren', 'Sousou no Frieren'], ['FRIEREN!!!', 'Sousou no Frieren'], ['sousou no frieren', 'Sousou no Frieren'],
  ['frieran', 'Sousou no Frieren'], ['mha', 'Boku no Hero Academia'], ['my hero academia', 'Boku no Hero Academia'],
  ['hxh', 'HUNTER×HUNTER (2011)'], ['hunter x hunter', 'HUNTER×HUNTER (2011)'], ['hunterxhunter', 'HUNTER×HUNTER (2011)'],
  ['opm', 'One Punch Man'], ['onepunch man', 'One Punch Man'], ['one punch', 'One Punch Man'],
  ['fmab', 'Hagane no Renkinjutsushi: FULLMETAL ALCHEMIST'], ['fullmetal alchemist brotherhood', 'Hagane no Renkinjutsushi: FULLMETAL ALCHEMIST'],
  ['one piece', 'ONE PIECE'], ['onepiece', 'ONE PIECE'], ['naruto', 'NARUTO'], ['death note', 'DEATH NOTE'],
  ['deathnote', 'DEATH NOTE'], ['your name', 'Kimi no Na wa.'], ['kimi no na wa', 'Kimi no Na wa.'],
  ['chainsaw man', 'Chainsaw Man'], ['chainsawman', 'Chainsaw Man'], ['csm', 'Chainsaw Man'],
  ['spy x family', 'SPY×FAMILY'], ['spy family', 'SPY×FAMILY'], ['spyxfamily', 'SPY×FAMILY'],
  ['steins gate', 'Steins;Gate'], ['steinsgate', 'Steins;Gate'], ['code geass', 'Code Geass: Hangyaku no Lelouch'],
  ['vinland saga', 'Vinland Saga'], ['vinland', 'Vinland Saga'], ['made in abyss', 'Made in Abyss'],
  ['bocchi the rock', 'BOCCHI THE ROCK!'], ['bocchi', 'BOCCHI THE ROCK!'], ['oshi no ko', '[Oshi no Ko]'],
  ['dr stone', 'Dr. STONE'], ['haikyuu', 'Haikyuu!!'], ['haikyu', 'Haikyuu!!'], ['blue lock', 'BLUE LOCK'],
  ['mob psycho', 'Mob Psycho 100'], ['mob psycho 100', 'Mob Psycho 100'], ['cowboy bebop', 'Cowboy Bebop'],
  ['spirited away', 'Sen to Chihiro no Kamikakushi'], ['evangelion', 'Shin Seiki Evangelion'],
  ['neon genesis evangelion', 'Shin Seiki Evangelion'], ['re zero', 'Re:Zero kara Hajimeru Isekai Seikatsu'],
  ['rezero', 'Re:Zero kara Hajimeru Isekai Seikatsu'], ['konosuba', 'Kono Subarashii Sekai ni Shukufuku wo!'],
  ['solo leveling', 'Ore dake Level Up na Ken'], ['dandadan', 'Dandadan'], ['dan da dan', 'Dandadan'],
  ['kaiju no 8', 'Kaijuu 8-gou'], ['kaiju 8', 'Kaijuu 8-gou'], ['tokyo ghoul', 'Tokyo Ghoul'],
  ['tokyo revengers', 'Tokyo Revengers'], ['sao', 'Sword Art Online'], ['sword art online', 'Sword Art Online'],
  ['violet evergarden', 'Violet Evergarden'], ['erased', 'Boku dake ga Inai Machi'], ['toradora', 'Toradora!'],
  ['clannad', 'CLANNAD'], ['gintama', 'Gintama'], ['black clover', 'Black Clover'], ['bleach', 'BLEACH'],
  ['jojo', 'JoJo no Kimyou na Bouken (TV)'], ['jojos bizarre adventure', 'JoJo no Kimyou na Bouken (TV)'],
  ['promised neverland', 'Yakusoku no Neverland'], ['the promised neverland', 'Yakusoku no Neverland'],
  ['assassination classroom', 'Ansatsu Kyoushitsu'], ['your lie in april', 'Shigatsu wa Kimi no Uso'],
  ['dragon ball', 'Dragon Ball'], ['castlevania', 'Akumajo Dracula'],
  ['avatar', 'Avatar the Last Airbender'], ['atla', 'Avatar the Last Airbender'], ['relife', 'Riraifu'],
  ['invincible', 'Invincible'],   ['mushoku tensei', 'Mushoku Tensei: Isekai Ittara Honki Dasu'], ['mushoku', 'Mushoku Tensei: Isekai Ittara Honki Dasu'],
  ['86', '86: Eighty Six'], ['eighty six', '86: Eighty Six'], ['apothecary diaries', 'Kusuriya no Hitorigoto'],
  ['kusuriya', 'Kusuriya no Hitorigoto'], ['the apothecary diaries', 'Kusuriya no Hitorigoto'],
];
if (!isV1) {
  curatedSpec.push(
    ['dbz', 'Dragon Ball'], ['dragon ball z', 'Dragon Ball'], ['cyberpunk edgerunners', 'Cyberpunk: Edgerunners'],
    ['edgerunners', 'Cyberpunk: Edgerunners'], ['frieren season 2', 'Sousou no Frieren'],
    ['jjk shibuya incident', 'Jujutsu Kaisen'], ['demon slayer entertainment district', 'Kimetsu no Yaiba'],
  );
}
const titleIdx = new Map();
for (const s of shows) {
  for (const t of [s.titleRomaji, s.titleEnglish]) {
    if (!t) continue;
    const prev = titleIdx.get(t);
    if (!prev || byId.get(prev).popularity < s.popularity) titleIdx.set(t, s.id);
  }
}
const curated = [];
for (const [q, t] of curatedSpec) {
  const id = titleIdx.get(t);
  if (!id) console.warn(`! curated title not found: ${t}`);
  else curated.push(['curated', q, id]);
}

// Chat chatter that should never count as a vote.
const negatives = [
  'lol', 'lmao', 'W', 'L', 'gg', 'pog', 'poggers', 'KEKW', 'hi chat', 'hello', 'what', 'first', 'nice',
  'yes', 'no', 'ok', 'hahaha', 'this is so good', 'what are we voting for', 'how do i vote', 'that one',
  'the first one', 'idk', 'any', 'none of them', 'my favorite', 'good stream', 'love you', 'gn chat',
  'is this live', 'monkaS', 'Kappa', 'LUL', 'OMEGALUL', 'Sadge', 'copium', 'based', 'cringe', 'true',
  'facts', 'real', 'same', 'agree', 'nah', 'wait what', 'bruh', 'xd', 'xdd', 'brb', 'can we do a re vote',
  'when is the next stream', 'mods?', 'ty', 'thanks', 'sheesh', 'let him cook', 'skill issue',
  'chat is this real', 'goated', 'mid', 'peak', 'peak fiction', 'absolute cinema', 'hype', 'banger',
  'i was here', 'clip it', 'who won last time', 'whats the poll', 'anime', 'manga', 'the movie', 'season 2',
  'please', 'vote', '!vote', 'ExampleChannel', 'hello from brazil', 'hola', 'bonjour', '???', '...', '😂😂😂',
  'any shonen', 'something romance', 'not isekai please', 'random', 'idc', 'up to you', 'surprise us',
];

// Held-out chatter written AFTER tuning – never used to adjust the matcher.
const heldOut = [
  'yo whats good everyone', 'just got here what did i miss', 'this guy is cracked', 'no way bro',
  'can you play some music', 'hydrate', 'chat be nice', 'the audio is low', 'pause the stream',
  'what game is this', 'i am hungry', 'catJAM', 'PogU', 'peepoHappy', 'widepeepoHappy', 'Clap',
  'EZ Clap', 'nice one', 'top 3 for sure', 'whoever wins i am happy', 'mods ban him', 'hey streamer',
  'thats crazy', 'how long is the stream', 'greetings from germany', 'goodnight everyone',
  'i voted already', 'did my vote count', 'i love this community', 'you are the best', 'happy birthday',
  'big fan', 'lets gooo', 'one more', 'again again', 'next one', 'play it back', 'too loud',
  'who is winning', 'results when', 'close race', 'its rigged', 'recount', 'democracy',
  'banger choice', 'ratio', 'sus', 'among us', 'skibidi', 'npc', 'touch grass', 'gyat',
  'ohio', 'rizz', 'aura', 'cooked', 'its over', 'we are so back', 'what a time to be alive',
];
const heldOutCheck = (fn) => heldOut.filter((q) => { const g = fn(q); return g !== -1 && g != null; });


export { shows, sequels, byId, generated, curated, negatives, heldOut, legacy, isV1, romajiQueries };
