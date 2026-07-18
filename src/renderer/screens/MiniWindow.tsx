/**
 * @file MiniWindow.tsx
 * @description Spotlight-style floating overlay component for quick, minimal keyboard control.
 * Listens for global activation hotkeys via window.RemoteCtrlAPI.on.globalShortcut to focus the text command input.
 * Orchestrates quick execution triggers for the AI agent (via browser.launch/startAgent) and monitors step progress.
 * Synchronizes with useAgentStore to display minimal, live progress cards, current execution step logs, and action states.
 * Connects to main-process application controls to toggle panel visibility or bring the primary UI window into focus.
 * Key exports: MiniWindow (function component).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Square, Sparkles, X } from 'lucide-react';
import { useAgentStore } from '../stores/useAgentStore';
import type { AgentCheckpointPayload } from '../../shared/types';
import './MiniWindow.css';

export function MiniWindow() {
  const [instruction, setInstruction] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activeCheckpoint, setActiveCheckpoint] = useState<AgentCheckpointPayload | null>(null);
  const [activityIndex, setActivityIndex] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleCheckpointSelect = useCallback(async (optionId: string) => {
    if (!activeCheckpoint) return;
    try {
      await window.RemoteCtrlAPI?.browser.submitCheckpoint(activeCheckpoint.checkpointId, {
        selectedOptionId: optionId,
      });
      setActiveCheckpoint(null);
    } catch (err) {
      setErrorMsg(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [activeCheckpoint]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
    }
  }, [instruction]);

  const {
    agentStatus,
    workflowRunState,
    currentAction,
    setActiveCommandId,
    setAgentStatus,
  } = useAgentStore();

  // Focus and Electron IPC listeners setup
  useEffect(() => {
    inputRef.current?.focus();

    const unsubs = [
      window.RemoteCtrlAPI?.on?.globalShortcut?.(() => inputRef.current?.focus()),
      window.RemoteCtrlAPI?.on?.agentCheckpoint?.((payload) => {
        setActiveCheckpoint(payload);
      }),
      window.RemoteCtrlAPI?.on?.agentStatus?.((payload) => {
        if (payload.state === 'completed' || payload.state === 'failed' || payload.state === 'cancelled') {
          setActiveCheckpoint(null);
        }
      }),
    ];

    return () => {
      unsubs.forEach((u) => u && u());
    };
  }, []);

  // Make the html and body transparent for the mini window
  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    return () => {
      document.documentElement.style.background = '';
      document.body.style.background = '';
    };
  }, []);

  // Handle click-through on transparent areas
  useEffect(() => {
    let lastIgnore = false;
    const handleMouseMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const shouldIgnore = el ? el.classList.contains('mini-window-root') : true;
      
      if (shouldIgnore !== lastIgnore) {
        lastIgnore = shouldIgnore;
        window.RemoteCtrlAPI?.app.setIgnoreMouseEvents(shouldIgnore);
      }
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  // Keyboard navigation shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        window.RemoteCtrlAPI?.app.hideMiniWindow();
        return;
      }
      
      // Support number keys selection for Checkpoint options
      if (activeCheckpoint) {
        const num = parseInt(e.key, 10);
        if (!isNaN(num) && num >= 1 && num <= activeCheckpoint.options.length) {
          handleCheckpointSelect(activeCheckpoint.options[num - 1].id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeCheckpoint, handleCheckpointSelect]);

  const isRunning =
    agentStatus === 'running' ||
    workflowRunState === 'running';

  const activityCopy = miniActivityCopy(currentAction, workflowRunState === 'running');

  useEffect(() => {
    if (!isRunning || activityCopy.length < 2) return;
    const interval = window.setInterval(() => setActivityIndex((index) => (index + 1) % activityCopy.length), 2200);
    return () => window.clearInterval(interval);
  }, [isRunning, currentAction, workflowRunState, activityCopy.length]);

  const handleRunAgent = async () => {
    if (!instruction.trim() || isRunning) return;
    const text = instruction.trim();
    setInstruction('');
    setErrorMsg(null);

    const commandId = crypto.randomUUID();
    useAgentStore.getState().startNewExecution('agent', commandId, text);
    try {
      await window.RemoteCtrlAPI?.browser.launch();
      const result = await window.RemoteCtrlAPI?.browser.startAgent({
        commandId,
        action: 'act',
        instruction: text,
        executionMode: 'local',
      });
      if (!result?.ok) throw new Error(result?.error ?? 'Unable to start the agent.');
      setActiveCommandId(commandId);
      setAgentStatus('running');
    } catch (err) {
      setAgentStatus('idle');
      setErrorMsg(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleStop = async () => {
    if (agentStatus === 'running') {
      window.RemoteCtrlAPI?.browser.cancelAgent();
    }
    if (workflowRunState === 'running') {
      window.RemoteCtrlAPI?.browser.cancelWorkflow();
    }
  };

  const handleHideMini = () => {
    window.RemoteCtrlAPI?.app.hideMiniWindow();
  };

  return (
    <div className="mini-window-root">
      <div className="mini-window-content">
        {/* Checkpoint HUD (Interactive user input prompt) */}
        {isRunning && activeCheckpoint && (
          <div className="mini-checkpoint-hud animate-fade-in drag-region">
            <div className="mini-checkpoint-title no-drag">Agent Needs Input</div>
            <div className="mini-checkpoint-question no-drag">{activeCheckpoint.question}</div>
            <div className="mini-checkpoint-options no-drag">
              {activeCheckpoint.options.map((opt, idx) => (
                <button
                  key={opt.id}
                  className={`mini-checkpoint-option no-drag ${opt.recommended ? 'recommended' : ''}`}
                  onClick={() => handleCheckpointSelect(opt.id)}
                >
                  <div className="mini-checkpoint-option-label no-drag">
                    <span className="mini-checkpoint-key-hint no-drag">{idx + 1}</span> {opt.label}
                  </div>
                  {opt.description && (
                    <div className="mini-checkpoint-option-desc no-drag">{opt.description}</div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Progress / Status HUD when running */}
        {isRunning && !activeCheckpoint && (
          <div className="mini-status-hud animate-fade-in drag-region">
            <div className="mini-status-info no-drag">
              <span className="mini-status-text">
                {activityCopy[activityIndex % activityCopy.length]}
              </span>
            </div>
            {currentAction && currentAction !== 'Initializing agent...' && (
              <div className="mini-current-activity no-drag">{currentAction}</div>
            )}
          </div>
        )}

        {errorMsg && (
          <div className="mini-error-banner drag-region">
            <span className="no-drag">{errorMsg}</span>
          </div>
        )}

        {/* Search Input Bar (acts as window drag region except for controls) */}
        <div className="mini-input-bar drag-region">
          <span className="mini-logo-icon"><Sparkles size={15} /></span>
          <textarea
            ref={inputRef}
            className="mini-prompt-input no-drag"
            placeholder="What would you like to automate?..."
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault(); // Prevent newline
                handleRunAgent();
              }
            }}
            disabled={isRunning}
            rows={1}
          />
          
          {/* Compact action buttons embedded in the input bar */}
          <div className="mini-input-actions no-drag">
            {isRunning ? (
              <button className="mini-action-btn stop no-drag" onClick={handleStop} title="Stop Agent">
                <Square size={14} className="no-drag" />
              </button>
            ) : (
              <button
                className="mini-action-btn run no-drag"
                onClick={handleRunAgent}
                disabled={!instruction.trim()}
                title="Run Agent (Enter)"
              >
                <Play size={14} className="no-drag" />
              </button>
            )}
            
            <button className="mini-action-btn close no-drag" onClick={handleHideMini} title="Close (Esc)">
              <X size={15} className="no-drag" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function miniActivityCopy(action: string | null, workflow: boolean): string[] {
  const value = action?.toLowerCase() ?? '';
  if (workflow) return ['Running the workflow…', 'Working through the next step…', 'Checking the workflow result…'];
  if (/read|observ|analy|extract/.test(value)) return ['Reading the page…', 'Thinking through the information…', 'Working out the next step…'];
  if (/find|look|search|navig|open/.test(value)) return ['Finding the right place…', 'Looking for the next control…', 'Working through the page…'];
  if (/enter|typ|fill|select/.test(value)) return ['Working on the requested details…', 'Entering the information…', 'Checking the next step…'];
  if (/check|verif|confirm/.test(value)) return ['Checking the result…', 'Verifying the page state…', 'Thinking through the outcome…'];
  return ['Thinking…', 'Working…', 'Preparing the next step…'];
}
