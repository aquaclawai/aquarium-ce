import { useState, type HTMLAttributes, type ReactNode } from 'react';
import React from 'react';
import { useTranslation } from 'react-i18next';

function extractText(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (node == null || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (React.isValidElement(node)) {
    const props = node.props as Record<string, unknown>;
    return extractText(props.children as ReactNode);
  }
  return '';
}

export function CodeBlock(props: HTMLAttributes<HTMLPreElement> & { children?: ReactNode }) {
  const { t } = useTranslation();
  const { children, ...rest } = props;
  const [copied, setCopied] = useState(false);

  function getCodeText(): string {
    const childArray = React.Children.toArray(children);
    for (const child of childArray) {
      if (React.isValidElement(child) && (child.type === 'code' || (child.props as Record<string, unknown>)?.className?.toString().includes('hljs'))) {
        const codeProps = child.props as Record<string, unknown>;
        return extractText(codeProps.children as ReactNode);
      }
    }
    // Fallback: extract text from all children
    return extractText(children);
  }

  function handleCopy() {
    navigator.clipboard.writeText(getCodeText());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="code-block-wrapper">
      <button className="code-copy-btn" onClick={handleCopy}>
        {copied ? t('common.buttons.copied') : t('common.buttons.copy')}
      </button>
      <pre {...rest}>{children}</pre>
    </div>
  );
}
