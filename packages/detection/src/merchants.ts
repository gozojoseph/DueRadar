/**
 * Merchant normalisation is intentionally conservative. It strips transaction
 * noise but keeps words that distinguish two plans or two merchants.
 */

const NOISE = new Set([
  "payment",
  "paid",
  "purchase",
  "pos",
  "debit",
  "credit",
  "card",
  "transaction",
  "transfer",
  "to",
  "at",
  "from",
  "for",
  "your",
  "the",
  "a",
  "an",
  "via",
  "using",
  "with",
  "successful",
  "successfully",
  "completed",
  "complete",
  "approved",
  "mobile",
  "money",
  "momo",
  "wallet",
  "ghana",
  "gh",
  "accra",
  "ltd",
  "limited",
  "inc",
  "incorporated",
  "plc",
  "company",
  "services",
  "service",
  "online",
  "com",
  "net",
  "org",
  "io",
  "co",
  "app",
  "www",
  "prepaid",
  "prepay",
  "bundle",
  "airtime",
  "subscription",
  "membership",
  "bill",
]);

const KNOWN_MERCHANTS: Array<{ pattern: RegExp; name: string; key: string }> = [
  { pattern: /\bmtn\b/i, name: "MTN", key: "mtn" },
  { pattern: /\btelecel\b|\bvodafone\b/i, name: "Telecel", key: "telecel" },
  { pattern: /\bairteltigo\b|\bairtel\b/i, name: "AirtelTigo", key: "airteltigo" },
  { pattern: /\bnetflix\b/i, name: "Netflix", key: "netflix" },
  { pattern: /\bspotify\b/i, name: "Spotify", key: "spotify" },
  { pattern: /\byoutube\b/i, name: "YouTube", key: "youtube" },
  { pattern: /\bapple\b|\bitunes\b|\bicloud\b/i, name: "Apple", key: "apple" },
  { pattern: /\bgoogle\b|\bplay\s*store\b/i, name: "Google", key: "google" },
  { pattern: /\bamazon\b|\baudible\b/i, name: "Amazon", key: "amazon" },
  { pattern: /\bnetflix\b/i, name: "Netflix", key: "netflix" },
  { pattern: /\bshowmax\b/i, name: "Showmax", key: "showmax" },
  { pattern: /\bdstv\b/i, name: "DStv", key: "dstv" },
  { pattern: /\bgotv\b/i, name: "GOtv", key: "gotv" },
  { pattern: /\bcanal\+\b/i, name: "Canal+", key: "canal-plus" },
  { pattern: /\bbolt\b/i, name: "Bolt", key: "bolt" },
  { pattern: /\buber\b/i, name: "Uber", key: "uber" },
  { pattern: /\bglovo\b/i, name: "Glovo", key: "glovo" },
  { pattern: /\bjumia\b/i, name: "Jumia", key: "jumia" },
  { pattern: /\bbolt\s*food\b/i, name: "Bolt Food", key: "bolt-food" },
  { pattern: /\bchatgpt\b|\bopenai\b/i, name: "ChatGPT", key: "openai" },
  { pattern: /\bcanva\b/i, name: "Canva", key: "canva" },
  { pattern: /\badobe\b/i, name: "Adobe", key: "adobe" },
  { pattern: /\bmicrosoft\b|\boffice\s*365\b/i, name: "Microsoft", key: "microsoft" },
  { pattern: /\bdropbox\b/i, name: "Dropbox", key: "dropbox" },
  { pattern: /\bmedium\b/i, name: "Medium", key: "medium" },
  { pattern: /\blinkedin\b/i, name: "LinkedIn", key: "linkedin" },
  { pattern: /\bnotion\b/i, name: "Notion", key: "notion" },
  { pattern: /\bfigma\b/i, name: "Figma", key: "figma" },
  { pattern: /\bgrammarly\b/i, name: "Grammarly", key: "grammarly" },
  { pattern: /\bdux\s*music\b|\bboomplay\b/i, name: "Boomplay", key: "boomplay" },
  { pattern: /\becg\b|\belectricity company of ghana\b/i, name: "ECG", key: "ecg" },
  { pattern: /\bghana water\b|\bgwcl\b/i, name: "Ghana Water", key: "ghana-water" },
  { pattern: /\bfibre\b|\bbroadband\b|\bwif\b/i, name: "Internet", key: "internet" },
];

