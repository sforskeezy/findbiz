"use client";
import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
export function CopyContact({ value, label, className = '', children, doneText }: { value: string; label: string; className?: string; children?: React.ReactNode; doneText?: string }) {
  const [state, setState] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    clearTimeout(timer.current);
    try { await navigator.clipboard.writeText(value); setState('Copied'); timer.current = setTimeout(() => setState(''), 1800); }
    catch { setState('Copy unavailable'); }
  }
  return <button type="button" className={`sw-copy-contact ${className}`} title={state || `Copy ${label}`} aria-label={`Copy ${label}: ${value}`} onClick={() => void copy()} onBlur={() => setState('')}><span>{state === 'Copied' && doneText ? doneText : children ?? value}</span>{state === 'Copied' ? <Check size={12}/> : <Copy size={12}/>}<span className="sw-sr-only" role="status">{state}</span></button>;
}
