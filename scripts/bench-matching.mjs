// Benchmark: legacy SQL/LIKE matcher vs the classic TF-IDF + Jaro-Winkler matcher.
//   pnpm bench:matching   (see scripts/bench-data.mjs for how queries are built)
import { Matcher } from '../build/electron/matching/matcher.js';
import { shows, sequels, byId, generated, curated, negatives, heldOut, legacy } from './bench-data.mjs';

const heldOutCheck = (fn) => heldOut.filter((q) => { const g = fn(q); return g !== -1 && g != null; });

// ---------------------------------------------------------------- run
const matcher = new Matcher({ shows, sequels, threshold: 0.72 });
const heldOutHits = (m) => heldOutCheck((q) => m.match(q)?.showId ?? -1).map((q) => `${q} → ${byId.get(m.match(q).showId)?.titleRomaji}`);

function run(name, fn) {
  const t0 = performance.now();
  const groups = new Map();
  for (const [kind, q, id] of [...generated, ...curated]) {
    const g = groups.get(kind) ?? { ok: 0, wrong: 0, none: 0 };
    const got = fn(q);
    if (got === id) g.ok++;
    else if (got === -1 || got == null) g.none++;
    else g.wrong++;
    groups.set(kind, g);
  }
  let fp = 0;
  const fpExamples = [];
  for (const q of negatives) {
    const got = fn(q);
    if (got !== -1 && got != null) {
      fp++;
      if (fpExamples.length < 6) fpExamples.push(`${q} → ${byId.get(got)?.titleRomaji}`);
    }
  }
  const ms = performance.now() - t0;
  return { name, groups, fp, fpExamples, ms, fn };
}

if (process.argv.includes('--debug')) {
  const cat = process.argv[process.argv.indexOf('--debug') + 1];
  const m = new Matcher({ shows, sequels, threshold: 0.72 });
  let n = 0;
  for (const [kind, q, id] of [...generated, ...curated]) {
    if (kind !== cat) continue;
    const got = m.match(q);
    if (got?.showId === id) continue;
    const c = m.candidates(q, 2).map((c) => `${byId.get(c.showId)?.titleRomaji}=${c.score.toFixed(3)}`);
    console.log(`${q.slice(0, 40).padEnd(40)} want ${byId.get(id)?.titleRomaji?.slice(0, 30)} | got ${got ? byId.get(got.showId)?.titleRomaji?.slice(0, 30) : '∅'} | ${c.join(', ')}`);
    if (++n > 14) break;
  }
  console.log('held-out hits:', heldOutHits(m));
  for (const q of negatives) {
    const g = m.match(q);
    if (g) console.log(`FP: ${q} → ${byId.get(g.showId)?.titleRomaji} (${g.stage} ${g.score.toFixed(3)})`);
  }
  process.exit(0);
}

if (process.argv.includes('--sweep')) {
  for (const threshold of [0.7, 0.72, 0.74, 0.76, 0.78]) {
    for (const margin of [0.02, 0.03, 0.05]) {
      const m = new Matcher({ shows, sequels, threshold, margin });
      const r = run('', (q) => m.match(q)?.showId ?? -1);
      let ok = 0, wrong = 0, tot = 0;
      for (const g of r.groups.values()) { ok += g.ok; wrong += g.wrong; tot += g.ok + g.wrong + g.none; }
      console.log(`threshold ${threshold} margin ${margin}: ok ${(100 * ok / tot).toFixed(1)}%  wrong ${(100 * wrong / tot).toFixed(1)}%  fp ${r.fp}/${negatives.length}`);
    }
  }
  process.exit(0);
}

const results = [
  ...(process.argv.includes('--skip-legacy') || !legacy ? [] : [run('legacy (got-poll)', legacy)]),
  run('new (tf-idf + jw)', (q) => matcher.match(q)?.showId ?? -1),
];

const kinds = [...results[0].groups.keys()];
const pct = (n, d) => `${((100 * n) / d).toFixed(1)}%`.padStart(6);
console.log(`\nshows indexed: ${shows.length}   queries: ${generated.length + curated.length}   negatives: ${negatives.length}\n`);
console.log('category'.padEnd(16) + results.map((r) => r.name.padStart(24)).join(''));
for (const k of kinds) {
  const line = results.map((r) => {
    const g = r.groups.get(k);
    const tot = g.ok + g.wrong + g.none;
    return `${pct(g.ok, tot)} ok ${pct(g.wrong, tot)} bad`.padStart(24);
  });
  console.log(k.padEnd(16) + line.join(''));
}
const totals = results.map((r) => {
  let ok = 0, wrong = 0, none = 0;
  for (const g of r.groups.values()) { ok += g.ok; wrong += g.wrong; none += g.none; }
  return { ok, wrong, none, tot: ok + wrong + none };
});
console.log('TOTAL'.padEnd(16) + totals.map((t) => `${pct(t.ok, t.tot)} ok ${pct(t.wrong, t.tot)} bad`.padStart(24)).join(''));
console.log('false positives'.padEnd(16) + results.map((r) => `${r.fp}/${negatives.length}`.padStart(24)).join(''));
console.log('held-out FP'.padEnd(16) + results.map((r) => `${heldOutCheck(r.fn).length}/${heldOut.length}`.padStart(24)).join(''));
console.log('time'.padEnd(16) + results.map((r) => `${r.ms.toFixed(0)}ms`.padStart(24)).join(''));
for (const r of results) if (r.fpExamples.length) console.log(`\n${r.name} false positives: ${r.fpExamples.join(' | ')}`);

if (process.argv.includes('--misses')) {
  console.log('\nnew matcher misses (curated):');
  for (const [, q, id] of curated) {
    const got = matcher.match(q);
    if (got?.showId !== id) {
      const c = matcher.candidates(q, 3).map((c) => `${byId.get(c.showId)?.titleRomaji}=${c.score.toFixed(3)}`);
      console.log(`  ${q.padEnd(32)} want ${byId.get(id)?.titleRomaji} | got ${got ? byId.get(got.showId)?.titleRomaji : '∅'} | ${c.join(', ')}`);
    }
  }
}
