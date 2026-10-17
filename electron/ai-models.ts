// Free, open models the app can download and run locally. Sizes are what
// actually lands on disk. sha256 comes from Hugging Face's LFS metadata at
// download time when reachable.

export type ModelFile = { path: string; size: number };

export type ModelPack = {
  id: string;
  kind: 'embed' | 'llm';
  name: string;
  blurb: string;
  repo: string;
  files: ModelFile[];
  /** llm only: memory needed to run fully on a GPU */
  vramGb?: number;
  /** llm only: rough GPU speed per judgement on an RTX 3070 class card */
  speed?: string;
};

const HF = 'https://huggingface.co';

export const MODEL_PACKS: ModelPack[] = [
  {
    id: 'e5',
    kind: 'embed',
    name: 'multilingual-e5-small',
    blurb: 'Understands 100 languages and paraphrases. Most precise.',
    repo: 'Xenova/multilingual-e5-small',
    files: [
      { path: 'config.json', size: 658 },
      { path: 'tokenizer.json', size: 17082730 },
      { path: 'tokenizer_config.json', size: 443 },
      { path: 'onnx/model_quantized.onnx', size: 118308185 },
    ],
  },
  {
    id: 'minilm',
    kind: 'embed',
    name: 'all-MiniLM-L6-v2',
    blurb: 'English only, tiny and fast.',
    repo: 'Xenova/all-MiniLM-L6-v2',
    files: [
      { path: 'config.json', size: 650 },
      { path: 'tokenizer.json', size: 711661 },
      { path: 'tokenizer_config.json', size: 366 },
      { path: 'onnx/model_quantized.onnx', size: 22972370 },
    ],
  },
  {
    id: 'qwen-1.5b',
    kind: 'llm',
    name: 'Qwen2.5 1.5B Instruct',
    blurb: 'Runs on any machine, CPU is fine.',
    repo: 'Qwen/Qwen2.5-1.5B-Instruct-GGUF',
    files: [{ path: 'qwen2.5-1.5b-instruct-q4_k_m.gguf', size: 1117320736 }],
    vramGb: 1.5,
    speed: '~40 ms',
  },
  {
    id: 'qwen-3b',
    kind: 'llm',
    name: 'Qwen2.5 3B Instruct',
    blurb: 'Good balance. Comfortable on a 6–8 GB GPU.',
    repo: 'Qwen/Qwen2.5-3B-Instruct-GGUF',
    files: [{ path: 'qwen2.5-3b-instruct-q4_k_m.gguf', size: 2104932768 }],
    vramGb: 3,
    speed: '~70 ms',
  },
  {
    id: 'qwen-7b',
    kind: 'llm',
    name: 'Qwen2.5 7B Instruct',
    blurb: 'Smartest. Fits fully on an 8 GB card like the RTX 3070.',
    repo: 'bartowski/Qwen2.5-7B-Instruct-GGUF',
    files: [{ path: 'Qwen2.5-7B-Instruct-Q4_K_M.gguf', size: 4683074240 }],
    vramGb: 6,
    speed: '~150 ms',
  },
];

export const packById = (id: string) => MODEL_PACKS.find((p) => p.id === id);

export const fileUrl = (p: ModelPack, f: ModelFile) => `${HF}/${p.repo}/resolve/main/${f.path}`;

/** sha256 per file from HF's LFS metadata (best effort – skipped offline). */
export async function lfsHashes(p: ModelPack): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const res = await fetch(`${HF}/api/models/${p.repo}/tree/main?recursive=true`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return out;
    const list = (await res.json()) as { path: string; lfs?: { oid: string } }[];
    for (const e of list) if (e.lfs?.oid) out.set(e.path, e.lfs.oid);
  } catch {
    // offline or API change – size check still guards the file
  }
  return out;
}
