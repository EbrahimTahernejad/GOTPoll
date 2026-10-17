// A small open LLM running locally (llama.cpp via node-llama-cpp): free,
// offline, no account. Too slow to run on every chat line, so it only judges
// phrases the fast matchers couldn't place, choosing among their candidates –
// or saying it isn't a vote at all.

export type Hardware = {
  gpu: 'cuda' | 'vulkan' | 'metal' | false;
  devices: string[];
  vramTotal: number;
  vramFree: number;
};

let llamaPromise: Promise<any> | null = null;
/** One llama.cpp runtime per process; picks CUDA / Metal / Vulkan / CPU. */
export function getRuntime() {
  llamaPromise ??= import('node-llama-cpp').then(({ getLlama }) =>
    // never try to compile from source on a streamer's machine
    getLlama({ gpu: 'auto', build: 'never' }).catch(() => getLlama({ gpu: false, build: 'never' }))
  );
  return llamaPromise;
}

export async function detectHardware(): Promise<Hardware> {
  const llama = await getRuntime();
  const vram = llama.gpu ? await llama.getVramState() : { total: 0, free: 0 };
  const devices: string[] = llama.gpu ? await llama.getGpuDeviceNames().catch(() => []) : [];
  return { gpu: llama.gpu, devices, vramTotal: vram.total, vramFree: vram.free };
}

export type Judge = {
  label: string;
  gpu: Hardware['gpu'];
  /** index into options, or null for "not a vote / none of these" */
  pick: (message: string, options: { title: string; english: string | null; year: number | null }[]) => Promise<number | null>;
  dispose: () => Promise<void>;
};

export async function createJudge(modelPath: string, label: string): Promise<Judge> {
  const { LlamaChatSession } = await import('node-llama-cpp');
  const llama = await getRuntime();
  // gpuLayers 'auto' offloads as much as fits in VRAM – all of it on an 8 GB card for ≤7B Q4
  const loaded = await llama.loadModel({ modelPath, gpuLayers: 'auto' });
  const context = await loaded.createContext({ contextSize: 1024 });
  const sequence = context.getSequence();
  let queue: Promise<unknown> = Promise.resolve();

  const pick: Judge['pick'] = (message, options) => {
    // one judgement at a time on the shared context
    const run = queue.then(async () => {
      const session = new LlamaChatSession({
        contextSequence: sequence,
        systemPrompt: [
          'You classify live-stream chat messages during an anime poll.',
          'A vote is a message that NAMES an anime: its title, a known abbreviation (aot, jjk), a misspelling, or a translation of the title.',
          'Most messages are NOT votes: reactions, questions, emotes, sentences about the stream, food, people.',
          'Sharing one common word with a title is NOT a vote ("i am hungry" is not "Hungry to Win"; "wait what" is not "Nani ka").',
          'If unsure, answer 0. Answer with JSON only.',
          'Examples: "attack on titen" → the Attack on Titan option. "frieren s2 pls" → Frieren. "let him cook" → 0. "results when" → 0. "catJAM" → 0.',
        ].join('\n'),
      });
      const grammar = await llama.createGrammarForJsonSchema({
        type: 'object',
        properties: { choice: { type: 'integer' } },
        required: ['choice'],
      } as const);
      const list = options
        .map((o, i) => `${i + 1}. ${o.title}${o.english && o.english !== o.title ? ` (${o.english})` : ''}${o.year ? ` [${o.year}]` : ''}`)
        .join('\n');
      const answer = await session.prompt(`Message: "${message.slice(0, 200)}"\nOptions:\n${list}\n0. not a vote / none of these`, {
        grammar,
        maxTokens: 20,
        temperature: 0,
      });
      session.dispose({ disposeSequence: false });
      await sequence.clearHistory();
      const choice = Number((grammar.parse(answer) as { choice: number }).choice);
      return choice >= 1 && choice <= options.length ? choice - 1 : null;
    });
    queue = run.catch(() => {});
    return run;
  };

  return {
    label,
    gpu: llama.gpu,
    pick,
    dispose: async () => {
      await context.dispose();
      await loaded.dispose();
    },
  };
}
