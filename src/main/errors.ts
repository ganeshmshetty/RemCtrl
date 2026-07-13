/**
 * @file errors.ts
 * @description Custom exception classes and diagnostic utilities for agentic execution, Playwright automation, and system connection errors.
 * @module main/errors
 * 
 * Key Exports:
 * - Base class: `AgentExecutionError` carrying code and retryable flags.
 * - Specialized classes: `AgentStalledError`, `AgentStepLimitError`, `AgentTimeoutError`, `StagehandConnectionError`, `BrowserConnectionError`, `BrowserNotReadyError`, `CommandExecutionError`, and `RetryExhaustedError`.
 * - Diagnostic: `extractError(err)` returning normalized error metadata (code, message, retryable, stack).
 * 
 * Mechanics & Relations:
 * - Employs regex/substring matchers to inspect exception contents for network dropouts, HTTP 429/5xx status codes, and Playwright session closures.
 * - Used by automation orchestrators, browser managers, and IPC handlers to format and report execution failures back to the client interface.
 */

export class AgentExecutionError extends Error {
  public readonly code: string;
  public readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AgentExecutionError';
    this.code = code;
    this.retryable = retryable;
  }
}

export class AgentStalledError extends AgentExecutionError {
  constructor(message = 'Agent is stuck in a loop', retryable = true) {
    super('AGENT_STALLED', message, retryable);
    this.name = 'AgentStalledError';
  }
}

export class AgentStepLimitError extends AgentExecutionError {
  public readonly stepsTaken: number;
  public readonly stepLimit: number;

  constructor(stepsTaken: number, stepLimit: number) {
    super('STEP_LIMIT', `Agent reached maximum steps (${stepsTaken}/${stepLimit})`, false);
    this.name = 'AgentStepLimitError';
    this.stepsTaken = stepsTaken;
    this.stepLimit = stepLimit;
  }
}

export class AgentTimeoutError extends AgentExecutionError {
  public readonly timeoutMs: number;

  constructor(timeoutMs: number, message = 'Command timed out') {
    super('TIMEOUT', message, true);
    this.name = 'AgentTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export class StagehandConnectionError extends AgentExecutionError {
  constructor(message: string) {
    super('STAGEHAND_CONNECTION', `Failed to connect to Stagehand: ${message}`, true);
    this.name = 'StagehandConnectionError';
  }
}

export class BrowserConnectionError extends AgentExecutionError {
  constructor(message: string) {
    super('BROWSER_CONNECTION', `Failed to connect to browser CDP: ${message}`, true);
    this.name = 'BrowserConnectionError';
  }
}

export class BrowserNotReadyError extends AgentExecutionError {
  constructor(message = 'Browser is not ready') {
    super('BROWSER_NOT_READY', message, false);
    this.name = 'BrowserNotReadyError';
  }
}

export class CommandExecutionError extends AgentExecutionError {
  public readonly command: string;
  public readonly cause?: Error;

  constructor(command: string, message: string, cause?: Error) {
    super('COMMAND_EXECUTION', `Command "${command}" failed: ${message}`, true, cause ? { cause } : undefined);
    this.name = 'CommandExecutionError';
    this.command = command;
    this.cause = cause;
  }
}

export class RetryExhaustedError extends AgentExecutionError {
  public readonly attempts: number;
  public readonly lastError: Error;

  constructor(attempts: number, lastError: Error) {
    super(
      'RETRY_EXHAUSTED',
      `Failed after ${attempts} attempt${attempts === 1 ? '' : 's'}. Last error: ${lastError.message}`,
      false,
    );
    this.name = 'RetryExhaustedError';
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

/**
 * Extract actionable error information from any thrown value.
 * Returns a structured error with code, message, and retryability.
 */
export function extractError(err: unknown): {
  code: string;
  message: string;
  retryable: boolean;
  stack?: string;
} {
  if (err instanceof AgentExecutionError) {
    return {
      code: err.code,
      message: err.message,
      retryable: err.retryable,
      stack: err.stack,
    };
  }

  if (err instanceof Error) {
    const message = err.message;
    const isRetryable = isRetryableError(err);

    return {
      code: mapErrorCode(err),
      message,
      retryable: isRetryable,
      stack: err.stack,
    };
  }

  // Handle non-Error objects
  const message = typeof err === 'string' ? err : JSON.stringify(err) ?? String(err);
  return {
    code: 'UNKNOWN',
    message,
    retryable: false,
  };
}

/**
 * Determine if an error is likely temporary and worth retrying.
 */
function isRetryableError(err: Error): boolean {
  const message = err.message.toLowerCase();
  
  // Stagehand/Playwright specific (fatal checks first)
  if (message.includes('page closed') || 
      message.includes('context destroyed')) {
    return false;
  }

  // Network/timeout errors
  if (message.includes('timeout') || 
      message.includes('network') || 
      message.includes('econnrefused') ||
      message.includes('econnreset')) {
    return true;
  }

  // Rate limiting
  if (message.includes('rate limit') || 
      message.includes('429') || 
      message.includes('too many requests')) {
    return true;
  }

  // Server errors
  if (message.includes('500') || 
      message.includes('502') || 
      message.includes('503') ||
      message.includes('504')) {
    return true;
  }

  return false;
}

/**
 * Map common error patterns to error codes.
 */
function mapErrorCode(err: Error): string {
  const message = err.message.toLowerCase();

  if (message.includes('timeout')) return 'TIMEOUT';
  if (message.includes('rate limit')) return 'RATE_LIMIT';
  if (message.includes('network')) return 'NETWORK';
  if (message.includes('stall')) return 'STALL';
  if (message.includes('limit')) return 'LIMIT';
  if (message.includes('permission')) return 'PERMISSION';
  if (message.includes('auth')) return 'AUTH';

  return 'EXECUTION_FAILED';
}
