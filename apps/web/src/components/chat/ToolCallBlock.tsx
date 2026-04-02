export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | Array<{ type: string; text?: string }>;
  is_error?: boolean;
}

function extractToolResultText(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((item): item is { type: string; text: string } => typeof item.text === 'string')
      .map((item) => item.text)
      .join('\n');
  }
  return JSON.stringify(content, null, 2);
}

export function ToolCallBlock({ toolUse, toolResult }: { toolUse?: ToolUseBlock; toolResult?: ToolResultBlock }) {
  const name = toolUse?.name ?? 'Unknown Tool';
  const hasError = toolResult?.is_error === true;

  return (
    <details className={`tool-call-block${hasError ? ' tool-call-error' : ''}`}>
      <summary className="tool-call-summary">
        <span className="tool-call-icon">{'\u{1F527}'}</span>
        <span className="tool-call-name">{name}</span>
        {toolResult && (
          <span className="tool-call-status">{hasError ? 'Error' : 'Done'}</span>
        )}
      </summary>
      <div className="tool-call-body">
        {toolUse && (
          <div className="tool-call-section">
            <div className="tool-call-label">Input</div>
            <pre className="tool-call-json">{JSON.stringify(toolUse.input, null, 2)}</pre>
          </div>
        )}
        {toolResult && (
          <div className="tool-call-section">
            <div className="tool-call-label">Output</div>
            <pre className={`tool-call-json${hasError ? ' tool-call-json-error' : ''}`}>
              {extractToolResultText(toolResult.content)}
            </pre>
          </div>
        )}
      </div>
    </details>
  );
}
