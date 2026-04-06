import { useState, useEffect, useCallback, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui';
import { Button } from '@/components/ui';
import './ExecApprovalDialog.css';

export interface ExecApprovalItem {
  approvalId: string;
  command: string;
  args?: string[];
  workDir?: string;
  requestedAt: string;
  timeoutMs: number;
}

interface ExecApprovalDialogProps {
  items: ExecApprovalItem[];
  onApprove: (approvalId: string) => void;
  onDeny: (approvalId: string) => void;
}

function getRemainingMs(item: ExecApprovalItem): number {
  const deadline = new Date(item.requestedAt).getTime() + item.timeoutMs;
  return Math.max(0, deadline - Date.now());
}

function formatCommand(item: ExecApprovalItem): string {
  if (item.args?.length) {
    return `${item.command} ${item.args.join(' ')}`;
  }
  return item.command;
}

function ApprovalCard({ item, onApprove, onDeny }: {
  item: ExecApprovalItem;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
}) {
  const [remainingMs, setRemainingMs] = useState(() => getRemainingMs(item));
  const autoDenied = useRef(false);

  useEffect(() => {
    const interval = setInterval(() => {
      const ms = getRemainingMs(item);
      setRemainingMs(ms);
      if (ms <= 0 && !autoDenied.current) {
        autoDenied.current = true;
        onDeny(item.approvalId);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [item, onDeny]);

  const seconds = Math.ceil(remainingMs / 1000);
  const urgent = seconds <= 10;

  return (
    <div className="exec-approval-card">
      <div className="exec-approval-header">
        <span>⚠ Command Execution Request</span>
      </div>
      <div className="exec-approval-command">
        $ {formatCommand(item)}
      </div>
      {item.workDir && (
        <div className="exec-approval-workdir">
          in {item.workDir}
        </div>
      )}
      <div className="exec-approval-footer">
        <span className={`exec-approval-timer${urgent ? ' exec-approval-timer--urgent' : ''}`}>
          {seconds > 0 ? `Auto-deny in ${seconds}s` : 'Expired'}
        </span>
        <div className="exec-approval-actions">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onDeny(item.approvalId)}
          >
            Deny
          </Button>
          <Button
            size="sm"
            onClick={() => onApprove(item.approvalId)}
            disabled={seconds <= 0}
          >
            Approve
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ExecApprovalDialog({ items, onApprove, onDeny }: ExecApprovalDialogProps) {
  const handleApprove = useCallback((id: string) => onApprove(id), [onApprove]);
  const handleDeny = useCallback((id: string) => onDeny(id), [onDeny]);

  return (
    <Dialog open={items.length > 0} onOpenChange={() => { /* controlled by items.length */ }}>
      <DialogContent className="exec-approval-dialog-content">
        <DialogHeader>
          <DialogTitle>Command Execution Approval</DialogTitle>
          <DialogDescription>
            Review and approve or deny pending command execution requests.
          </DialogDescription>
        </DialogHeader>
        <div className="exec-approval-list">
          {items.map(item => (
            <ApprovalCard
              key={item.approvalId}
              item={item}
              onApprove={handleApprove}
              onDeny={handleDeny}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
