import { describe, expect, it } from 'vitest';
import { mapAgentToolToWorkflowStep } from './workflow-step-mapper.js';

describe('mapAgentToolToWorkflowStep', () => {
  it('maps replayable element actions and rejects index-only targets', () => {
    expect(mapAgentToolToWorkflowStep({
      id: '1', toolName: 'act', input: { action: 'fill', selector: '#email', value: 'a@b.test' }, summary: 'Fill email',
    })).toMatchObject({ type: 'fill', selector: '#email', value: 'a@b.test', onFailure: 'self_heal' });
    expect(mapAgentToolToWorkflowStep({
      id: '2', toolName: 'act', input: { action: 'click', selector: '[index=2]' }, summary: 'Click item',
    })).toBeNull();
  });

  it('keeps extraction fallback opt-in for journal replay', () => {
    const action = { id: '3', toolName: 'extract', input: { selector: '#results', limit: 100 }, summary: 'Extract results' };
    expect(mapAgentToolToWorkflowStep(action)).toBeNull();
    expect(mapAgentToolToWorkflowStep(action, { allowExtractFallback: true })).toMatchObject({
      type: 'extract', instruction: 'Extract text from #results (limit: 100)',
    });
  });

  it('preserves legacy numbered selectors when requested by journal replay', () => {
    const action = { id: '4', toolName: 'act', input: { action: 'click', selector: '[index=2]' }, summary: 'Click item' };
    expect(mapAgentToolToWorkflowStep(action, { allowIndexSelector: true })).toMatchObject({ selector: '[index=2]' });
  });
});
