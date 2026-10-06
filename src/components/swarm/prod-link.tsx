import { ArrowUpRight } from 'lucide-react';
import { gisServiceabilityUrl } from '@/lib/swarm/lookup-links';

/** Opens the address in the PROD serviceability tool, prefilled the same way the tool routes it. */
export function ProdLink({ address, className = 'spx-btn', compact = false }: { address: string; className?: string; compact?: boolean }) {
  const url = gisServiceabilityUrl(address);
  if (!url) return null;
  return <a className={`${className} sw-prod`} href={url} target="_blank" rel="noreferrer" title="Open in PROD" aria-label={`Open ${address} in PROD`} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
    {compact ? 'PROD' : <>Open in PROD<ArrowUpRight size={12}/></>}
  </a>;
}
