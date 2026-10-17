// Optional local AI for matching. Everything is free and runs on this machine:
// the app downloads open models itself (resumable, multi-connection), then
// loads them from disk. Nothing needs an account or key.

import { EventEmitter } from 'node:events';
import { existsSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileUrl, lfsHashes, MODEL_PACKS, packById, type ModelPack } from './ai-models.js';
import { Downloader, type DownloadState } from './downloads.js';
import { createJudge, detectHardware, type Hardware, type Judge } from './matching/llm-judge.js';
import { buildVectorIndex, createEmbedder, EMBED_MODELS, indexEntries, type Embedder, type VectorIndex } from './matching/semantic.js';
import { needsEmbedding, needsLlm, type StrategyId } from './matching/strategies.js';

export type AiPart = {
  state: 'off' | 'missing' | 'loading' | 'indexing' | 'ready' | 'error';
  progress?: number; // 0..1
  detail?: string;
};

export type AiStatus = { embed: AiPart; llm: AiPart };

export type PackView = ModelPack & {
  installed: boolean;
  bytesOnDisk: number;
  download: DownloadState | null;
};

type Source = {
  shows: () => { id: number; titleRomaji: string; titleEnglish: string | null; synonyms: string[] }[];
  sequels: () => { title: string; rootId: number }[];
  catalogKey: () => string;
};

export class LocalAi extends EventEmitter<{ status: [AiStatus]; packs: [PackView[]] }> {
  status: AiStatus = { embed: { state: 'off' }, llm: { state: 'off' } };
  embedder: Embedder | null = null;
  index: VectorIndex | null = null;
  judge: Judge | null = null;
  readonly downloads = new Downloader();
  private hardware: Promise<Hardware> | null = null;
  private loading: Promise<void> | null = null;
  private loadedFor = '';
  private modelsDir: string;

  constructor(
    private dir: string,
    private src: Source
  ) {
    super();
    this.modelsDir = path.join(dir, 'models');
    let last = 0;
    this.downloads.on('update', (s) => {
      // progress is chatty – a few UI pushes a second is plenty
      if (s.state === 'downloading' && Date.now() - last < 250) return;
      last = Date.now();
      this.emit('packs', this.packs());
    });
  }

  // ------------------------------------------------------------ catalog

  private filePath(p: ModelPack, f: { path: string }) {
    // transformers.js looks for <root>/<repo>/<file>; GGUFs go next to them
    return path.join(this.modelsDir, p.repo, f.path);
  }

  packs(): PackView[] {
    return MODEL_PACKS.map((p) => {
      let bytes = 0;
      let installed = true;
      for (const f of p.files) {
        const fp = this.filePath(p, f);
        if (existsSync(fp)) bytes += statSync(fp).size;
        else installed = false;
      }
      const dls = p.files.map((f) => this.downloads.get(`${p.id}:${f.path}`)).filter(Boolean) as DownloadState[];
      const total = p.files.reduce((n, f) => n + f.size, 0);
      const active = dls.find((d) => d.state !== 'done');
      const download: DownloadState | null = dls.length
        ? {
            id: p.id,
            label: p.name,
            dest: '',
            state: active?.state ?? 'done',
            total,
            received: p.files.reduce((n, f) => {
              const d = this.downloads.get(`${p.id}:${f.path}`);
              return n + (d ? d.received : existsSync(this.filePath(p, f)) ? f.size : 0);
            }, 0),
            speed: dls.reduce((n, d) => n + (d.state === 'downloading' ? d.speed : 0), 0),
            etaSec: null,
            connections: dls.reduce((n, d) => n + d.connections, 0),
            error: dls.find((d) => d.error)?.error,
          }
        : null;
      if (download && download.speed > 1) download.etaSec = Math.round((download.total - download.received) / download.speed);
      return { ...p, installed, bytesOnDisk: bytes, download };
    });
  }

  hardwareInfo() {
    this.hardware ??= detectHardware().catch(() => ({ gpu: false as const, devices: [], vramTotal: 0, vramFree: 0 }));
    return this.hardware;
  }

  /** Download every file of a pack (resumes if partly there). */
  async download(id: string) {
    const p = packById(id);
    if (!p) throw new Error(`unknown model ${id}`);
    const hashes = await lfsHashes(p);
    await Promise.all(
      p.files.map((f) =>
        this.downloads.start({
          id: `${p.id}:${f.path}`,
          url: fileUrl(p, f),
          dest: this.filePath(p, f),
          label: p.name,
          size: f.size,
          sha256: hashes.get(f.path),
        })
      )
    );
    this.emit('packs', this.packs());
  }

