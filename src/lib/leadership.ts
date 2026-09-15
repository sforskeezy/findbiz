/** Return only an explicit professional role statement, never an inferred owner. */
export function publishedLeadership(text: string): Array<{ label: string; value: string }> {
  const found: Array<{ label: string; value: string }> = [];
  const name = "([A-Z][a-zA-Z'’-]+(?: [A-Z][a-zA-Z'’-]+){1,3})";
  for (const [prefix, label] of [["[Oo]wned (?:and operated )?by", "Published owner"], ["[Ff]ounded by", "Published founder"], ["[Oo]wner[: ,]+", "Published owner"]]) {
    const pattern = new RegExp(`${prefix}\\s*${name}(?=[.,;:!?]|$| [a-z])`, "g");
    for (const match of text.matchAll(pattern)) {
      if (!found.some((item) => item.value === match[1])) found.push({ label, value: match[1] });
    }
  }
  return found.slice(0, 4);
}
