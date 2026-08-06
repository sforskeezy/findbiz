import { Suspense } from "react";

import { BusinessResearchPage } from "@/components/business-research-page";
import { ProspectHeader } from "@/components/prospect-header";
import { SearchProgress } from "@/components/search-progress";

export default async function BusinessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#f5f5f2]"><ProspectHeader /><SearchProgress /></main>}>
      <BusinessResearchPage prospectId={decodeURIComponent(id)} />
    </Suspense>
  );
}
