/** US display: never show a +1 country code. */
export function displayPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const digits = trimmed.replace(/\D/g, "");
  let national = digits;
  if (national.length >= 11 && national.startsWith("1")) national = national.slice(1);
  if (national.length === 10) {
    return `${national.slice(0, 3)}-${national.slice(3, 6)}-${national.slice(6)}`;
  }

  const stripped = trimmed.replace(/^\s*\+1[\s.-]*/i, "").replace(/^1(?=\D)/, "").trim();
  return stripped || null;
}

export function telHref(value: string | null | undefined): string | null {
  const shown = displayPhone(value);
  if (!shown) return null;
  const digits = shown.replace(/\D/g, "");
  return digits ? `tel:${digits}` : `tel:${shown}`;
}
