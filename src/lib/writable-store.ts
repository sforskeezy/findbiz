import { mkdir } from "node:fs/promises";
import path from "node:path";

/** Netlify, Vercel, and AWS Lambda serve from a read-only bundle at `/var/task`. */
export function isServerlessFilesystem() {
  const cwd = process.cwd();
  return Boolean(
    process.env.NETLIFY ||
      process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.LAMBDA_TASK_ROOT ||
      cwd === "/var/task" ||
      cwd.startsWith("/var/task/"),
  );
}

export function preferredStorePath(configured: string | undefined, segment: string) {
  const fromEnv = configured?.trim();
  const resolved = fromEnv
    ? path.isAbsolute(fromEnv)
      ? fromEnv
      : path.join(/* turbopackIgnore: true */ process.cwd(), fromEnv)
    : path.join(/* turbopackIgnore: true */ process.cwd(), "data", segment);

  if (isServerlessFilesystem() && !resolved.startsWith("/tmp")) {
    return path.join("/tmp", "findbiz", segment);
  }
  return resolved;
}

export async function ensureWritableStore(root: string, children: string[]) {
  const fallback = path.join("/tmp", "findbiz", path.basename(root));
  const candidates = root.startsWith("/tmp") ? [root] : [root, fallback];
  let lastError: unknown;

  for (const candidate of candidates) {
    try {
      await mkdir(/* turbopackIgnore: true */ candidate, { recursive: true });
      for (const child of children) {
        await mkdir(/* turbopackIgnore: true */ path.join(candidate, child), { recursive: true });
      }
      return candidate;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Could not create a writable store at ${root}.`);
}
