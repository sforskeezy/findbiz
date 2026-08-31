import { NextResponse } from "next/server";

import { researchCompany } from "@/lib/company-intelligence";
import type { Prospect } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { prospect?: Prospect };
    const prospect = body.prospect;
    if (!prospect || typeof prospect.name !== "string" || prospect.name.trim().length < 2) {
      return NextResponse.json({ error: "A valid business record is required." }, { status: 400 });
    }
    if (prospect.name.length > 240 || prospect.address.length > 400 || (prospect.website?.length ?? 0) > 1_000) {
      return NextResponse.json({ error: "The business record is too large." }, { status: 400 });
    }
    return NextResponse.json({ intelligence: await researchCompany(prospect) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Public company research failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
