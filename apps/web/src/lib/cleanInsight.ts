// Light cleanup for agent text rendered in the UI: removes web-citation markers
// ([1], [1][2], [1, 2]) which are noise without the source mapping. Markdown is kept
// intentionally — it is rendered (see renderRich), not stripped. Newlines preserved.
export function cleanInsight(text: string | undefined): string {
  if (!text) return "";
  return text
    .replace(/\s*\[\s*\d+(?:\s*[,–-]\s*\d+)*\s*\]/g, "")
    .replace(/【\s*\d+(?:\s*[,–-]\s*\d+)*\s*】/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
