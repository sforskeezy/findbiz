/** Read JSON server-sent events across arbitrary byte boundaries. Used by the
 * browser and provider client so both handle CRLF, UTF-8 and final frames alike. */
export async function readEventStream<T>(response: Response, onEvent: (event: T) => void | Promise<void>) {
  if (!response.body) throw new Error("The connection returned an empty stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const consume = async (frame: string) => {
    const data = frame.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (data.trim() && data.trim() !== "[DONE]") await onEvent(JSON.parse(data) as T);
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        await consume(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary[0].length);
      }
      if (done) {
        if (buffer.trim()) await consume(buffer);
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Release a cancelled conversation even when a shared lookup cannot be
 * cancelled (for example, a coalesced directory-cache request). */
export async function abortable<T>(signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
  signal?.throwIfAborted();
  if (!signal) return operation();
  let onAbort: () => void = () => {};
  try {
    return await Promise.race([
      new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
      }),
      operation(),
    ]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
