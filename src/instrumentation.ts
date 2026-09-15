/** Resume unfinished batches on persistent Node deployments. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureSwarmWorker } = await import("@/lib/swarm/engine");
    ensureSwarmWorker();
  }
}
