import type { ReactNode } from "react";

// Minimal inline-markdown renderer: **bold**, __bold__, *italic*, _italic_, `code`,
// [text](url). Newlines become <br/>. Enough for the prose/bullets the agents emit,
// without pulling in a full markdown dependency.
export function renderRich(text: string): ReactNode[] {
  const lines = (text ?? "").split(/\n/);
  const nodes: ReactNode[] = [];
  lines.forEach((line, index) => {
    if (index > 0) nodes.push(<br key={`br-${index}`} />);
    nodes.push(...renderInline(line, `l${index}`));
  });
  return nodes;
}

const TOKEN =
  /(\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\*([^*\s][^*]*?)\*|_([^_\s][^_]*?)_|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let index = 0;
  let match: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((match = TOKEN.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const [full, , bold, boldU, code, ital, italU, linkText, linkUrl] = match;
    const key = `${keyPrefix}-${index++}`;
    if (bold ?? boldU) out.push(<strong key={key}>{bold ?? boldU}</strong>);
    else if (code) out.push(<code key={key}>{code}</code>);
    else if (ital ?? italU) out.push(<em key={key}>{ital ?? italU}</em>);
    else if (linkText && linkUrl)
      out.push(
        <a key={key} href={linkUrl} target="_blank" rel="noreferrer">
          {linkText}
        </a>
      );
    else out.push(full);
    last = match.index + full.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
