import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

export type ConfettiHandle = { burst: (colors?: string[]) => void };

type P = {
  x: number; y: number; vx: number; vy: number; rot: number; vr: number;
  w: number; h: number; color: string; life: number; shape: 0 | 1;
};

const DEFAULT = ['#ffd166', '#f5c542', '#ffffff', '#ff5d8f', '#7c5cff', '#22d3ee'];

/** Tiny dependency-free confetti cannon on a full-screen canvas. */
const Confetti = forwardRef<ConfettiHandle>(function Confetti(_, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const parts = useRef<P[]>([]);
  const raf = useRef<number | null>(null);

  const loop = () => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== c.clientWidth * dpr) {
      c.width = c.clientWidth * dpr;
      c.height = c.clientHeight * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, c.clientWidth, c.clientHeight);
    const alive: P[] = [];
    for (const p of parts.current) {
      p.vy += 0.16;
      p.vx *= 0.992;
      p.vy *= 0.992;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.life -= 1;
      if (p.life <= 0 || p.y > c.clientHeight + 40) continue;
      alive.push(p);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = Math.min(1, p.life / 40);
      ctx.fillStyle = p.color;
      if (p.shape === 0) ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.rot * 2)));
      else {
        ctx.beginPath();
        ctx.arc(0, 0, p.w / 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    parts.current = alive;
    raf.current = alive.length ? requestAnimationFrame(loop) : null;
  };

  useImperativeHandle(ref, () => ({
    burst(colors = DEFAULT) {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const c = canvas.current;
      if (!c) return;
      const W = c.clientWidth;
      const H = c.clientHeight;
      const cannons = [
        { x: W * 0.5, y: H * 0.42, spread: Math.PI * 2, speed: 13, n: 160 },
        { x: -10, y: H * 0.85, spread: 0.5, speed: 19, n: 90, angle: -Math.PI / 3.2 },
        { x: W + 10, y: H * 0.85, spread: 0.5, speed: 19, n: 90, angle: -Math.PI + Math.PI / 3.2 },
      ];
      for (const k of cannons) {
        for (let i = 0; i < k.n; i++) {
          const a = (k.angle ?? 0) + (Math.random() - 0.5) * k.spread;
          const s = k.speed * (0.45 + Math.random() * 0.7);
          parts.current.push({
            x: k.x, y: k.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - (k.angle ? 0 : 3),
            rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
            w: 7 + Math.random() * 7, h: 10 + Math.random() * 8,
            color: colors[Math.floor(Math.random() * colors.length)],
            life: 160 + Math.random() * 120, shape: Math.random() < 0.8 ? 0 : 1,
          });
        }
      }
      if (raf.current === null) raf.current = requestAnimationFrame(loop);
    },
  }));

  useEffect(() => () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
  }, []);

  return <canvas ref={canvas} className="pointer-events-none fixed inset-0 z-50 h-full w-full" />;
});

export default Confetti;
