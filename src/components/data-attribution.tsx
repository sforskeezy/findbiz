import type { PlaceSource, ProviderDiagnostic } from "@/lib/types";

export function DataAttribution({ providers = [], sources = [] }: { providers?: ProviderDiagnostic[]; sources?: PlaceSource[] }) {
  const attributions = [
    ...providers.filter((provider) => provider.attributionUrl).map((provider) => ({ id: provider.providerId, label: provider.label, url: provider.attributionUrl })),
    ...sources.filter((source) => source.url).map((source) => ({ id: `${source.providerId}-${source.providerRecordId}`, label: source.label, url: source.url })),
  ].filter((item, index, all) => all.findIndex((other) => other.label === item.label && other.url === item.url) === index);
  if (!attributions.length) return null;
  return (
    <details className="text-[10px] leading-5 text-[#85857f]">
      <summary className="cursor-pointer font-semibold text-[#666660] underline decoration-[#c8c8c1] underline-offset-2 focus-visible:outline-2">Data attribution</summary>
      <p className="mt-2 max-w-[560px]">
        Business discovery may include licensed or public map datasets. Attribution is provided here for compliance and does not imply endorsement.
      </p>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        {attributions.map((provider) => (
          <li key={provider.id}>
            <a href={provider.url ?? undefined} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-[#33332f]">{provider.label}</a>
          </li>
        ))}
      </ul>
    </details>
  );
}
