"use client";
import { Orbit } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';

export function SwarmIcon({ size = 18, active = false, className = '' }: { size?: number; active?: boolean; className?: string }) {
  const reduce = useReducedMotion();
  return <motion.span aria-hidden="true" className={`sw-orbit-icon ${active?'running':''} ${className}`} style={{width:size,height:size}} animate={{rotate:active&&!reduce?360:0}} transition={active&&!reduce?{duration:7,ease:'linear',repeat:Infinity}:{duration:.4}}><Orbit size={size} strokeWidth={1.7}/></motion.span>;
}
