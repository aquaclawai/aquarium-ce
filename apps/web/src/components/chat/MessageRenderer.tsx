import { MarkdownContent } from './MarkdownContent.js';
import { ThinkingBlock } from './ThinkingBlock.js';
import { ToolCallBlock } from './ToolCallBlock.js';
import type { ToolUseBlock, ToolResultBlock } from './ToolCallBlock.js';

/* ─── Content Block Types ─── */

interface TextBlock {
  type: 'text' | 'output_text' | 'input_text';
  text: string;
}

interface ImageBlock {
  type: 'image';
  mimeType?: string;
  content?: string;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

interface ImageUrlBlock {
  type: 'image_url';
  image_url: {
    url: string;
  };
}

function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

interface FileBlock {
  type: 'file';
  mimeType?: string;
  content?: string;
  fileName?: string;
}

interface ThinkingBlockType {
  type: 'thinking';
  thinking: string;
  signature?: string;
}

type ContentBlock =
  | TextBlock
  | ImageBlock
  | ImageUrlBlock
  | FileBlock
  | ThinkingBlockType
  | ToolUseBlock
  | ToolResultBlock;

/* ─── Helpers ─── */

/** Regex to strip [[reply_to_current]] and [[reply_to:<id>]] directive tags */
const REPLY_TAG_RE = /\[\[\s*(?:reply_to_current|reply_to\s*:\s*[^\]\n]+)\s*\]\]/gi;

function cleanText(text: string): string {
  return text.replace(REPLY_TAG_RE, '').trim();
}

/**
 * Parse raw message content into an array of typed content blocks.
 * Handles: plain string, array of blocks, single object with text/content.
 */
function parseContentBlocks(content: unknown): ContentBlock[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }

  if (Array.isArray(content)) {
    return content.filter(
      (item): item is ContentBlock =>
        item != null &&
        typeof item === 'object' &&
        typeof (item as Record<string, unknown>).type === 'string',
    );
  }

  if (content && typeof content === 'object') {
    const c = content as Record<string, unknown>;
    if (typeof c.text === 'string') {
      return [{ type: 'text', text: c.text }];
    }
    if (typeof c.content === 'string') {
      return [{ type: 'text', text: c.content }];
    }
  }

  return [];
}

/* ─── Component ─── */

interface MessageRendererProps {
  content: unknown;
  isStreaming?: boolean;
}

/**
 * Content block dispatcher for message rendering.
 * Maps content blocks to the appropriate leaf component:
 * - text / output_text / input_text -> MarkdownContent
 * - thinking -> ThinkingBlock
 * - tool_use -> ToolCallBlock (paired with matching tool_result if present)
 * - tool_result -> ToolCallBlock (only if orphaned; otherwise rendered with its tool_use)
 */
export function MessageRenderer({ content, isStreaming }: MessageRendererProps) {
  const blocks = parseContentBlocks(content);

  if (blocks.length === 0) {
    return null;
  }

  // Build a set of tool_use IDs and a map of tool_result by tool_use_id
  // so we can pair them and avoid double-rendering tool_results.
  const toolResultMap = new Map<string, ToolResultBlock>();
  const renderedToolResultIds = new Set<string>();

  for (const block of blocks) {
    if (block.type === 'tool_result') {
      toolResultMap.set(block.tool_use_id, block);
    }
  }

  return (
    <>
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'text':
          case 'output_text':
          case 'input_text': {
            const cleaned = cleanText(block.text);
            if (!cleaned) return null;
            return (
              <MarkdownContent key={i} text={cleaned} isStreaming={isStreaming} />
            );
          }

          case 'image': {
            const mimeType = block.mimeType ?? block.source?.media_type ?? '';
            if (mimeType && !isImageMime(mimeType)) {
              return (
                <div key={i} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)',
                  padding: 'var(--space-2) var(--space-3)',
                  background: 'var(--color-surface-hover)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  marginTop: 'var(--space-2)',
                  fontSize: '0.85rem',
                  color: 'var(--color-text)',
                }}>
                  <span style={{ opacity: 0.7 }}>
                    {mimeType.includes('pdf') ? 'PDF' :
                     mimeType.includes('spreadsheet') || mimeType.includes('ms-excel') ? 'XLS' :
                     mimeType.includes('wordprocessingml') || mimeType.includes('msword') ? 'DOC' : 'FILE'}
                  </span>
                  {(block as { fileName?: string }).fileName && (
                    <span style={{ color: 'var(--color-text-secondary)' }}>
                      {(block as { fileName?: string }).fileName}
                    </span>
                  )}
                </div>
              );
            }
            const imgSrc = block.mimeType && block.content
              ? `data:${block.mimeType};base64,${block.content}`
              : block.source?.type === 'base64'
                ? `data:${block.source.media_type};base64,${block.source.data}`
                : null;
            if (!imgSrc) return null;
            return (
              <img
                key={i}
                src={imgSrc}
                alt="Attachment"
                style={{
                  maxWidth: '100%',
                  maxHeight: '300px',
                  borderRadius: 'var(--radius-md)',
                  marginTop: 'var(--space-2)',
                  marginBottom: 'var(--space-2)',
                  border: '1px solid var(--color-border)',
                  display: 'block',
                }}
              />
            );
          }

          case 'image_url':
            return (
              <img
                key={i}
                src={block.image_url.url}
                alt="Attachment"
                style={{
                  maxWidth: '100%',
                  maxHeight: '300px',
                  borderRadius: 'var(--radius-md)',
                  marginTop: 'var(--space-2)',
                  marginBottom: 'var(--space-2)',
                  border: '1px solid var(--color-border)',
                  display: 'block',
                }}
              />
            );

          case 'file': {
            const fileMime = block.mimeType ?? '';
            const typeLabel =
              fileMime.includes('pdf') ? 'PDF' :
              fileMime.includes('spreadsheet') || fileMime.includes('ms-excel') ? 'XLS' :
              fileMime.includes('wordprocessingml') || fileMime.includes('msword') ? 'DOC' : 'FILE';
            return (
              <div key={i} style={{
                display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)',
                padding: 'var(--space-2) var(--space-3)',
                background: 'var(--color-surface-hover)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                marginTop: 'var(--space-2)',
                fontSize: '0.85rem',
                color: 'var(--color-text)',
              }}>
                <span style={{ opacity: 0.7 }}>{typeLabel}</span>
                {block.fileName && (
                  <span style={{ color: 'var(--color-text-secondary)' }}>{block.fileName}</span>
                )}
              </div>
            );
          }

          case 'thinking':
            return <ThinkingBlock key={i} content={block.thinking} />;

          case 'tool_use': {
            const matchedResult = toolResultMap.get(block.id);
            if (matchedResult) {
              renderedToolResultIds.add(matchedResult.tool_use_id);
            }
            return (
              <ToolCallBlock
                key={i}
                toolUse={block}
                toolResult={matchedResult}
              />
            );
          }

          case 'tool_result': {
            // Skip if already rendered alongside its tool_use
            if (renderedToolResultIds.has(block.tool_use_id)) {
              return null;
            }
            // Orphaned tool_result (no matching tool_use in blocks)
            return <ToolCallBlock key={i} toolResult={block} />;
          }

          default:
            return null;
        }
      })}
    </>
  );
}
