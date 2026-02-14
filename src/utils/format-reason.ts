export function formatReason(parts: string[]): string[] {
  // keep stable ordering, no duplicates
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const s = p.trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}
