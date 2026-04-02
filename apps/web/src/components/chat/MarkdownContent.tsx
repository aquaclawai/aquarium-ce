import { memo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import remend from 'remend';
import { CodeBlock } from './CodeBlock.js';
import './chat-content.css';

interface MarkdownContentProps {
  text: string;
  isStreaming?: boolean;
}

/**
 * Memoized react-markdown wrapper.
 * Applies remend() during streaming to self-heal incomplete markdown syntax.
 * Uses CodeBlock for syntax-highlighted code blocks with copy button.
 */
export const MarkdownContent = memo(function MarkdownContent({ text, isStreaming }: MarkdownContentProps) {
  const processed = isStreaming ? remend(text) : text;

  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{ pre: CodeBlock }}
    >
      {processed}
    </Markdown>
  );
});
