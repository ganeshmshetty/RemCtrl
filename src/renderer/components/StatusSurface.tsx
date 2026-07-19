import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import './StatusSurface.css';

interface StatusSurfaceProps {
  message: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
  role?: 'alert' | 'status';
}

export function StatusSurface({
  message,
  actionLabel,
  onAction,
  className = '',
  role = 'alert',
}: StatusSurfaceProps) {
  return (
    <div className={`status-surface ${className}`.trim()} role={role} aria-live={role === 'alert' ? 'assertive' : 'polite'}>
      <CircleAlert size={14} aria-hidden="true" />
      <span className="status-surface-message">{message}</span>
      {actionLabel && onAction && (
        <button type="button" className="status-surface-action" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
