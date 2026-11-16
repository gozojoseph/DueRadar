const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "-",
  mdash: "-",
  rsquo: "'",
  lsquo: "'",
  ldquo: '"',
  rdquo: '"',
  hellip: "...",
  copy: "(c)",
  reg: "(r)",
  trade: "(tm)",
  pound: "£",
  euro: "€",
  cent: "¢",
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * Removes markup and remote references. DueRadar never loads an image, iframe
 * or stylesheet from an inbound message, so stripping is both a readability and
 * a privacy control.
 */
export function stripHtml(input: string): string {
  let value = input;
  value = value.replace(/<!--[\s\S]*?-->/g, " ");
  value = value.replace(/<(script|style|head|title|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  value = value.replace(/<(img|iframe|object|embed|source|video|audio|link|meta)\b[^>]*>/gi, " ");
  value = value.replace(/<\/?(br|p|div|li|tr|h[1-6]|table|section|article)\b[^>]*>/gi, "\n");
  value = value.replace(/<[^>]+>/g, " ");
  return decodeEntities(value);
}

/**
 * Capped, whitespace-normalised text. Messages are untrusted input, so control
 * characters and enormous bodies are removed before any parser sees them.
 */
export function prepareMessage(input: string, maxLength = 20_000): string {
  const withoutNulls = input.replace(/\u0000/g, " ");
  const plain = /<\s*(html|body|div|p|br|table|span)\b/i.test(withoutNulls)
    ? stripHtml(withoutNulls)
    : decodeEntities(withoutNulls);
  return plain
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength);
}

export function snippet(value: string, maxLength = 180): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1).trimEnd()}…`;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

export function monthNumber(value: string): number | null {
  return MONTHS[value.toLowerCase()] ?? null;
}
