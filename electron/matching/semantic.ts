// Local sentence embeddings (free, offline after a one-time model download).
// Runs a small ONNX model through transformers.js – no API, no key.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { canonical, normalize } from './normalize.js';

export type EmbedModel = {
  id: string;
  label: string;
  /** HF repo with ONNX weights */
  repo: string;
  sizeMb: number;
  /** e5-style models want role prefixes */
  queryPrefix?: string;
  passagePrefix?: string;
};

export const EMBED_MODELS: Record<string, EmbedModel> = {
  minilm: { id: 'minilm', label: 'MiniLM-L6 (English, fast)', repo: 'Xenova/all-MiniLM-L6-v2', sizeMb: 23 },
  e5: {
    id: 'e5',
    label: 'multilingual-e5-small',
    repo: 'Xenova/multilingual-e5-small',
    sizeMb: 118,
    queryPrefix: 'query: ',
    passagePrefix: 'passage: ',
  },
};

export type Embedder = {
  model: EmbedModel;
  dims: number;
  embed: (texts: string[], role: 'query' | 'passage') => Promise<Float32Array>;
};

/**
 * `modelsRoot/<repo>/…` must already hold the files when `offline` (the app
 * downloads them itself); otherwise transformers.js fetches into the cache.
 */
export async function createEmbedder(
  model: EmbedModel,
  modelsRoot: string,
  onProgress?: (p: { file: string; loaded: number; total: number }) => void,
  offline = false
): Promise<Embedder> {
  const { pipeline, env } = await import('@huggingface/transformers');
  mkdirSync(modelsRoot, { recursive: true });
  env.cacheDir = modelsRoot;
  env.localModelPath = modelsRoot;
  env.allowLocalModels = true;
  env.allowRemoteModels = !offline;
  const extractor = await pipeline('feature-extraction', model.repo, {
    dtype: 'q8',
    progress_callback: (p: any) => {
      if (p.status === 'progress' && onProgress) onProgress({ file: p.file, loaded: p.loaded, total: p.total });
    },
  });
  let dims = 0;
  const embed = async (texts: string[], role: 'query' | 'passage') => {
    const prefix = (role === 'query' ? model.queryPrefix : model.passagePrefix) ?? '';
    const out = await extractor(
      texts.map((t) => prefix + t),
      { pooling: 'mean', normalize: true }
    );
    dims = out.dims[1];
    return out.data as Float32Array;
  };
  await embed(['warm up'], 'query');
  return { model, embed, get dims() { return dims; } };
}

type Entry = { showId: number; text: string };

/** Brute-force cosine search over unit vectors – ~30k × 384 floats is a few ms. */
export class VectorIndex {
  constructor(
    readonly entries: Entry[],
    readonly vectors: Float32Array,
    readonly dims: number
  ) {}

  search(q: Float32Array, k = 8): { showId: number; score: number; text: string }[] {
    const n = this.entries.length;
    const d = this.dims;
    const best = new Map<number, { score: number; text: string }>();
    for (let i = 0; i < n; i++) {
      let dot = 0;
      const off = i * d;
      for (let j = 0; j < d; j++) dot += this.vectors[off + j] * q[j];
      const e = this.entries[i];
      const prev = best.get(e.showId);
      if (!prev || dot > prev.score) best.set(e.showId, { score: dot, text: e.text });
    }
    return [...best.entries()]
      .map(([showId, v]) => ({ showId, ...v }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}

/** What we embed per show: titles + a few Latin-script synonyms + sequel titles. */
export function indexEntries(
  shows: { id: number; titleRomaji: string; titleEnglish: string | null; synonyms: string[] }[],
  sequels: { title: string; rootId: number }[] = []
): Entry[] {
  const out: Entry[] = [];
  const seen = new Set<string>();
  const add = (showId: number, raw: string | null | undefined) => {
    if (!raw) return;
    const text = normalize(raw);
    if (text.length < 2 || /[^\p{Script=Latin}\p{N}\s]/u.test(text)) return;
    const key = `${showId}|${canonical(text)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ showId, text });
  };
  for (const s of shows) {
    add(s.id, s.titleRomaji);
    add(s.id, s.titleEnglish);
    s.synonyms.slice(0, 4).forEach((x) => add(s.id, x));
  }
  for (const q of sequels) add(q.rootId, q.title);
  return out;
}

/** Build (or load from cache) the vector index for a catalog. */
export async function buildVectorIndex(
  embedder: Embedder,
  entries: Entry[],
  cacheFile: string | null,
  onProgress?: (done: number, total: number) => void
): Promise<VectorIndex> {
  const sig = `${embedder.model.id}:${entries.length}:${entries.slice(0, 50).map((e) => e.text).join('|').length}`;
  if (cacheFile && existsSync(cacheFile) && existsSync(`${cacheFile}.json`)) {
    try {
      const meta = JSON.parse(readFileSync(`${cacheFile}.json`, 'utf8'));
      if (meta.sig === sig) {
        const buf = readFileSync(cacheFile);
        return new VectorIndex(entries, new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4), meta.dims);
      }
    } catch {
      // rebuild
    }
  }
  const BATCH = 64;
  let vectors: Float32Array | null = null;
  for (let i = 0; i < entries.length; i += BATCH) {
    const chunk = await embedder.embed(entries.slice(i, i + BATCH).map((e) => e.text), 'passage');
    if (!vectors) vectors = new Float32Array(entries.length * embedder.dims);
    vectors.set(chunk, i * embedder.dims);
    onProgress?.(Math.min(entries.length, i + BATCH), entries.length);
    // keep the event loop breathing while indexing in the app
    await new Promise((r) => setImmediate(r));
  }
  const index = new VectorIndex(entries, vectors ?? new Float32Array(), embedder.dims);
  if (cacheFile) {
    mkdirSync(path.dirname(cacheFile), { recursive: true });
    writeFileSync(cacheFile, Buffer.from(index.vectors.buffer));
    writeFileSync(`${cacheFile}.json`, JSON.stringify({ sig, dims: embedder.dims }));
  }
  return index;
}
