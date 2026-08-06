import { Suspense } from "react";

import { BusinessResultsPage } from "@/components/business-results-page";
import { ProspectHeader } from "@/components/prospect-header";
import { SearchProgress } from "@/components/search-progress";

export default function SearchPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#f5f5f2]"><ProspectHeader /><SearchProgress /></main>}>
      <BusinessResultsPage />
    </Suspense>
  );
}
