export function ThinkingBlock({ content }: { content: string }) {
  return (
    <details className="thinking-block">
      <summary className="thinking-summary">
        <span className="thinking-icon">Thinking</span>
      </summary>
      <div className="thinking-content">{content}</div>
    </details>
  );
}
