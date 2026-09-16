"use client";
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
export function CopyContact({ value, label, className = '', children }: { value: string; label: string; className?: string; children?: React.ReactNode }) {
  const [state, setState] = useState('');
  async function copy() {
    try { await navigator.clipboard.writeText(value); setState('Copied'); }
    catch { setState('Copy unavailable'); }
  }
  return <button type="button" className={`sw-copy-contact ${className}`} title={state || `Copy ${label}`} aria-label={`Copy ${label}: ${value}`} onClick={() => void copy()} onBlur={() => setState('')}><span>{children ?? value}</span>{state === 'Copied' ? <Check size={12}/> : <Copy size={12}/>}<span className="sw-sr-only" role="status">{state}</span></button>;
}
