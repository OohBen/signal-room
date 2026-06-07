// Defensive cleanup for agent-generated text rendered in the UI: strips web-citation
// markers ([1], [1][2], [1, 2]) and markdown emphasis so cards read as clean prose,
// even for insights stored before the gateway started cleaning them at write time.
export function cleanInsight(text: string | undefined): string {
  if (!text) return "";
  return text
    .replace(/\s*\[\s*\d+(?:\s*[,–-]\s*\d+)*\s*\]/g, "") // [1], [1][2], [1, 2]
    .replace(/【\s*\d+(?:\s*[,–-]\s*\d+)*\s*】/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1") // bold
    .replace(/__(.*?)__/g, "$1")
    .replace(/(^|\s)[*_](\S[^*_]*?\S|\S)[*_]/g, "$1$2") // emphasis
    .replace(/`+/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
