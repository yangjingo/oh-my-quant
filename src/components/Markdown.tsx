import React from "react";
import { Box, Text } from "ink";

interface MarkdownProps {
  content: string;
}

/** Simple Markdown renderer for terminal — supports headings, bold, code, lists */
export function Markdown({ content }: MarkdownProps) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];

  let inCodeBlock = false;
  let codeLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        elements.push(
          <Box key={`code-${i}`} flexDirection="column" marginY={1}>
            {codeLines.map((cl, ci) => (
              <Text key={ci} dimColor>
                {cl}
              </Text>
            ))}
          </Box>,
        );
        codeLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (line === "") {
      elements.push(<Box key={i} height={1} />);
      continue;
    }

    // Heading
    if (line.startsWith("### ")) {
      elements.push(
        <Text key={i} bold>
          {line.slice(4)}
        </Text>,
      );
      continue;
    }
    if (line.startsWith("## ")) {
      elements.push(
        <Text key={i} bold color="cyan">
          {line.slice(3)}
        </Text>,
      );
      continue;
    }
    if (line.startsWith("# ")) {
      elements.push(
        <Text key={i} bold color="cyan">
          {line.slice(2)}
        </Text>,
      );
      continue;
    }

    // List items
    if (line.match(/^[-*]\s/)) {
      elements.push(
        <Text key={i} dimColor>
          {"  • "}
          {renderInline(line.slice(2))}
        </Text>,
      );
      continue;
    }

    // Numbered list
    const numMatch = line.match(/^(\d+)\.\s/);
    if (numMatch) {
      elements.push(
        <Text key={i} dimColor>
          {`  ${numMatch[1]}. `}
          {renderInline(line.slice(numMatch[0].length))}
        </Text>,
      );
      continue;
    }

    // Regular paragraph
    elements.push(<Text key={i}>{renderInline(line)}</Text>);
  }

  // Close any open code block
  if (inCodeBlock && codeLines.length > 0) {
    elements.push(
      <Box key="trailing-code" flexDirection="column" marginY={1}>
        {codeLines.map((cl, ci) => (
          <Text key={ci} dimColor>
            {cl}
          </Text>
        ))}
      </Box>,
    );
  }

  return <Box flexDirection="column">{elements}</Box>;
}

/** Render inline formatting: **bold**, `code` */
function renderInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, (_: string, inner: string) => inner)
    .replace(/`(.+?)`/g, (_: string, inner: string) => inner);
}