  pause(id: string) {
    const p = packById(id);
    p?.files.forEach((f) => this.downloads.pause(`${p.id}:${f.path}`));
  }

  async cancel(id: string) {
    const p = packById(id);
    if (p) await Promise.all(p.files.map((f) => this.downloads.cancel(`${p.id}:${f.path}`)));
    this.emit('packs', this.packs());
  }

  async remove(id: string) {
    const p = packById(id);
    if (!p) return;
    if (this.judge && this.judge.label === p.name) {
      await this.judge.dispose();
      this.judge = null;
      this.loadedFor = '';
    }
    if (this.embedder?.model.repo === p.repo) {
      this.embedder = null;
      this.index = null;
      this.loadedFor = '';
    }
    await this.cancel(id);
    for (const f of p.files) rmSync(this.filePath(p, f), { force: true });
    this.emit('packs', this.packs());
  }

  // ------------------------------------------------------------ loading

  private set(part: keyof AiStatus, p: AiPart) {
    this.status = { ...this.status, [part]: p };
    this.emit('status', this.status);
  }

  /** Load (not download) whatever `strategy` needs. Missing models → 'missing'. */
  ensure(strategy: StrategyId, embedId: string, llmId: string): Promise<void> {
    const key = `${strategy}|${embedId}|${llmId}|${this.src.catalogKey()}`;
    if (this.loadedFor === key && !this.loading) return Promise.resolve();
    const run = (this.loading ?? Promise.resolve()).then(() => this.load(strategy, embedId, llmId, key));
    this.loading = run.finally(() => {
      if (this.loading === run) this.loading = null;
    });
    return run;
  }

  private installed(id: string) {
    return this.packs().find((p) => p.id === id)?.installed ?? false;
  }

  private async load(strategy: StrategyId, embedId: string, llmId: string, key: string) {
    const needsEmbed = needsEmbedding(strategy);
    const wantsLlm = needsLlm(strategy);
    let complete = true;

    try {
      if (!needsEmbed) {
        this.set('embed', { state: 'off' });
      } else if (!this.installed(embedId)) {
        complete = false;
        this.set('embed', { state: 'missing', detail: packById(embedId)?.name });
      } else {
        const model = EMBED_MODELS[embedId];
        if (this.embedder?.model.id !== model.id) {
          this.index = null;
          this.set('embed', { state: 'loading', detail: model.label });
          this.embedder = await createEmbedder(model, this.modelsDir, undefined, true);
        }
        const entries = indexEntries(this.src.shows(), this.src.sequels());
        this.set('embed', { state: 'indexing', progress: 0, detail: `${entries.length.toLocaleString()} titles` });
        this.index = await buildVectorIndex(
          this.embedder,
          entries,
          path.join(this.dir, 'index', `${model.id}-${this.src.catalogKey()}.f32`),
          (done, total) => this.set('embed', { state: 'indexing', progress: done / total, detail: `${total.toLocaleString()} titles` })
        );
        this.set('embed', { state: 'ready', detail: model.label });
      }
    } catch (err) {
      complete = false;
      this.set('embed', { state: 'error', detail: err instanceof Error ? err.message : String(err) });
    }

    try {
      const pack = packById(llmId);
      if (!wantsLlm || !pack) {
        await this.judge?.dispose();
        this.judge = null;
        this.set('llm', { state: 'off' });
      } else if (!this.installed(llmId)) {
        complete = false;
        this.set('llm', { state: 'missing', detail: pack.name });
      } else if (this.judge?.label !== pack.name) {
        await this.judge?.dispose();
        this.judge = null;
        this.set('llm', { state: 'loading', detail: pack.name });
        this.judge = await createJudge(this.filePath(pack, pack.files[0]), pack.name);
        const where = this.judge.gpu ? `GPU (${this.judge.gpu})` : 'CPU';
        this.set('llm', { state: 'ready', detail: `${pack.name} on ${where}` });
      }
    } catch (err) {
      complete = false;
      this.set('llm', { state: 'error', detail: err instanceof Error ? err.message : String(err) });
    }
    if (complete) this.loadedFor = key;
  }
}

/** Biggest model that fits the GPU fully; 1.5B on CPU. */
export function recommendLlm(hw: Hardware): string {
  const gb = hw.vramFree / 1e9;
  if (hw.gpu && gb >= 6.5) return 'qwen-7b';
  if (hw.gpu && gb >= 3.5) return 'qwen-3b';
  return 'qwen-1.5b';
}
