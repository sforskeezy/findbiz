import { isSpectrumProvider } from '@/lib/swarm/lead-book';
export function ProviderLabels({ providers, limit = 3 }: { providers: string[]; limit?: number }) {
  const unique = [...new Set(providers)].sort((a, b) => Number(isSpectrumProvider(b)) - Number(isSpectrumProvider(a)));
  return <span className="sw-provider-labels">{unique.slice(0, limit).map((provider) => <span key={provider} className={isSpectrumProvider(provider) ? 'sw-spectrum' : ''}>{provider}</span>)}{unique.length > limit && <span className="sw-provider-more" title={unique.slice(limit).join(', ')}>+{unique.length - limit} more</span>}</span>;
}
