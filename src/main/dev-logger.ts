export type DevelopmentLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DevelopmentLogSink {
  debug(message: string, ...details: unknown[]): void;
  info(message: string, ...details: unknown[]): void;
  warn(message: string, ...details: unknown[]): void;
  error(message: string, ...details: unknown[]): void;
}

export interface DevelopmentLoggerOptions {
  enabled?: boolean;
  sink?: DevelopmentLogSink;
}

const sensitiveKeyPattern = /password|passwd|token|secret|api[-_]?key|authorization|cookie|otp|one[-_]?time|credential/i;

/**
 * Redacts values before they reach the terminal. Browser-agent logs are useful
 * only if they can safely be left enabled while debugging real tasks.
 */
export function redactDevelopmentValue(value: unknown, key?: string): unknown {
  if (key && sensitiveKeyPattern.test(key)) return '[REDACTED]';
  if (key === 'text' || key === 'value' || key === 'thought') {
    if (typeof value === 'string') return `[REDACTED ${value.length} chars]`;
    return '[REDACTED]';
  }
  if (key === 'url' && typeof value === 'string') {
    try {
      const parsed = new URL(value);
      return `${parsed.origin}${parsed.pathname}${parsed.search ? '?[REDACTED_QUERY]' : ''}`;
    } catch {
      return value;
    }
  }
  if (Array.isArray(value)) return value.map((item) => redactDevelopmentValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactDevelopmentValue(entryValue, entryKey),
      ]),
    );
  }
  return value;
}

const consoleSink: DevelopmentLogSink = {
  debug: (message, ...details) => console.debug(message, ...details),
  info: (message, ...details) => console.info(message, ...details),
  warn: (message, ...details) => console.warn(message, ...details),
  error: (message, ...details) => console.error(message, ...details),
};

/**
 * Development terminal projection for main-process lifecycle events.
 * Info/debug output is enabled outside production (or with REMOTECTRL_DEBUG=1)
 * while warnings/errors remain visible in every environment.
 */
export function createDevelopmentLogger(scope: string, options: DevelopmentLoggerOptions = {}) {
  const enabled = options.enabled ?? (process.env.NODE_ENV !== 'production' || process.env.REMOTECTRL_DEBUG === '1');
  const sink = options.sink ?? consoleSink;
  const prefix = `[${scope}]`;
  const write = (level: DevelopmentLogLevel, message: string, details: unknown[]) => {
    if ((level === 'debug' || level === 'info') && !enabled) return;
    sink[level](`${prefix} ${message}`, ...details.map((detail) => redactDevelopmentValue(detail)));
  };

  return {
    debug: (message: string, ...details: unknown[]) => write('debug', message, details),
    info: (message: string, ...details: unknown[]) => write('info', message, details),
    warn: (message: string, ...details: unknown[]) => write('warn', message, details),
    error: (message: string, ...details: unknown[]) => write('error', message, details),
  };
}
