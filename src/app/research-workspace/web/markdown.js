/**
 * Lightweight, secure, zero-dependency Markdown parser & renderer.
 * Designed for WhyJ Research Workspace chat conversations and agent reports.
 * 
 * Supports:
 * - Fenced code blocks with language labels & one-click copy
 * - GFM tables with column alignment
 * - Blockquotes with dark-gold accent styling
 * - Nested ordered and unordered lists
 * - Headings (H1-H6) scaled for chat contexts
 * - Inline formatting: bold, italic, strikethrough, inline code, sanitized links
 * - Full HTML entity escaping for XSS prevention
 */

export function escapeHtml(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function sanitizeUrl(url) {
  if (!url) return "#";
  const trimmed = url.trim();
  if (/^(?:https?:\/\/|mailto:|#)/i.test(trimmed)) {
    return escapeHtml(trimmed);
  }
  return "#";
}

/**
 * Parses inline markdown: code, bold, italic, strikethrough, links.
 * Input should NOT be escaped yet or should be carefully handled.
 */
export function parseInline(text) {
  if (!text) return "";

  // 1. Extract inline code spans first to protect their contents
  const codeSpans = [];
  let processed = text.replace(/`([^`\n]+)`/g, (_match, code) => {
    const idx = codeSpans.length;
    codeSpans.push(escapeHtml(code));
    return `\x00C${idx}\x00`;
  });

  // 2. Escape HTML on the rest of the text
  processed = escapeHtml(processed);

  // 3. Bold + Italic: ***text*** or ___text___
  processed = processed.replace(
    /\*\*\*([^\*\n]+)\*\*\*/g,
    "<strong><em>$1</em></strong>",
  );
  processed = processed.replace(
    /(?:^|[\s\(\[\{])___([^_\n]+)___(?=[\s\)\]\}]|$)/g,
    "$1<strong><em>$2</em></strong>",
  );

  // 4. Bold: **text** or __text__
  processed = processed.replace(
    /\*\*([^\*\n]+)\*\*/g,
    "<strong>$1</strong>",
  );
  processed = processed.replace(
    /(?:^|[\s\(\[\{])__([^_\n]+)__(?=[\s\)\]\}]|$)/g,
    "<strong>$1</strong>",
  );

  // 5. Italic: *text* or _text_
  processed = processed.replace(
    /\*([^\*\n\s][^\*\n]*?|\S)\*/g,
    "<em>$1</em>",
  );
  processed = processed.replace(
    /(?:^|[\s\(\[\{])_([^_\n\s][^_\n]*?|\S)_(?=[\s\)\]\}]|$)/g,
    "<em>$1</em>",
  );

  // 6. Strikethrough: ~~text~~
  processed = processed.replace(
    /~~([^~\n]+)~~/g,
    "<del>$1</del>",
  );

  // 7. Links: [label](url) - parsed after bold/italic so attributes like target="_blank" are untouched
  processed = processed.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_match, label, url) => {
      const safe = sanitizeUrl(url);
      return `<a href="${safe}" target="_blank" rel="noopener noreferrer" class="md-link">${label}</a>`;
    },
  );

  // 8. Restore inline code spans
  processed = processed.replace(/\x00C(\d+)\x00/g, (_match, idx) => {
    return `<code class="md-inline-code">${codeSpans[Number(idx)]}</code>`;
  });

  return processed;
}

/**
 * Parses a GFM table block.
 */
function parseTable(lines) {
  if (lines.length < 2) return null;
  const headerLine = lines[0].trim();
  const sepLine = lines[1].trim();

  if (!headerLine.includes("|") || !sepLine.includes("|")) return null;

  const parseCells = (line) => {
    let raw = line.trim();
    if (raw.startsWith("|")) raw = raw.slice(1);
    if (raw.endsWith("|")) raw = raw.slice(0, -1);
    return raw.split("|").map((c) => c.trim());
  };

  const seps = parseCells(sepLine);
  const isSepValid = seps.every((s) => /^:?-+:?$/.test(s));
  if (!isSepValid) return null;

  const alignments = seps.map((s) => {
    const left = s.startsWith(":");
    const right = s.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    return "left";
  });

  const headers = parseCells(headerLine);
  let html = '<div class="md-table-wrapper"><table class="md-table"><thead><tr>';
  headers.forEach((h, i) => {
    const align = alignments[i] ? ` style="text-align: ${alignments[i]}"` : "";
    html += `<th${align}>${parseInline(h)}</th>`;
  });
  html += "</tr></thead><tbody>";

  for (let r = 2; r < lines.length; r++) {
    const cells = parseCells(lines[r]);
    html += "<tr>";
    for (let c = 0; c < headers.length; c++) {
      const cellText = cells[c] !== undefined ? cells[c] : "";
      const align = alignments[c] ? ` style="text-align: ${alignments[c]}"` : "";
      html += `<td${align}>${parseInline(cellText)}</td>`;
    }
    html += "</tr>";
  }

  html += "</tbody></table></div>";
  return html;
}

/**
 * Core Markdown parser that converts Markdown string into safe HTML.
 */
export function renderMarkdownToHtml(markdown) {
  if (!markdown || typeof markdown !== "string") return "";

  // Normalize line endings
  const raw = markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // 1. Extract fenced code blocks first
  const codeBlocks = [];
  const withoutCode = raw.replace(
    /(?:^|\n)```([a-zA-Z0-9_\-]*)\n([\s\S]*?)\n```(?:\n|$)/g,
    (_match, lang, code) => {
      const idx = codeBlocks.length;
      const cleanLang = (lang || "").trim().toLowerCase();
      const encodedCode = encodeURIComponent(code);
      const safeCode = escapeHtml(code);
      const html = `<div class="code-block-wrapper"><div class="code-block-header"><span class="code-lang">${cleanLang || "text"}</span><button class="copy-code-btn" type="button" data-code="${encodedCode}">复制</button></div><pre><code class="language-${cleanLang}">${safeCode}</code></pre></div>`;
      codeBlocks.push(html);
      return `\n\n\x02CODE_BLOCK_${idx}\x02\n\n`;
    },
  );

  // Split text into lines for block parsing
  const lines = withoutCode.split("\n");
  const output = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Placeholder for code blocks
    const codeMatch = line.trim().match(/^\x02CODE_BLOCK_(\d+)\x02$/);
    if (codeMatch) {
      output.push(codeBlocks[Number(codeMatch[1])]);
      i++;
      continue;
    }

    // Blank lines
    if (!line.trim()) {
      i++;
      continue;
    }

    // Horizontal Rule: --- or ***
    if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) {
      output.push('<hr class="md-hr" />');
      i++;
      continue;
    }

    // Headings: # to ######
    const headingMatch = line.match(/^(\#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      // In chat UI, map H1->H3, H2->H4, H3->H5, H4-H6->H6 for balanced proportions
      const tagLevel = Math.min(6, level + 2);
      const title = parseInline(headingMatch[2].trim());
      output.push(`<h${tagLevel} class="md-heading md-h${level}">${title}</h${tagLevel}>`);
      i++;
      continue;
    }

    // Blockquote: > text
    if (/^\s*>\s?/.test(line)) {
      const quoteLines = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      const quoteContent = quoteLines.map((l) => parseInline(l)).join("<br />");
      output.push(`<blockquote class="md-blockquote">${quoteContent}</blockquote>`);
      continue;
    }

    // Table detection: starts with | and next line is table separator
    if (
      line.trim().startsWith("|") &&
      i + 1 < lines.length &&
      lines[i + 1].trim().startsWith("|") &&
      lines[i + 1].includes("-")
    ) {
      const tableLines = [];
      while (i < lines.length && lines[i].trim().includes("|") && lines[i].trim() !== "") {
        tableLines.push(lines[i]);
        i++;
      }
      const tableHtml = parseTable(tableLines);
      if (tableHtml) {
        output.push(tableHtml);
        continue;
      }
      // If table parsing failed, roll back and treat as normal text
      i -= tableLines.length;
    }

    // Lists: Unordered (- , * , + ) or Ordered (1. , 2. )
    const isUnordered = /^\s*[-*+]\s+/.test(line);
    const isOrdered = /^\s*\d+\.\s+/.test(line);
    if (isUnordered || isOrdered) {
      const listTag = isUnordered ? "ul" : "ol";
      const listClass = isUnordered ? "md-ul" : "md-ol";
      let listHtml = `<${listTag} class="${listClass}">`;
      
      while (i < lines.length) {
        const currentLine = lines[i];
        const uMatch = currentLine.match(/^(\s*)([-*+])\s+(.+)$/);
        const oMatch = currentLine.match(/^(\s*)(\d+)\.\s+(.+)$/);
        const match = isUnordered ? uMatch : oMatch;

        if (!match) {
          // If indented continuation of current item
          if (/^\s{2,}\S/.test(currentLine)) {
            listHtml += `<br />${parseInline(currentLine.trim())}`;
            i++;
            continue;
          }
          break;
        }

        const itemText = parseInline(match[3].trim());
        listHtml += `<li>${itemText}</li>`;
        i++;
      }

      listHtml += `</${listTag}>`;
      output.push(listHtml);
      continue;
    }

    // Paragraph
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().match(/^\x02CODE_BLOCK_(\d+)\x02$/) &&
      !/^\s*(?:[-*_]\s*){3,}$/.test(lines[i]) &&
      !lines[i].match(/^(\#{1,6})\s+(.+)$/) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !(lines[i].trim().startsWith("|") && i + 1 < lines.length && lines[i + 1].trim().startsWith("|"))
    ) {
      paraLines.push(lines[i]);
      i++;
    }

    if (paraLines.length > 0) {
      const content = paraLines.map((l) => parseInline(l)).join("<br />");
      output.push(`<p class="md-p">${content}</p>`);
    }
  }

  return output.join("\n");
}

/**
 * Creates and attaches copy-to-clipboard functionality to code blocks within container.
 */
export function attachCodeCopyButtons(container) {
  if (!container) return;
  const copyButtons = container.querySelectorAll(".copy-code-btn");
  copyButtons.forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const rawCode = decodeURIComponent(btn.dataset.code || "");
      if (!rawCode) return;
      navigator.clipboard.writeText(rawCode).then(() => {
        const originalText = btn.textContent;
        btn.textContent = "✓ 已复制";
        btn.classList.add("copied");
        setTimeout(() => {
          btn.textContent = originalText;
          btn.classList.remove("copied");
        }, 2000);
      }).catch(() => {
        btn.textContent = "复制失败";
        setTimeout(() => {
          btn.textContent = "复制";
        }, 2000);
      });
    };
  });
}

/**
 * Renders Markdown into a DOM element.
 * 
 * @param {string} markdown - Raw Markdown text from model or user.
 * @param {string} [extraClass] - Additional CSS class name.
 * @returns {HTMLDivElement}
 */
export function renderMarkdown(markdown, extraClass = "") {
  const container = document.createElement("div");
  container.className = `markdown-body ${extraClass}`.trim();
  container.innerHTML = renderMarkdownToHtml(markdown);
  attachCodeCopyButtons(container);
  return container;
}