export function merchantAlias(text: string): { name: string; key: string } | null {
  for (const merchant of KNOWN_MERCHANTS) {
    if (merchant.pattern.test(text)) return { name: merchant.name, key: merchant.key };
  }
  return null;
}

export function merchantKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/www\./g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0 && !NOISE.has(word))
    .join(" ")
    .trim()
    .slice(0, 80);
}

function cleanCandidate(value: string): string {
  let candidate = value
    .replace(/\s+/g, " ")
    .replace(/^[\s\-:]+|[\s\-:.,;]+$/g, "")
    .replace(/[.;].*$/, "")
    .replace(/\b(?:your|new balance|available balance|current balance|balance|ref|reference|transaction|trans|txn|id|no|number)\b.*$/i, "")
    .trim();
  candidate = candidate.replace(/\s+(?:on|for|with|via|using|successful|successfully|completed)\b.*$/i, "");
  candidate = candidate.replace(/\b(?:GHS|USD|EUR|GBP|NGN|KES|ZAR|XOF|CFA)\b.*$/i, "");
  candidate = candidate.replace(/\d{4,}/g, " ").replace(/\s+/g, " ").trim();
  return candidate.slice(0, 60);
}

function usable(candidate: string | null): candidate is string {
  if (!candidate) return false;
  const key = merchantKey(candidate);
  if (key.length < 2) return false;
  if (/^(gh|ghs|usd|eur|gbp|ngn|kes|zar|payment|purchase|transaction|unknown)$/i.test(key)) {
    return false;
  }
  return true;
}

export function extractMerchant(text: string): string | null {
  const patterns = [
    /(?:paid|payment|purchase|charged|debit(?:ed)?|transfer(?:red)?|sent)\s+(?:of\s+)?(?:[A-Z]{3}\s*[0-9][0-9,.]*\s*)?(?:to|at|for)\s+([A-Za-z0-9][A-Za-z0-9&'’\- ]{1,50})/i,
    /(?:to|at|from)\s+([A-Za-z0-9][A-Za-z0-9&'’\- ]{1,50})(?=\s+(?:on|for|with|ref|reference|transaction|via|using|successful|successfully|completed)\b|[,.;\n]|$)/i,
    /(?:merchant|payee|vendor|description|narration|details)[:\-]\s*([^\n,;]{2,60})/i,
    /(?:your|the)\s+([A-Z][A-Za-z0-9&'’.\- ]{1,40}?)\s+(?:free trial|subscription|plan|membership|account)\b/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const candidate = cleanCandidate(match?.[1] ?? "");
    if (usable(candidate)) return candidate;
  }

  const known = merchantAlias(text);
  return known?.name ?? null;
}

/** Display form: preserves known brand casing, otherwise trims noisy casing. */
export function displayMerchant(value: string): string {
  const cleaned = cleanCandidate(value);
  if (!cleaned) return merchantAlias(value)?.name ?? value.trim();
  const known = merchantAlias(cleaned);
  if (known && merchantKey(cleaned) === known.key) return known.name;
  if (cleaned === cleaned.toUpperCase() && cleaned.length <= 5) return cleaned;
  return cleaned
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    .replace(/\b(?:Mtn|Ghs|Usd|Pos|Atm)\b/g, (word) => word.toUpperCase());
}

export function sameMerchant(a: string, b: string): boolean {
  const left = merchantKey(a);
  const right = merchantKey(b);
  if (!left || !right) return false;
  if (left === right) return true;
  return left.includes(right) || right.includes(left);
}
