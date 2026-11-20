const quotedTerm = (field: string, value: string) =>
  `${field}:"${value.replace(/["\\]/g, '\\$&')}"`;

export function brandSearchQuery(brand: string): string {
  return quotedTerm('brand', brand);
}

export function modelSearchQuery(brand: string | null, model: string): string {
  const parts = [brand ? quotedTerm('brand', brand) : '', quotedTerm('model', model)].filter(
    Boolean,
  );
  return parts.join(' ');
}

export function googleSearchUrl(
  brand: string | null,
  model: string | null,
): {
  query: string;
  href: string;
} {
  const query = [brand, model].filter(Boolean).join(' ');
  return {
    query,
    href: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
  };
}
