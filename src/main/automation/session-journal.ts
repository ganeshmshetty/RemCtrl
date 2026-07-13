/**
 * @file session-journal.ts
 * @description Implements JSONL-backed event journaling for agent-user sessions to support time-travel rewind capabilities and workflow export pipelines.
 * Key Exported APIs: `DiskJournalAdapter` class implementing the `SessionJournal` interface, types `AgentStepSnapshot`, `UserMessageSnapshot`, and `JournalSnapshot`.
 * Internal Mechanics: Writes execution snapshots sequentially to a JSONL file in the Electron user data directory. Supports reloading snapshot logs from disk, appending user message/agent tool steps, and slicing history (rewinding) to restore the journal to a previous state.
 * Workflow Extraction: Transforms captured agent tool inputs (like 'goto', 'act', 'keys', and 'extract') into structured, runnable `LocalWorkflow` schema steps (like click, fill, navigate).
 */

import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { LocalWorkflow, WorkflowStep } from '../../shared/types.js';

// ─── Interfaces (The Seam) ─────────────────────────────────────────────

export interface AgentStepSnapshot {
  id: string;
  timestamp: number;
  type: 'agent_step';
  toolName: string;
  input: any;
  result: any;
  domHash?: string; // For future Zero-LLM Caching
  summary: string;
}

export interface UserMessageSnapshot {
  id: string;
  timestamp: number;
  type: 'user_message';
  text: string;
}

export type JournalSnapshot = AgentStepSnapshot | UserMessageSnapshot;

export interface SessionJournal {
  id: string;
  recordUserMessage(text: string): Promise<string>;
  recordAgentStep(toolName: string, input: any, result: any, summary: string): Promise<string>;
  rewindTo(snapshotId: string): Promise<void>;
  extractWorkflow(sinceSnapshotId?: string): LocalWorkflow;
  getHistory(): JournalSnapshot[];
}

// ─── Implementation (The Depth) ───────────────────────────────────────

export class DiskJournalAdapter implements SessionJournal {
  public readonly id: string;
  private filePath: string;
  private snapshots: JournalSnapshot[] = [];

  constructor(sessionId?: string) {
    this.id = sessionId || randomUUID();
    const userDataPath = app.getPath('userData');
    const journalsDir = path.join(userDataPath, 'sessions');
    if (!fs.existsSync(journalsDir)) {
      fs.mkdirSync(journalsDir, { recursive: true });
    }
    this.filePath = path.join(journalsDir, `${this.id}.jsonl`);
    this.loadFromDisk();
  }

  private loadFromDisk() {
    if (!fs.existsSync(this.filePath)) return;
    const content = fs.readFileSync(this.filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim() !== '');
    this.snapshots = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        this.snapshots.push(parsed);
      } catch (err) {
        console.warn(`[Journal] Skipping malformed JSONL line in session ${this.id}: ${line}. Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private async appendToDisk(snapshot: JournalSnapshot) {
    await fs.promises.appendFile(this.filePath, JSON.stringify(snapshot) + '\n', 'utf-8');
  }

  private async rewriteDisk() {
    const tempPath = this.filePath + '.tmp';
    const lines = this.snapshots.map(s => JSON.stringify(s)).join('\n') + (this.snapshots.length > 0 ? '\n' : '');
    try {
      await fs.promises.writeFile(tempPath, lines, 'utf-8');
      await fs.promises.rename(tempPath, this.filePath);
    } catch (err) {
      try {
        if (fs.existsSync(tempPath)) {
          await fs.promises.unlink(tempPath);
        }
      } catch {}
      throw err;
    }
  }

  async recordUserMessage(text: string): Promise<string> {
    const snapshot: UserMessageSnapshot = {
      id: randomUUID(),
      timestamp: Date.now(),
      type: 'user_message',
      text
    };
    this.snapshots.push(snapshot);
    await this.appendToDisk(snapshot);
    return snapshot.id;
  }

  async recordAgentStep(toolName: string, input: any, result: any, summary: string): Promise<string> {
    const snapshot: AgentStepSnapshot = {
      id: randomUUID(),
      timestamp: Date.now(),
      type: 'agent_step',
      toolName,
      input,
      result,
      summary
    };
    this.snapshots.push(snapshot);
    await this.appendToDisk(snapshot);
    return snapshot.id;
  }

  async rewindTo(snapshotId: string): Promise<void> {
    const idx = this.snapshots.findIndex(s => s.id === snapshotId);
    if (idx === -1) throw new Error(`Snapshot ${snapshotId} not found`);
    // Keep everything UP TO AND INCLUDING the target snapshot
    this.snapshots = this.snapshots.slice(0, idx + 1);
    await this.rewriteDisk();
  }

  getHistory(): JournalSnapshot[] {
    return [...this.snapshots];
  }

  extractWorkflow(sinceSnapshotId?: string): LocalWorkflow {
    let stepsToProcess = this.snapshots.filter(s => s.type === 'agent_step') as AgentStepSnapshot[];
    if (sinceSnapshotId) {
      const idx = this.snapshots.findIndex(s => s.id === sinceSnapshotId);
      if (idx !== -1) {
        stepsToProcess = this.snapshots.slice(idx).filter(s => s.type === 'agent_step') as AgentStepSnapshot[];
      }
    }

    const workflowSteps: WorkflowStep[] = [];
    
    for (const actionInfo of stepsToProcess) {
      const finalInput = { ...actionInfo.input };
      // Similar to agent-loop's translation logic
      let workflowStep: any = null;
      const id = actionInfo.id; // Use snapshot ID as step ID
      const description = finalInput.description || actionInfo.summary;

      if (actionInfo.toolName === 'goto' && finalInput.url) {
        workflowStep = { id, type: 'navigate', url: finalInput.url, onFailure: 'stop' };
      } else if (actionInfo.toolName === 'act' && finalInput.selector && finalInput.selector.trim() !== '') {
        const action = finalInput.action;
        if (action === 'click') {
          workflowStep = { id, type: 'click', selector: finalInput.selector, description, onFailure: 'self_heal' };
        } else if (action === 'fill') {
          workflowStep = { id, type: 'fill', selector: finalInput.selector, value: finalInput.value || '', description, onFailure: 'self_heal' };
        } else if (action === 'select') {
          workflowStep = { id, type: 'select', selector: finalInput.selector, value: finalInput.value || '', description, onFailure: 'self_heal' };
        } else if (action === 'check') {
          workflowStep = { id, type: 'click', selector: finalInput.selector, description: description || `Check ${finalInput.selector}`, onFailure: 'self_heal' };
        } else if (action === 'press') {
          workflowStep = { id, type: 'keypress', key: finalInput.value || 'Enter', onFailure: 'skip' };
        } else if (action === 'uncheck' || action === 'focus' || action === 'hover') {
          workflowStep = { id, type: 'click', selector: finalInput.selector, description: description || `${action} on ${finalInput.selector}`, onFailure: 'self_heal' };
        }
      } else if (actionInfo.toolName === 'keys' && finalInput.key) {
        workflowStep = { id, type: 'keypress', key: finalInput.key, onFailure: 'skip' };
      } else if (actionInfo.toolName === 'extract') {
        const instruction = finalInput.instruction || `Extract text from ${finalInput.selector || 'page'} (limit: ${finalInput.limit || 8000})`;
        workflowStep = { id, type: 'extract', instruction, onFailure: 'skip' };
      }

      if (workflowStep) {
        workflowSteps.push(workflowStep as WorkflowStep);
      }
    }

    return {
      id: this.id,
      name: `Workflow from Session ${this.id.substring(0, 8)}`,
      steps: workflowSteps,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }
}
