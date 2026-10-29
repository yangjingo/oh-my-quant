import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { memo } from "react";

const terminalRule = /^[ \t]*[─━═]{8,}[ \t]*$/;

/** Decorate explicit terminal separators only; retain every original character. */
function legacyContent(text: string) {
  return text.split(/(\r?\n(?:[ \t]*\r?\n)+)/).map((block, index) => {
    if (/^\r?\n(?:[ \t]*\r?\n)+$/.test(block)) return <span className="legacy-gap" key={index}>{block}</span>;
    const lines = block.split(/(?<=\n)/);
    return lines.map((line, row) => <span key={`${index}:${row}`} className={terminalRule.test(line.trimEnd()) ? "legacy-rule" : terminalRule.test((lines[row + 1] ?? "").trimEnd()) ? "legacy-heading" : undefined}>{line}</span>);
  });
}

/** Model prose cannot enable HTML or automatically load external images. */
export const ResearchMarkdown = memo(function ResearchMarkdown({ text }: { text: string }) {
  // Older terminal replies contain whitespace-aligned rows, not Markdown tables.
  // Keep their original bytes visible without interpreting HTML or guessing columns.
  const terminalLayout = /^[ \t]*[─━═]{8,}[ \t]*$/m.test(text);
  const fencedMarkdown = /^[ \t]*(?:`{3,}|~{3,})/m.test(text);
  if (terminalLayout && !fencedMarkdown) return <pre className="legacy-answer">{legacyContent(text)}</pre>;
  return <Markdown skipHtml remarkPlugins={[remarkGfm]} urlTransform={url => /^(https?:\/\/|#)/i.test(url) ? url : ""} components={{
    a: ({ children, href }) => href ? <a href={href} target={href.startsWith("#") ? undefined : "_blank"} rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
    img: ({ alt }) => <span className="inline-note">图片引用：{alt || "未提供说明"}（未自动加载）</span>,
    table: ({ children }) => <div className="table-scroll" role="region" aria-label="数据表格" tabIndex={0}><table>{children}</table></div>,
  }}>{text}</Markdown>;
});
