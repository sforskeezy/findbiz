const inFlight = new Map<string, Promise<unknown>>();

export function coalesceRequest<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const current = inFlight.get(key) as Promise<T> | undefined;
  if (current) return current;
  const promise = operation().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

export function createTimeoutSignal(timeoutMs: number, parent?: AbortSignal) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parent?: AbortSignal,
): Promise<T> {
  return operation(createTimeoutSignal(timeoutMs, parent));
}

export function redactError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  const clean = error.message
    .replace(/https?:\/\/[^\s)]+/gi, "[redacted-url]")
    .replace(/(?:bearer|token|key|authorization)\s*[:=]\s*[^\s,;]+/gi, "credential=[redacted]")
    .replace(/[A-Za-z]:\\(?:[^\\\s]+\\)+[^\\\s]*/g, "[redacted-path]")
    .replace(/(?:\/[A-Za-z0-9._-]+){2,}/g, "[redacted-path]")
    .replace(/\b\d{1,6}\s+[A-Za-z][^,\n]{2,80},\s*[^\n]{2,80}\b/g, "[redacted-address]")
    .replace(/-?\d{1,3}\.\d{4,}/g, "[redacted-coordinate]");
  return clean.slice(0, 240) || fallback;
}

export class ProviderRateLimiter {
  private nextAllowedAt = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly minimumIntervalMs: number) {}

  async wait(signal?: AbortSignal) {
    const previous = this.chain;
    let release: () => void = () => {};
    this.chain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const waitMs = Math.max(0, this.nextAllowedAt - Date.now());
      if (waitMs > 0) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, waitMs);
          signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(signal.reason ?? new Error("Request cancelled."));
            },
            { once: true },
          );
        });
      }
      this.nextAllowedAt = Date.now() + this.minimumIntervalMs;
    } finally {
      release();
    }
  }
}

export class CircuitBreaker {
  private failures = 0;
  private openUntil = 0;

  constructor(
    private readonly failureThreshold = 3,
    private readonly cooldownMs = 60_000,
  ) {}

  assertAvailable() {
    if (this.openUntil > Date.now()) throw new Error("Provider circuit is temporarily open.");
    if (this.openUntil) {
      this.openUntil = 0;
      this.failures = 0;
    }
  }

  success() {
    this.failures = 0;
    this.openUntil = 0;
  }

  failure() {
    this.failures += 1;
    if (this.failures >= this.failureThreshold) this.openUntil = Date.now() + this.cooldownMs;
  }
}
