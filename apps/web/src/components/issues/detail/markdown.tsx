import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeHighlight from 'rehype-highlight';

/**
 * UX6 XSS mitigation: centralised sanitized markdown renderer. All Phase 24
 * agent-authored / comment content renders through this wrapper — no direct
 * <ReactMarkdown> usage or raw-HTML injection is permitted under
 * apps/web/src/components/issues/detail/ (grep-enforced invariant — UX6).
 *
 * Schema extends the GitHub-safe defaultSchema by allowing className on
 * <code>/<pre> for rehype-highlight. Scripts, iframes, objects, embeds,
 * forms, and style attributes remain stripped by the default allowlist.
 *
 * Anchor override unconditionally sets target=_blank + rel=noopener
 * noreferrer nofollow (T-24-01-05 mitigation).
 */
const SAFE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code || []), 'className'],
    pre: [...(defaultSchema.attributes?.pre || []), 'className'],
  },
};

interface SafeMarkdownProps {
  children: string;
  className?: string;
}

export function SafeMarkdown({ children, className }: SafeMarkdownProps) {
  // react-markdown v10 dropped the `className` prop on its root element;
  // wrap in a <div> so callers can still style the rendered prose.
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, SAFE_SCHEMA], rehypeHighlight]}
        components={{
          a: ({ href, children: anchorChildren, ...rest }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-[var(--color-primary)] hover:underline"
              {...rest}
            >
              {anchorChildren}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
