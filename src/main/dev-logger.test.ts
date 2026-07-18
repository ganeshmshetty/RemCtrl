import { describe, expect, it, vi } from 'vitest';
import { createDevelopmentLogger, redactDevelopmentValue, type DevelopmentLogSink } from './dev-logger.js';

function sink(): DevelopmentLogSink {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('development logger', () => {
  it('projects scoped lifecycle messages when enabled', () => {
    const output = sink();
    createDevelopmentLogger('Workflow', { enabled: true, sink: output }).info('started', { steps: 2 });
    expect(output.info).toHaveBeenCalledWith('[Workflow] started', { steps: 2 });
  });

  it('suppresses info/debug in production mode but keeps warnings and errors', () => {
    const output = sink();
    const logger = createDevelopmentLogger('Browser', { enabled: false, sink: output });
    logger.debug('details');
    logger.info('started');
    logger.warn('recoverable');
    logger.error('failed');
    expect(output.debug).not.toHaveBeenCalled();
    expect(output.info).not.toHaveBeenCalled();
    expect(output.warn).toHaveBeenCalledWith('[Browser] recoverable');
    expect(output.error).toHaveBeenCalledWith('[Browser] failed');
  });

  it('redacts secrets and form values from terminal details', () => {
    expect(redactDevelopmentValue({ password: 'secret', value: 'otp', url: 'https://example.test/path?q=secret' }))
      .toEqual({ password: '[REDACTED]', value: '[REDACTED 3 chars]', url: 'https://example.test/path?[REDACTED_QUERY]' });
  });

  it('applies redaction to logger details', () => {
    const output = sink();
    createDevelopmentLogger('AgentLoop', { enabled: true, sink: output }).info('tool.result', { token: 'hidden', step: 2 });
    expect(output.info).toHaveBeenCalledWith('[AgentLoop] tool.result', { token: '[REDACTED]', step: 2 });
  });
});
