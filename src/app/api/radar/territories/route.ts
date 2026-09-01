import { listTerritories, loadLatestScan } from "@/lib/radar/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const territoryId = url.searchParams.get("territoryId")?.trim();
  if (territoryId) {
    const scan = await loadLatestScan(territoryId);
    if (!scan) return Response.json({ error: "No Radar scan is stored for this territory yet." }, { status: 404 });
    return Response.json({ scan });
  }
  return Response.json({ territories: await listTerritories() });
}
