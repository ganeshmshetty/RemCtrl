import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Edit3, BookOpen, Loader2 } from 'lucide-react';
import { useWorkflowStore } from '../stores/useWorkflowStore';
import type { LocalWorkflow } from '../../shared/types';

export function WorkflowLibrary() {
  const navigate = useNavigate();
  const { workflows, isLoading, error, loadWorkflows, deleteWorkflow } = useWorkflowStore();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    loadWorkflows();
  }, []);

  async function handleDelete(id: string) {
    await deleteWorkflow(id);
    setConfirmDelete(null);
  }

  return (
    <div className="wl-root">
      <div className="drag-region wl-titlebar" />

      <div className="wl-header no-drag">
        <button className="icon-btn" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} />
        </button>
        <div className="wl-header-title-row">
          <BookOpen size={16} />
          <h1 className="wl-title">Workflow Library</h1>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/workflows/new')}>
          <Plus size={14} />
          New Workflow
        </button>
      </div>

      <div className="wl-body">
        {isLoading ? (
          <div className="wl-empty">
            <Loader2 size={24} className="animate-spin" />
            <span>Loading workflows…</span>
          </div>
        ) : error ? (
          <div className="wl-error">{error}</div>
        ) : workflows.length === 0 ? (
          <div className="wl-empty">
            <BookOpen size={32} style={{ color: 'var(--text-muted)' }} />
            <div className="wl-empty-title">No workflows yet</div>
            <div className="wl-empty-sub">
              Create your first workflow to automate remote browser tasks
            </div>
            <button className="btn btn-primary" onClick={() => navigate('/workflows/new')}>
              <Plus size={14} /> Create Workflow
            </button>
          </div>
        ) : (
          <div className="wl-list">
            {workflows.map((wf) => (
              <WorkflowCard
                key={wf.id}
                workflow={wf}
                onEdit={() => navigate(`/workflows/${wf.id}`)}
                onDelete={() => setConfirmDelete(wf.id)}
                confirmingDelete={confirmDelete === wf.id}
                onConfirmDelete={() => handleDelete(wf.id)}
                onCancelDelete={() => setConfirmDelete(null)}
              />
            ))}
          </div>
        )}
      </div>

      <style>{`
        .wl-root {
          height: 100%;
          display: flex;
          flex-direction: column;
          background: var(--bg-base);
        }
        .wl-titlebar { height: 28px; }
        .wl-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 20px;
          border-bottom: 1px solid var(--border);
        }
        .wl-header-title-row {
          display: flex;
          align-items: center;
          gap: 8px;
          flex: 1;
          color: var(--text-secondary);
        }
        .wl-title {
          font-size: 15px;
          font-weight: 600;
          color: var(--text-primary);
        }
        .wl-body {
          flex: 1;
          overflow-y: auto;
          padding: 20px;
        }
        .wl-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
          max-width: 720px;
        }
        .wl-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          height: 100%;
          color: var(--text-secondary);
          text-align: center;
          padding: 40px;
        }
        .wl-empty-title {
          font-size: 16px;
          font-weight: 600;
          color: var(--text-primary);
        }
        .wl-empty-sub {
          font-size: 13px;
          color: var(--text-muted);
          max-width: 320px;
          line-height: 1.6;
        }
        .wl-error {
          color: var(--danger);
          font-size: 13px;
          padding: 16px;
        }
        .icon-btn {
          display: flex; align-items: center; justify-content: center;
          width: 32px; height: 32px; border-radius: var(--radius-sm);
          border: none; background: transparent; color: var(--text-muted);
          cursor: pointer; transition: color var(--transition), background var(--transition);
        }
        .icon-btn:hover { color: var(--text-primary); background: var(--bg-elevated); }
        .btn {
          display: inline-flex; align-items: center; justify-content: center;
          gap: 6px; height: 32px; padding: 0 12px; border-radius: var(--radius-sm);
          font-size: 12px; font-weight: 600; cursor: pointer; border: none;
          transition: background var(--transition), opacity var(--transition), transform var(--transition);
          white-space: nowrap;
        }
        .btn:active { transform: scale(0.97); }
        .btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .btn-primary { background: var(--accent); color: white; }
        .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
        .btn-ghost { background: transparent; color: var(--text-secondary); }
        .btn-ghost:hover { background: var(--bg-elevated); color: var(--text-primary); }
        .btn-danger { background: var(--danger); color: white; }
        .btn-danger:hover { background: #dc2626; }
      `}</style>
    </div>
  );
}

function WorkflowCard({
  workflow,
  onEdit,
  onDelete,
  confirmingDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  workflow: LocalWorkflow;
  onEdit: () => void;
  onDelete: () => void;
  confirmingDelete: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  return (
    <div className="wc-card">
      <div className="wc-body">
        <div className="wc-name">{workflow.name}</div>
        {workflow.description && (
          <div className="wc-desc">{workflow.description}</div>
        )}
        <div className="wc-meta">
          <span className="badge badge-muted">{workflow.steps.length} step{workflow.steps.length !== 1 ? 's' : ''}</span>
          {workflow.startUrl && (
            <span className="wc-url">{workflow.startUrl}</span>
          )}
        </div>
      </div>

      <div className="wc-actions">
        {confirmingDelete ? (
          <>
            <span className="wc-confirm-text">Delete?</span>
            <button className="btn btn-danger" onClick={onConfirmDelete}>Yes</button>
            <button className="btn btn-ghost" onClick={onCancelDelete}>No</button>
          </>
        ) : (
          <>
            <button className="btn btn-ghost" onClick={onEdit} title="Edit">
              <Edit3 size={13} /> Edit
            </button>
            <button className="btn btn-ghost" onClick={onDelete} title="Delete" style={{ color: 'var(--danger)' }}>
              <Trash2 size={13} />
            </button>
          </>
        )}
      </div>

      <style>{`
        .wc-card {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 16px 20px;
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          transition: border-color var(--transition), background var(--transition);
        }
        .wc-card:hover { border-color: var(--border-active); background: var(--bg-elevated); }
        .wc-body { flex: 1; display: flex; flex-direction: column; gap: 6px; }
        .wc-name { font-size: 14px; font-weight: 600; color: var(--text-primary); }
        .wc-desc { font-size: 12px; color: var(--text-secondary); line-height: 1.4; }
        .wc-meta { display: flex; align-items: center; gap: 8px; }
        .wc-url { font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }
        .wc-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
        .wc-confirm-text { font-size: 12px; color: var(--danger); font-weight: 500; }
        .badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; }
        .badge-muted { background: var(--bg-overlay); color: var(--text-secondary); }
      `}</style>
    </div>
  );
}
