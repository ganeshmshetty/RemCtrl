import { describe, expect, it } from 'vitest';
import { TaskSession } from './task-session.js';
import {
  beginAutomationRun,
  finishAutomationRun,
  getActiveAutomationRun,
  isAutomationRunActive,
} from './run-lifecycle.js';

function fakeSession(): TaskSession {
  let active = true;
  return {
    get isActive() { return active; },
    get isCancelled() { return !active; },
    cancel() { active = false; },
  } as unknown as TaskSession;
}

describe('automation run lifecycle', () => {
  it('admits one active run and cancels the previous session', () => {
    const first = fakeSession();
    beginAutomationRun('agent', first);

    const second = fakeSession();
    beginAutomationRun('workflow', second);

    expect(first.isCancelled).toBe(true);
    expect(isAutomationRunActive('agent')).toBe(false);
    expect(isAutomationRunActive('workflow')).toBe(true);
    expect(getActiveAutomationRun()?.session).toBe(second);

    finishAutomationRun(second);
    expect(getActiveAutomationRun()).toBeNull();
  });
});
