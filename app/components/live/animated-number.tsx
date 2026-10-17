import { motion, useSpring, useTransform } from 'motion/react';
import { useEffect } from 'react';

/** A number that springs to its new value instead of jumping. */
export default function AnimatedNumber({
  value,
  from,
  className,
  stiffness = 140,
  damping = 22,
}: {
  value: number;
  /** start here on mount (e.g. 0 for a count-up) */
  from?: number;
  className?: string;
  stiffness?: number;
  damping?: number;
}) {
  const mv = useSpring(from ?? value, { stiffness, damping, mass: 0.7 });
  const text = useTransform(mv, (v) => Math.round(v).toLocaleString());
  useEffect(() => {
    mv.set(value);
  }, [value, mv]);
  return <motion.span className={className}>{text}</motion.span>;
}
