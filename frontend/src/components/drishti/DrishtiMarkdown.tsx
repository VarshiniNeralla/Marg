import { Fragment } from 'react';
import { Box, Typography } from '@mui/material';
import { colors } from '@theme/tokens';

interface Props {
  text: string;
  color?: string;
}

/**
 * Renders the small Markdown subset Drishti's LLM answers actually use —
 * **bold**, "## " headings, and "- "/"* " bullet lists — as real React
 * elements instead of literal asterisks/hashes. Deliberately not a full
 * Markdown parser (no links, tables, code blocks): the answer prompt asks
 * for prose plus these three constructs at most, so a small dependency-free
 * renderer covers it without pulling in react-markdown for one component.
 */
export default function DrishtiMarkdown({ text, color }: Props) {
  const textColor = color ?? colors.textStrong;
  const blocks = groupIntoBlocks(text);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      {blocks.map((block, i) => {
        if (block.type === 'heading') {
          return (
            <Typography
              key={i}
              sx={{
                fontSize: block.level <= 2 ? '0.9375rem' : '0.875rem',
                fontWeight: 700, color: textColor, mt: i > 0 ? 0.5 : 0,
              }}
            >
              {renderInline(block.text)}
            </Typography>
          );
        }
        if (block.type === 'list') {
          return (
            <Box key={i} component="ul" sx={{ m: 0, pl: 2.5, display: 'flex', flexDirection: 'column', gap: 0.375 }}>
              {block.items.map((item, j) => (
                <Typography key={j} component="li" sx={{ fontSize: '0.875rem', color: textColor, lineHeight: 1.55 }}>
                  {renderInline(item)}
                </Typography>
              ))}
            </Box>
          );
        }
        return (
          <Typography key={i} sx={{ fontSize: '0.875rem', color: textColor, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
            {renderInline(block.text)}
          </Typography>
        );
      })}
    </Box>
  );
}

type Block =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'list'; items: string[] };

function groupIntoBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraphLines: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length) {
      blocks.push({ type: 'paragraph', text: paragraphLines.join('\n').trim() });
      paragraphLines = [];
    }
  };
  const flushList = () => {
    if (listItems.length) {
      blocks.push({ type: 'list', items: listItems });
      listItems = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const headingMatch = /^(#{1,4})\s+(.*)$/.exec(line);
    const bulletMatch = /^\s*[-*]\s+(.*)$/.exec(line);

    if (headingMatch) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'heading', level: headingMatch[1].length, text: headingMatch[2].trim() });
    } else if (bulletMatch) {
      flushParagraph();
      listItems.push(bulletMatch[1].trim());
    } else if (line.trim() === '') {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraphLines.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** Handles inline **bold** only — the LLM doesn't use italics/links/code in
 * practice, and adding support for them isn't worth the added parsing
 * complexity for a chat answer renderer. */
function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, i) => {
    const boldMatch = /^\*\*([^*]+)\*\*$/.exec(part);
    if (boldMatch) {
      return <Box key={i} component="strong" sx={{ fontWeight: 700 }}>{boldMatch[1]}</Box>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}
