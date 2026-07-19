/**
 * @file ConnectionPlaceholder.tsx
 * @description Main dashboard interface displayed to users when the active session role is 'idle'.
 * Serves as the primary landing page offering quick-start controls for local browser session activation, hosting a screen share (Host mode), or inputting a remote PIN (Controller mode).
 * Features a workflow registry displaying available saved workflows, allowing immediate automated playback on the local browser.
 * Integrates with Zustand stores (useConnectionStore, useWorkflowStore, useAgentStore, useUIStore) and delegates system-level commands to RemoteCtrlAPI.
 * Key exports: ConnectionPlaceholder (function component).
 */

import { useEffect, useState } from 'react';
import { Zap, Play, Radio, FolderPlus, ArrowRight, MonitorPlay, ListChecks, Link2, ShieldCheck, LockKeyhole, Sparkles, MousePointer2 } from 'lucide-react';
import { useConnectionStore } from '../stores/useConnectionStore';
import { useWorkflowStore } from '../stores/useWorkflowStore';
import { useUIStore } from '../stores/useUIStore';
import { useAgentStore } from '../stores/useAgentStore';
import type { LocalWorkflow } from '../../shared/types';
import { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } from '@/components/ui/input-otp';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import './ConnectionPlaceholder.css';

export function ConnectionPlaceholder() {
  const [selectedMode, setSelectedMode] = useState<'local' | 'workflows' | 'remote'>('local');
  const [remoteAction, setRemoteAction] = useState<'host' | 'join'>('host');
  const [pinInput, setPinInput] = useState('');
  const [sessionIntent, setSessionIntent] = useState('');
  const [trustedMode, setTrustedMode] = useState(false);
  const [workflowTask, setWorkflowTask] = useState('');
  const { setRole, setTrustedHost } = useConnectionStore();
  const { workflows, loadWorkflows } = useWorkflowStore();
  const { setRightPanelTab, openWorkflowRun } = useUIStore();

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  useEffect(() => {
    return window.RemoteCtrlAPI?.on.workflowCreated(() => {
      void loadWorkflows();
    });
  }, [loadWorkflows]);

  function handleLocal() {
    setRole('local');
    window.RemoteCtrlAPI?.browser.launch();
    window.RemoteCtrlAPI?.app.showMiniWindow(true);
  }

  async function handleRecordWorkflow() {
    const description = workflowTask.trim();
    if (description.length < 8) return;
    setRole('local');
    const recording = await window.RemoteCtrlAPI?.browser.startWorkflowRecording({ initialInstruction: description });
    if (!recording?.ok || !recording.state) {
      alert(recording?.error ?? 'Unable to start workflow recording.');
      return;
    }
    useAgentStore.getState().setRecordingState({
      recordingState: 'recording',
      recordingSessionId: recording.state.id,
      recordingTask: recording.state.initialInstruction,
      recordingStepCount: recording.state.capturedStepCount,
      recordingError: null,
    });
    try {
      await window.RemoteCtrlAPI?.browser.launchRecording();
      const commandId = crypto.randomUUID();
      useAgentStore.getState().startNewExecution('agent', commandId, description);
      const result = await window.RemoteCtrlAPI?.browser.startAgent({
        commandId,
        action: 'act',
        instruction: description,
        executionMode: 'local',
        recordingSessionId: recording.state.id,
      });
      if (!result?.ok) throw new Error(result?.error ?? 'Unable to start recording agent.');
      setRightPanelTab('agent');
      setWorkflowTask('');
    } catch (error) {
      await window.RemoteCtrlAPI?.browser.discardWorkflowRecording();
      useAgentStore.getState().clearRecordingState();
      alert(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleQuickRunWorkflow(workflow: LocalWorkflow) {
    setRole('local');
    try {
      await window.RemoteCtrlAPI?.browser.launch();
    } catch (err) {
      setRole('idle');
      alert(`Failed to launch browser: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    const workflowRunId = crypto.randomUUID();
    useAgentStore.getState().startNewExecution('workflow', workflowRunId, workflow.name);
    openWorkflowRun(workflow, workflowRunId);

    try {
      const res = await window.RemoteCtrlAPI?.browser.startWorkflow({
        workflowRunId,
        workflowId: workflow.id,
        name: workflow.name,
        steps: workflow.steps,
      });
      if (res && res.ok) {
        setRightPanelTab('workflows');
      } else {
        useUIStore.getState().clearWorkflowRun();
        alert(`Failed to start workflow: ${res?.error || 'Unknown error'}`);
      }
    } catch (err) {
      useUIStore.getState().clearWorkflowRun();
      alert(`Failed to start workflow: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function handleHost() {
    setRole('host');
    setTrustedHost(trustedMode);
    window.RemoteCtrlAPI?.host.start({ trusted: trustedMode });
  }

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = pinInput.replace(/\D/g, '');
    if (cleaned.length === 9 && sessionIntent.trim().length >= 8) {
      setRole('controller');
      window.RemoteCtrlAPI?.controller.connect(cleaned, sessionIntent.trim());
    }
  }

  return (
    <div className="connection-placeholder">
      <h2 className="cp-title">Start Automating</h2>
      <p className="cp-subtitle">
        Choose how you want to work. You can change modes at any time.
      </p>

      <div className="cp-mode-picker" aria-label="Choose a session mode">
        <Button type="button" variant="outline" className={`cp-mode-option ${selectedMode === 'local' ? 'is-selected' : ''}`} aria-pressed={selectedMode === 'local'} onClick={() => setSelectedMode('local')}>
          <MonitorPlay size={18} /><span><strong>Local</strong><small>Use this computer</small></span>
        </Button>
        <Button type="button" variant="outline" className={`cp-mode-option ${selectedMode === 'workflows' ? 'is-selected' : ''}`} aria-pressed={selectedMode === 'workflows'} onClick={() => setSelectedMode('workflows')}>
          <ListChecks size={18} /><span><strong>Workflows</strong><small>Run repeatable tasks</small></span>
        </Button>
        <Button type="button" variant="outline" className={`cp-mode-option ${selectedMode === 'remote' ? 'is-selected' : ''}`} aria-pressed={selectedMode === 'remote'} onClick={() => setSelectedMode('remote')}>
          <Link2 size={18} /><span><strong>Remote</strong><small>Share or control a session</small></span>
        </Button>
      </div>

      {selectedMode === 'local' && (
        <Card className="cp-mode-panel">
          <CardContent className="cp-panel-content cp-local-panel">
            <div className="cp-local-copy">
              <div className="cp-panel-eyebrow"><MonitorPlay size={14} /> Local automation</div>
              <h3>Automate from your authenticated browser</h3>
              <p>Let the agent complete a task in your existing browser session. You can take control at any time.</p>
              <Button size="lg" className="cp-primary-action" onClick={handleLocal}><Zap size={17} /> Start local session</Button>
            </div>
            <div className="cp-local-guide" aria-label="What happens in a local session">
              <div><LockKeyhole size={17} /><span><strong>Your session stays private</strong><small>Use the browser profile you already trust.</small></span></div>
              <div><Sparkles size={17} /><span><strong>Give the agent a task</strong><small>Watch semantic, step-by-step activity as it works.</small></span></div>
              <div><MousePointer2 size={17} /><span><strong>Take control whenever needed</strong><small>Pause the agent and interact directly.</small></span></div>
            </div>
          </CardContent>
        </Card>
      )}

      {selectedMode === 'workflows' && (
        <Card className="cp-mode-panel">
          <CardContent className="cp-panel-content">
            <div className="cp-workflow-layout">
              <section className="cp-workflow-create">
                <div className="cp-panel-heading"><div><h3>Build a workflow</h3><p>Describe a task once. The agent records and validates a reusable workflow.</p></div></div>
                <div className="cp-workflow-recorder">
                  <Textarea
                    className="cp-workflow-task-input"
                    value={workflowTask}
                    onChange={(event) => setWorkflowTask(event.target.value)}
                    placeholder="Describe a task to record"
                    rows={2}
                  />
                  <div className="cp-workflow-composer-footer">
                    <span className="cp-workflow-composer-hint">The agent will capture each browser step.</span>
                    <Button size="sm" className="cp-record-workflow" onClick={() => void handleRecordWorkflow()} disabled={workflowTask.trim().length < 8}>Record workflow</Button>
                  </div>
                </div>
              </section>
              <section className="cp-workflow-library">
                <div className="cp-panel-heading"><div><h3>Saved workflows</h3><p>Preview and approve a workflow before every run.</p></div><span>{workflows.length} saved</span></div>
                {workflows.length > 0 ? (
                  <div className="cp-workflow-list">
                    {workflows.slice(0, 3).map((wf) => (
                      <Card key={wf.id} className="cp-workflow-card"><CardContent className="cp-workflow-card-content"><div><div className="truncate cp-workflow-name">{wf.name}</div><div className="cp-workflow-meta">{wf.steps.length} step{wf.steps.length === 1 ? '' : 's'}</div></div><Button size="sm" variant="ghost" className="cp-run-workflow" onClick={() => handleQuickRunWorkflow(wf)}><Play size={13} /> Run</Button></CardContent></Card>
                    ))}
                    {workflows.length > 3 && <span className="cp-workflow-more">Showing 3 of {workflows.length} saved workflows</span>}
                  </div>
                ) : (
                  <div className="cp-empty-workflows"><FolderPlus size={22} /><strong>No saved workflows</strong><span>Describe a task to record your first one.</span></div>
                )}
              </section>
            </div>
          </CardContent>
        </Card>
      )}

      {selectedMode === 'remote' && (
        <Card className="cp-mode-panel">
          <CardContent className="cp-panel-content">
            <div className="cp-remote-layout">
              <aside className="cp-remote-nav">
                <div><h3>Remote access</h3><p>Choose how you want to participate.</p></div>
                <div className="cp-remote-actions">
                  <Button type="button" variant="outline" className={`cp-remote-choice ${remoteAction === 'host' ? 'is-selected' : ''}`} onClick={() => setRemoteAction('host')}><Radio size={16} /> Host a session</Button>
                  <Button type="button" variant="outline" className={`cp-remote-choice ${remoteAction === 'join' ? 'is-selected' : ''}`} onClick={() => setRemoteAction('join')}><Link2 size={16} /> Connect with PIN</Button>
                </div>
              </aside>
              <section className="cp-remote-config">
                {remoteAction === 'host' ? (
                  <div className="cp-remote-detail"><div><h4>Share this browser</h4><p>Approve the controller and their stated task before the session starts.</p></div><label className="cp-trusted-toggle"><Switch checked={trustedMode} onCheckedChange={setTrustedMode} aria-label="Enable trusted controller mode" className="data-[state=checked]:bg-[var(--accent)]" /><span><strong>Trusted controller</strong><small>Remote actions run without scope gates</small></span></label><Button className="cp-primary-action" onClick={handleHost}>Host browser session <ArrowRight size={15} /></Button></div>
                ) : (
                  <form onSubmit={handleJoin} className="cp-pin-form"><div><h4>Connect to a host</h4><p>Enter the host PIN and explain the task you want to complete.</p></div><InputOTP maxLength={9} value={pinInput} onChange={setPinInput}><InputOTPGroup><InputOTPSlot index={0} /><InputOTPSlot index={1} /><InputOTPSlot index={2} /></InputOTPGroup><InputOTPSeparator /><InputOTPGroup><InputOTPSlot index={3} /><InputOTPSlot index={4} /><InputOTPSlot index={5} /></InputOTPGroup><InputOTPSeparator /><InputOTPGroup><InputOTPSlot index={6} /><InputOTPSlot index={7} /><InputOTPSlot index={8} /></InputOTPGroup></InputOTP><Textarea value={sessionIntent} onChange={(event) => setSessionIntent(event.target.value)} placeholder="Describe what you want to do in this session" rows={3} className="cp-intent-input" /><Button type="submit" className="w-full" variant={pinInput.length === 9 ? 'default' : 'secondary'} disabled={pinInput.length !== 9 || sessionIntent.trim().length < 8}>Request connection <ArrowRight size={14} className="ml-2" /></Button></form>
                )}
              </section>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
