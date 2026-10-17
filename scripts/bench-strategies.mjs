// Head-to-head of matcher strategies on the same queries as bench-matching,
// plus a "hard" set (paraphrases, mixed languages, heavy typos).
//
//   pnpm build:electron && node --no-warnings scripts/bench-strategies.mjs [--llm qwen-1.5b] [--embed e5,minilm]
//
// Everything is local and free: models download once into ./.models.

import path from 'node:path';
import { createJudge, detectHardware } from '../build/electron/matching/llm-judge.js';
import { packById } from '../build/electron/ai-models.js';
import { Matcher } from '../build/electron/matching/matcher.js';
import { buildVectorIndex, createEmbedder, EMBED_MODELS, indexEntries } from '../build/electron/matching/semantic.js';
import { createStrategy } from '../build/electron/matching/strategies.js';
import { byId, curated, generated, heldOut, negatives, romajiQueries, root, sequels, shows } from './bench-data.mjs';

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const MODELS_DIR = path.join(root, '.models');
const embedIds = arg('--embed', 'minilm,e5').split(',');
const llmId = arg('--llm', null);

// ------------------------------------------------------------------ hard set
const hardSpec = [
  ['attack of titans', 'Shingeki no Kyojin'], ['atack on titen', 'Shingeki no Kyojin'], ['attack on the titans', 'Shingeki no Kyojin'],
  ['the titan anime', 'Shingeki no Kyojin'], ['demon slayers', 'Kimetsu no Yaiba'], ['the demon slayer anime', 'Kimetsu no Yaiba'],
  ['jujitsu kaisen', 'Jujutsu Kaisen'], ['jujutsu kaisan', 'Jujutsu Kaisen'], ['juju kaisen', 'Jujutsu Kaisen'],
  ['one peice', 'ONE PIECE'], ['onepeice', 'ONE PIECE'], ['my hero academy', 'Boku no Hero Academia'],
  ['hero academia', 'Boku no Hero Academia'], ['full metal alchemist', 'Hagane no Renkinjutsushi: FULLMETAL ALCHEMIST'],
  ['fullmetal', 'Hagane no Renkinjutsushi: FULLMETAL ALCHEMIST'], ['death notes', 'DEATH NOTE'], ['spy family anime', 'SPY×FAMILY'],
  ['frieren beyond journeys end', 'Sousou no Frieren'], ['beyond journeys end', 'Sousou no Frieren'], ['freiren', 'Sousou no Frieren'],
  ['the apothecary', 'Kusuriya no Hitorigoto'], ['apothecary diaries anime', 'Kusuriya no Hitorigoto'], ['solo levelling', 'Ore dake Level Up na Ken'],
  ['kaiju number 8', 'Kaijuu 8-gou'], ['kaiju no. 8', 'Kaijuu 8-gou'], ['dandandan', 'Dandadan'], ['eminence in shadow', 'Kage no Jitsuryokusha ni Naritakute!'],
  ['the eminence in shadow', 'Kage no Jitsuryokusha ni Naritakute!'], ['jobless reincarnation', 'Mushoku Tensei: Isekai Ittara Honki Dasu'],
  ['that time i got reincarnated as a slime', 'Tensei shitara Slime Datta Ken'], ['tensura', 'Tensei shitara Slime Datta Ken'],
  ['reincarnated as a slime', 'Tensei shitara Slime Datta Ken'], ['konosuba gods blessing', 'Kono Subarashii Sekai ni Shukufuku wo!'],
  ['re zero starting life in another world', 'Re:Zero kara Hajimeru Isekai Seikatsu'], ['steins gate anime', 'Steins;Gate'],
  ['vinland', 'Vinland Saga'], ['vinlad saga', 'Vinland Saga'], ['chainsawman anime', 'Chainsaw Man'], ['hunter hunter', 'HUNTER×HUNTER (2011)'],
  ['mob pyscho', 'Mob Psycho 100'], ['cowboy bebob', 'Cowboy Bebop'], ['evangellion', 'Shin Seiki Evangelion'], ['neon genesis', 'Shin Seiki Evangelion'],
  ['blue lok', 'BLUE LOCK'], ['haikyu volleyball', 'Haikyuu!!'], ['the volleyball anime', 'Haikyuu!!'], ['oshi no ko idol', '[Oshi no Ko]'],
  ['bocchi rock', 'BOCCHI THE ROCK!'], ['code geas', 'Code Geass: Hangyaku no Lelouch'], ['lelouch', 'Code Geass: Hangyaku no Lelouch'],
  ['made in the abyss', 'Made in Abyss'], ['promise neverland', 'Yakusoku no Neverland'], ['tokyo goul', 'Tokyo Ghoul'],
  ['violet evergarden anime', 'Violet Evergarden'], ['your lie april', 'Shigatsu wa Kimi no Uso'], ['assasination classroom', 'Ansatsu Kyoushitsu'],
];
const titleIdx = new Map();
for (const s of shows) {
  for (const t of [s.titleRomaji, s.titleEnglish]) {
    const k = t?.toLowerCase();
    if (k && (!titleIdx.has(k) || byId.get(titleIdx.get(k)).popularity < s.popularity)) titleIdx.set(k, s.id);
  }
}
const hard = hardSpec.flatMap(([q, t]) => {
  const id = titleIdx.get(t.toLowerCase());
  return id ? [['hard', q, id]] : (console.warn(`! hard: ${t} not found`), []);
});

