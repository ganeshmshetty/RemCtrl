import { RightPanelLayout } from './RightPanelLayout';
import { WorkflowEditorModal } from './WorkflowEditorModal';
import { useConnectionStore } from '../stores/useConnectionStore';

export function LocalSession() {
  function handleStop() {
    useConnectionStore.getState().reset();
    window.RemoteCtrlAPI?.browser.close();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      <div style={{ 
        padding: '12px 24px', 
        borderBottom: '1px solid var(--border)', 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        background: 'var(--bg-secondary)'
      }}>
        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
          Local Browser Session Active
        </div>
        <button className="btn btn-ghost" onClick={handleStop} style={{ color: 'var(--danger)' }}>
          Stop Session
        </button>
      </div>
      
      {/* Container for the panels */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <RightPanelLayout />
      </div>

      <WorkflowEditorModal />
    </div>
  );
}
