function words(value: string) {
  return value.toLowerCase().replace(/['’]/g, "").replace(/lanscap/g, "landscap")
    .split(/[^a-z0-9]+/).filter(Boolean).map((word) => word.replace(/s$/, ""));
}

/** Compare distinctive whole words: a search for L3 must not match L3Harris. */
export function matchesBusinessName(result: { title: string; snippet: string; url?: string }, name: string) {
  const ignored = new Set(["the", "and", "a", "an", "llc", "inc", "company", "companie", "service", "business"]);
  const wanted = words(name).filter((word) => !ignored.has(word));
  const found = new Set(words(result.title + " " + result.snippet));
  return wanted.length > 0 && wanted.every((word) => found.has(word));
}
