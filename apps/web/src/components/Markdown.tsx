import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { memo } from "react";

/** Model prose cannot enable HTML or automatically load external images. */
export const ResearchMarkdown = memo(function ResearchMarkdown({ text }: { text: string }) {
  return <Markdown skipHtml remarkPlugins={[remarkGfm]} urlTransform={url => /^(https?:\/\/|#)/i.test(url) ? url : ""} components={{
    a: ({ children, href }) => href ? <a href={href} target={href.startsWith("#") ? undefined : "_blank"} rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
    img: ({ alt }) => <span className="inline-note">图片引用：{alt || "未提供说明"}（未自动加载）</span>,
    table: ({ children }) => <div className="table-scroll" role="region" aria-label="数据表格" tabIndex={0}><table>{children}</table></div>,
  }}>{text}</Markdown>;
});
