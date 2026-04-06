export function ThinkingBlock({ content }: { content: string }) {
  if (!content) return null;
  return (
    <details className="thinking-block">
      <summary className="thinking-summary">
        <span className="thinking-icon">Thinking</span>
      </summary>
      <div className="thinking-content">{content}</div>
    </details>
  );
}
