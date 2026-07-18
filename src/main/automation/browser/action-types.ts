import type { Locator } from 'playwright';
import type { ActionCapability } from '../../../shared/types.js';

export type ElementActionKind = 'click' | 'fill' | 'press' | 'select' | 'check' | 'uncheck' | 'focus' | 'hover';
export type ScrollDirection = 'up' | 'down' | 'left' | 'right';

export type SemanticBrowserAction =
  | { kind: 'navigate'; url: string }
  | { kind: 'element'; index?: number; selector?: string; action: ElementActionKind; value?: string; description?: string }
  | { kind: 'observe'; filter?: string }
  | { kind: 'extract'; selector?: string; includeIndices?: boolean; limit?: number }
  | { kind: 'page-url' }
  | { kind: 'keys'; key: string }
  | { kind: 'type'; text: string }
  | { kind: 'scroll'; direction: ScrollDirection; pixels: number }
  | { kind: 'wait'; ms: number };

export interface ElementTarget {
  locator: Locator;
  resolvedSelector: string;
}

export interface PolicyBlockedResult {
  success: false;
  blockedByPolicy: true;
  reason: string;
  code?: 'blocked';
}

export interface BrowserActionSuccess {
  success: true;
  [key: string]: unknown;
}

export type BrowserActionResult = BrowserActionSuccess | PolicyBlockedResult;

export interface BrowserActionGuardRequest {
  capability: ActionCapability;
  summary: string;
  details?: Record<string, unknown>;
  url: string;
}

export interface BrowserActionExecutionOptions {
  /** Skip the potentially unbounded network-idle wait for deterministic batches. */
  waitForNetworkIdle?: boolean;
  navigationTimeoutMs?: number;
  networkIdleTimeoutMs?: number;
}

/** Optional action guard. Local companion callers simply omit it. */
export type BrowserActionGuard = (request: BrowserActionGuardRequest) => Promise<PolicyBlockedResult | undefined>;
