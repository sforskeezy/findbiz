export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { inspectOvertureReadiness } = await import("@/lib/overture");
  await inspectOvertureReadiness();
}
