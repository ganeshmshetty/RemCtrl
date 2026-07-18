import { TaskSession } from './task-session.js';

export type AutomationRunKind = 'agent' | 'workflow';

export interface ActiveAutomationRun {
  kind: AutomationRunKind;
  session: TaskSession;
}

let activeRun: ActiveAutomationRun | null = null;

/**
 * Shared lifecycle seam for the single automation run permitted by the app.
 * Agent and workflow implementations retain their own orchestration, while
 * admission, lookup, and stale-run cleanup live in one place.
 */
export function beginAutomationRun(kind: AutomationRunKind, session: TaskSession): void {
  if (activeRun?.session !== session && activeRun?.session.isActive) {
    activeRun.session.cancel();
  }
  activeRun = { kind, session };
}

export function getActiveAutomationRun(): ActiveAutomationRun | null {
  return activeRun;
}

export function getAutomationSession(kind: AutomationRunKind): TaskSession | null {
  return activeRun?.kind === kind ? activeRun.session : null;
}

export function isAutomationRunActive(kind: AutomationRunKind): boolean {
  return activeRun?.kind === kind && activeRun.session.isActive;
}

export function ownsAutomationRun(session: TaskSession): boolean {
  return activeRun?.session === session;
}

export function finishAutomationRun(session: TaskSession): void {
  if (activeRun?.session === session) activeRun = null;
}
