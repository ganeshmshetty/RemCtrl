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
import { Bot, Zap, MoreHorizontal, Plus } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

export function RightPanelLayout() {
  const { rightPanelTab, setRightPanelTab } = useUIStore();
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
              <button onClick={() => {
                useAgentStore.getState().startNewChat();
                setShowMenu(false);
              }}>
                <Plus size={14} /> New Session
              </button>
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
