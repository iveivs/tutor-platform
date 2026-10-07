import type { ReactNode } from "react";

function inline(value: string): ReactNode[] {
  const parts = value.split(/(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s)]+)/g);
  return parts.filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("http")) return <a key={index} href={part} className="text-indigo-600 underline underline-offset-2">{part}</a>;
    return part;
  });
}

export function LegalDocument({ markdown }: { markdown: string }) {
  const lines = markdown.split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(<p key={`p-${blocks.length}`}>{inline(paragraph.join(" "))}</p>);
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    blocks.push(<ul key={`ul-${blocks.length}`}>{list.map((item, index) => <li key={index}>{inline(item)}</li>)}</ul>);
    list = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { flushParagraph(); flushList(); continue; }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph(); flushList();
      const level = heading[1].length;
      if (level === 1) blocks.push(<h1 key={`h-${blocks.length}`}>{inline(heading[2])}</h1>);
      else if (level === 2) blocks.push(<h2 key={`h-${blocks.length}`}>{inline(heading[2])}</h2>);
      else blocks.push(<h3 key={`h-${blocks.length}`}>{inline(heading[2])}</h3>);
      continue;
    }
    const listItem = line.match(/^[-*]\s+(.+)$/);
    if (listItem) { flushParagraph(); list.push(listItem[1]); continue; }
    if (line.startsWith("> ")) {
      flushParagraph(); flushList();
      blocks.push(<blockquote key={`q-${blocks.length}`}>{inline(line.slice(2))}</blockquote>);
      continue;
    }
    if (line.startsWith("|")) {
      flushParagraph(); flushList();
      if (!/^\|?\s*:?-+/.test(line)) blocks.push(<div key={`t-${blocks.length}`} className="overflow-x-auto"><p className="whitespace-pre-wrap font-mono text-sm">{line}</p></div>);
      continue;
    }
    flushList(); paragraph.push(line.replace(/^\d+\.\s+/, "$&"));
  }
  flushParagraph(); flushList();
  return <article className="legal-document">{blocks}</article>;
}
