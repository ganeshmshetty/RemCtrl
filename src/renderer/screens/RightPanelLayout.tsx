/**
 * @file RightPanelLayout.tsx
 * @description Tabbed layout panel container displayed in the right sidebar of the session views.
 * Provides tab-switching navigation between the interactive AI agent control interface (AgentPanel) and the recorded/deterministic workflows registry (WorkflowsPanel).
 * Utilizes the useUIStore Zustand store to persist the current active tab state (rightPanelTab) and handle tab transitions.
 * Key exports: RightPanelLayout (function component).
 */

import { useUIStore } from '../stores/useUIStore';
import { useAgentStore } from '../stores/useAgentStore';
import { AgentPanel } from './AgentPanel';
import { WorkflowsPanel } from './WorkflowsPanel';
import { Bot, Zap, MoreHorizontal, Plus, History, Trash2 } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

export function RightPanelLayout() {
  const { rightPanelTab, setRightPanelTab } = useUIStore();
  const { recordingState } = useAgentStore();
  const isRecordingLocked = recordingState === 'recording' || recordingState === 'saving';
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    void useAgentStore.getState().loadRunHistory();
  }, []);

  const { runHistory, resumeRunHistory, deleteRunHistory, clearRunHistory } = useAgentStore();

  return (
    <div className="right-panel">
      <div className="right-panel-tabs-container" style={{ position: 'relative' }}>
        <div className="right-panel-tabs">
          <button 
            className={`right-panel-tab ${rightPanelTab === 'agent' ? 'active' : ''}`}
            onClick={() => setRightPanelTab('agent')}
          >
            <Bot size={14} /> Agent
          </button>
          <button 
            className={`right-panel-tab ${rightPanelTab === 'workflows' ? 'active' : ''}`}
            onClick={() => setRightPanelTab('workflows')}
            disabled={isRecordingLocked}
            title={isRecordingLocked ? 'Workflows are unavailable while recording' : 'Workflows'}
          >
            <Zap size={14} /> Workflows
          </button>
        </div>
        
        <div ref={menuRef}>
          <button 
            className="right-panel-menu-btn"
            onClick={() => setShowMenu(!showMenu)}
          >
            <MoreHorizontal size={16} />
          </button>
          
          {showMenu && (
            <div className="right-panel-dropdown">
              <button disabled={isRecordingLocked} onClick={() => {
                useAgentStore.getState().startNewChat();
                setShowMenu(false);
              }}>
                <Plus size={14} /> New Session
              </button>
              {runHistory.length > 0 && <>
                <div className="right-panel-dropdown-label"><History size={13} /> Recent sessions</div>
                <div className="right-panel-history-list">
                  {runHistory.map((item) => (
                    <div className="right-panel-history-item" key={item.id}>
                      <button className="right-panel-history-open" onClick={() => {
                        resumeRunHistory(item);
                        setRightPanelTab('agent');
                        setShowMenu(false);
                      }} title={`Resume ${item.title}`}>
                        <span className={`right-panel-history-status ${item.status}`} />
                        <span className="right-panel-history-copy">
                          <span>{item.title}</span>
                          <small>{new Date(item.endTime ?? item.startTime).toLocaleDateString()}</small>
                        </span>
                      </button>
                      <button className="right-panel-history-delete" onClick={() => void deleteRunHistory(item.id)} title="Remove saved session">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
                <button className="right-panel-history-clear" onClick={() => void clearRunHistory()}>
                  Clear saved sessions
                </button>
              </>}
            </div>
          )}
        </div>
      </div>
      <div className="right-panel-content">
        {rightPanelTab === 'agent' ? <AgentPanel /> : <WorkflowsPanel />}
      </div>
    </div>
  );
}