// ------------------------------------------------------------------ build
const matcher = new Matcher({ shows, sequels, threshold: 0.72 });
const showInfo = (id) => {
  const s = byId.get(id);
  return s && { title: s.titleRomaji, english: s.titleEnglish, year: s.startYear ?? null };
};

const setups = [{ name: 'classic', make: () => createStrategy('classic', { matcher }) }];
const entries = indexEntries(shows, sequels);
const indexes = {};
for (const id of embedIds) {
  const t = performance.now();
  const embedder = await createEmbedder(EMBED_MODELS[id], MODELS_DIR);
  const index = await buildVectorIndex(embedder, entries, path.join(MODELS_DIR, `index-${id}-${entries.length}.f32`), (d, n) => {
    if (d % 4096 < 64) process.stdout.write(`\r  indexing ${id} ${d}/${n}`);
  });
  console.log(`\n  ${id}: ${entries.length} titles indexed in ${((performance.now() - t) / 1000).toFixed(1)}s`);
  indexes[id] = { embedder, index };
}

// --------- tune vector thresholds on the generated set (not the hard set)
const tuneSet = [...generated].filter((_, i) => i % 3 === 0);
const tuned = {};
for (const id of embedIds) {
  const { embedder, index } = indexes[id];
  const qs = [...tuneSet.map(([, q]) => q), ...negatives];
  // search once per query, then sweep thresholds over the cached top-2
  const tops = [];
  for (const q of qs) tops.push(index.search(await embedder.embed([q], 'query'), 2));
  let best = null;
  for (const threshold of [0.7, 0.75, 0.8, 0.85, 0.9]) {
    for (const margin of [0.0, 0.02, 0.05]) {
      let ok = 0, wrong = 0, fp = 0;
      qs.forEach((q, i) => {
        const [a, b] = tops[i];
        const accept = a && a.score >= threshold && (!b || a.score - b.score >= margin) && !matcher.isChatter(q);
        if (i < tuneSet.length) {
          if (accept && a.showId === tuneSet[i][2]) ok++;
          else if (accept) wrong++;
        } else if (accept) fp++;
      });
      // utility: a wrong vote is 4× as bad as a miss, a counted chat line 4× too
      const u = ok - 4 * wrong - 4 * fp * (tuneSet.length / negatives.length) * 0.1;
      if (!best || u > best.u) best = { threshold, margin, u, ok, wrong, fp };
    }
  }
  tuned[id] = best;
  console.log(`  ${id}: vector threshold ${best.threshold}, margin ${best.margin} (tune: ${best.ok} ok / ${best.wrong} wrong / ${best.fp} fp)`);
  const fb = { threshold: Math.min(0.95, best.threshold + 0.05), margin: Math.max(0.03, best.margin) };
  setups.push(
    { name: `vector (${id})`, make: () => createStrategy('vector', { matcher, ...indexes[id], vector: best }) },
    { name: `hybrid (${id})`, make: () => createStrategy('hybrid', { matcher, ...indexes[id], fallback: fb }) }
  );
  indexes[id].fallback = fb;
}

