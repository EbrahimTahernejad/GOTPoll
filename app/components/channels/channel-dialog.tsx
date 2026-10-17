import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, CircleAlert, Loader2, Radio, Repeat, Search, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Switch } from '~/components/ui/switch';
import { cn } from '~/lib/utils';
import { PLATFORM_ORDER, PLATFORMS, PlatformIcon } from './platforms';

type Draft = { platform: ChatPlatform; input: string; label: string; enabled: boolean };
type Parsed = Awaited<ReturnType<Window['GOTPoll']['channels']['describe']>>;

/** Add or edit a chat channel: platform → link → (optional) name → test. */
export default function ChannelDialog({
  open,
  initial,
  presetPlatform,
  existing,
  onClose,
  onSave,
}: {
  open: boolean;
  initial: ChannelConfig | null;
  presetPlatform?: ChatPlatform;
  existing: ChannelConfig[];
  onClose: () => void;
  onSave: (c: ChannelConfig) => void;
}) {
  const [draft, setDraft] = useState<Draft>({ platform: 'twitch', input: '', label: '', enabled: true });
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [test, setTest] = useState<ChannelTestResult | 'running' | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(
      initial
        ? { platform: initial.platform, input: initial.target, label: initial.label, enabled: initial.enabled }
        : { platform: presetPlatform ?? 'twitch', input: '', label: '', enabled: true }
    );
    setTest(null);
  }, [open, initial, presetPlatform]);

  // live validation as you type
  useEffect(() => {
    if (!draft.input.trim()) {
      setParsed(null);
      return;
    }
    let alive = true;
    window.GOTPoll.channels.describe(draft.platform, draft.input).then((p) => alive && setParsed(p));
    setTest(null);
    return () => {
      alive = false;
    };
  }, [draft.platform, draft.input]);

  const duplicate =
    parsed?.ok &&
    existing.some((c) => c.id !== initial?.id && c.platform === draft.platform && c.target.toLowerCase() === parsed.target.toLowerCase());
  const canSave = !!parsed?.ok && !duplicate;
  const meta = PLATFORMS[draft.platform];

  const runTest = async () => {
    if (!parsed?.ok) return;
    setTest('running');
    setTest(await window.GOTPoll.channels.test({ platform: draft.platform, target: parsed.target }));
  };

  const save = () => {
    if (!parsed?.ok) return;
    onSave({
      id: initial?.id ?? `${draft.platform.slice(0, 2)}-${Math.random().toString(36).slice(2, 9)}`,
      platform: draft.platform,
      target: parsed.target,
      label: draft.label.trim(),
      enabled: draft.enabled,
      createdAt: initial?.createdAt ?? Date.now(),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg gap-5 overflow-hidden">
        {/* a faint hint of the platform colour behind the glass */}
        <div
          className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full opacity-[0.12] blur-3xl transition-colors duration-700"
          style={{ background: meta.color }}
        />
        <DialogHeader className="relative">
          <DialogTitle>{initial ? 'Edit channel' : 'Add a chat channel'}</DialogTitle>
          <DialogDescription>Votes from every enabled channel are counted together. No keys or logins.</DialogDescription>
        </DialogHeader>

        {/* platform picker – neutral segmented control, brand colour only on the icon */}
        <div className="bg-foreground/5 relative grid grid-cols-3 gap-1 rounded-lg p-1">
          {PLATFORM_ORDER.filter((p) => !initial || p === draft.platform).map((p) => {
            const active = draft.platform === p;
            return (
              <button
                key={p}
                type="button"
                disabled={!!initial}
                onClick={() => setDraft((d) => ({ ...d, platform: p }))}
                className={cn(
                  'relative flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                  initial && 'col-span-3'
                )}
              >
                {active && (
                  <motion.span
                    layoutId="platform-pill"
                    className="bg-background/80 absolute inset-0 rounded-md shadow-sm"
                    transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                  />
                )}
                <PlatformIcon
                  platform={p}
                  className="relative h-4 w-4 transition-colors"
                  style={active ? { color: PLATFORMS[p].color } : undefined}
                />
                <span className="relative">{PLATFORMS[p].name}</span>
              </button>
            );
          })}
        </div>

        {/* target */}
        <div className="relative space-y-2">
          <Label htmlFor="ch-input">Channel</Label>
          <div className="relative">
            <PlatformIcon
              platform={draft.platform}
              className="text-muted-foreground absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2"
            />
            <Input
              id="ch-input"
              autoFocus
              className="pl-8"
              placeholder={meta.placeholder}
              value={draft.input}
              onChange={(e) => setDraft((d) => ({ ...d, input: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && canSave && save()}
            />
          </div>
          <div className="min-h-5 text-xs">
            {parsed?.ok ? (
              duplicate ? (
                <span className="text-amber-600 dark:text-amber-400">That channel is already added.</span>
              ) : (
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  <span className="text-foreground font-medium">{parsed.name}</span>
                  <span>·</span>
                  {parsed.follows ? (
                    <span className="flex items-center gap-1">
                      <Repeat className="h-3 w-3" /> follows every stream
                    </span>
                  ) : (
                    <span>this stream only</span>
                  )}
                </span>
              )
            ) : parsed && !parsed.ok ? (
              <span className="text-destructive flex items-center gap-1.5">
                <CircleAlert className="h-3.5 w-3.5" /> {parsed.error}
              </span>
            ) : (
              <span className="text-muted-foreground">{meta.help}</span>
            )}
          </div>
        </div>

        {/* label + enabled */}
        <div className="relative grid grid-cols-[1fr_auto] items-end gap-4">
          <div className="space-y-2">
            <Label htmlFor="ch-label">
              Display name <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id="ch-label"
              placeholder={parsed?.ok ? parsed.name : 'e.g. Main channel'}
              value={draft.label}
              onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
            />
          </div>
          <div className="flex h-9 items-center gap-2">
            <Switch id="ch-enabled" checked={draft.enabled} onCheckedChange={(v) => setDraft((d) => ({ ...d, enabled: v }))} />
            <Label htmlFor="ch-enabled">Enabled</Label>
          </div>
        </div>

        {/* connection test */}
        <AnimatePresence initial={false}>
          {test && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="relative overflow-hidden"
            >
              <TestResult test={test} />
            </motion.div>
          )}
        </AnimatePresence>

        <DialogFooter className="relative sm:justify-between">
          <Button variant="outline" disabled={!parsed?.ok || test === 'running'} onClick={runTest}>
            {test === 'running' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Test connection
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!canSave} onClick={save}>
              {initial ? 'Save' : 'Add channel'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TestResult({ test }: { test: ChannelTestResult | 'running' }) {
  if (test === 'running') {
    return (
      <div className="bg-foreground/5 flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Connecting and listening for chat…
      </div>
    );
  }
  const map = {
    live: {
      icon: <Radio className="h-4 w-4 text-emerald-500" />,
      cls: 'border-emerald-500/20 bg-emerald-500/5',
      title: 'Live – chat is flowing',
      body:
        test.result === 'live'
          ? `${test.messages} message${test.messages === 1 ? '' : 's'} in 5 seconds${test.detail ? ` · ${test.detail}` : ''}`
          : '',
    },
    offline: {
      icon: <WifiOff className="h-4 w-4 text-sky-500" />,
      cls: 'border-sky-500/20 bg-sky-500/5',
      title: 'Found it – not live right now',
      body: 'The poll will join automatically as soon as the stream starts.',
    },
    error: {
      icon: <CircleAlert className="h-4 w-4 text-rose-500" />,
      cls: 'border-rose-500/20 bg-rose-500/5',
      title: "Couldn't connect",
      body: test.detail ?? '',
    },
  }[test.result];
  return (
    <div className={cn('flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm', map.cls)}>
      <span className="mt-0.5">{map.icon}</span>
      <div>
        <div className="font-medium">{map.title}</div>
        {map.body && <div className="text-muted-foreground text-xs">{map.body}</div>}
      </div>
    </div>
  );
}