if (llmId) {
  const pack = packById(llmId);
  const modelPath = path.join(MODELS_DIR, pack.files[0].path);
  const hw = await detectHardware();
  console.log(`  hardware: ${hw.gpu || 'CPU only'} ${hw.devices.join(', ')} – VRAM ${(hw.vramTotal / 1e9).toFixed(1)} GB`);
  const t = performance.now();
  const judge = await createJudge(modelPath, pack.name);
  console.log(`  ${llmId} loaded in ${((performance.now() - t) / 1000).toFixed(1)}s`);
  const id = arg('--judge-embed', embedIds.includes('minilm') ? 'minilm' : embedIds[0]);
  for (const kind of ['hybrid-llm', 'precise-hybrid-llm', 'precise-llm']) {
    setups.push({
      name: `${kind} (${id}+${llmId})`,
      make: () => createStrategy(kind, { matcher, ...indexes[id], fallback: indexes[id].fallback, judge, showInfo }),
    });
  }
}

const only = arg('--only', null);
if (only) {
  const keep = only.split(',');
  setups.splice(0, setups.length, ...setups.filter((s) => keep.some((k) => s.name.startsWith(k))));
}

// ------------------------------------------------------------------ run
const groups = {
  main: [...generated, ...curated],
  romaji: generated.filter(([, q]) => romajiQueries.has(q)),
  hard,
};
const rows = [];
for (const { name, make } of setups) {
  const s = make();
  const r = { name, main: { ok: 0, wrong: 0, n: 0 }, romaji: { ok: 0, wrong: 0, n: 0 }, hard: { ok: 0, wrong: 0, n: 0 }, fp: 0, held: 0, ms: 0 };
  const memo = new Map(); // romaji ⊂ main – don't ask the LLM twice
  const t = performance.now();
  for (const [g, list] of Object.entries(groups)) {
    for (const [, q, id] of list) {
      if (!memo.has(q)) memo.set(q, await s.match(q));
      const got = memo.get(q);
      r[g].n++;
      if (got?.showId === id) r[g].ok++;
      else if (got) r[g].wrong++;
    }
  }
  for (const q of negatives) if (await s.match(q)) r.fp++;
  for (const q of heldOut) if (await s.match(q)) r.held++;
  r.ms = (performance.now() - t) / (memo.size + negatives.length + heldOut.length);
  rows.push(r);
  process.stdout.write(`\r  ran ${name}`.padEnd(60));
}

const pct = (a, n) => `${((100 * a) / n).toFixed(1)}%`;
console.log(`\n\n${'strategy'.padEnd(30)}${'main ok'.padStart(9)}${'wrong'.padStart(8)}${'romaji'.padStart(9)}${'hard ok'.padStart(9)}${'wrong'.padStart(8)}${'chatter'.padStart(9)}${'held-out'.padStart(10)}${'ms/msg'.padStart(8)}`);
for (const r of rows) {
  console.log(
    r.name.padEnd(30) +
      pct(r.main.ok, r.main.n).padStart(9) +
      pct(r.main.wrong, r.main.n).padStart(8) +
      pct(r.romaji.ok, r.romaji.n).padStart(9) +
      pct(r.hard.ok, r.hard.n).padStart(9) +
      pct(r.hard.wrong, r.hard.n).padStart(8) +
      `${r.fp}/${negatives.length}`.padStart(9) +
      `${r.held}/${heldOut.length}`.padStart(10) +
      r.ms.toFixed(2).padStart(8)
  );
}
console.log(`\nmain = ${groups.main.length} generated+curated, romaji = ${groups.romaji.length} of those built from romaji titles, hard = ${hard.length}, chatter = tuning negatives, held-out = never tuned on`);
process.exit(0);
