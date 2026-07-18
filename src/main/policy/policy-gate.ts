/**
 * Main-process scoped-action policy gate.
 *
 * This is deliberately a deep module: callers only need to submit an intent and
 * handle an authorization result, while normalization, deny precedence, approval
 * lifecycle, bounded state, and redacted auditing stay local to this seam.
 *
 * Scope state is intentionally process-local for now. `storage.ts` is an Electron
 * app.getPath-backed persistence module, whereas approvals and audit subscriptions
 * are security-sensitive live state. Persisting a scope here would require a
 * versioned policy store and explicit restart/replay semantics; that is deferred
 * until a caller needs durable scopes.
 */

import { createHash, randomUUID } from 'node:crypto';
import { domainToASCII } from 'node:url';
import {
  PolicyApprovalSchema,
  PolicyDecisionSchema,
  PolicyIntentSchema,
  PolicyScopeSchema,
} from '../../shared/schemas.js';
import type {
  PolicyApproval,
  PolicyAuditResource,
  PolicyAuthorization,
  PolicyApprovalDecision,
  PolicyIntent,
  PolicyRuleSet,
  PolicyScope,
  ActionCapability,
  ActionIntent,
  PolicyApprovalRequest,
  PolicyDecision as LegacyPolicyDecision,
  PolicyAuditEvent as LegacyPolicyAuditEvent,
  TaskScope,
} from '../../shared/types.js';
import type { ScopedPolicyAuditEvent } from '../../shared/types.js';

const DEFAULT_SCOPE_LIMITS = {
  maxPendingApprovals: 20,
  approvalTtlMs: 5 * 60 * 1_000,
  maxAuditEvents: 1_000,
} as const;

type Clock = () => number;
type PolicyListener = (event: ScopedPolicyAuditEvent) => void;

interface NormalizedIntent {
  sessionId: string;
  actorId: string;
  action: string;
  capability: string;
  approvalId?: string;
  resource: PolicyAuditResource;
  payload?: unknown;
}

interface RuleEvaluation {
  denied: boolean;
  allowed: boolean;
}

export interface ScopedPolicyGate {
  setScope(scope: PolicyScope): void;
  getScope(): PolicyScope | null;
  authorize(intent: PolicyIntent): PolicyAuthorization;
  resolveApproval(id: string, decision: PolicyApprovalDecision): PolicyApproval | null;
  cancelSession(sessionId: string): void;
  subscribe(listener: PolicyListener): () => void;
}

export interface PolicyGateOptions {
  now?: Clock;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizeCapability(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length > 256) throw new Error('Invalid capability');
  return normalized;
}

function normalizePattern(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error('Origin must be a valid HTTP(S) URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Origin must use HTTP or HTTPS');
  }
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('Origin must not contain credentials, path, query, or hash');
  }
  return parsed.origin.toLowerCase();
}

function normalizeDomain(value: string): string {
  let normalized = value.trim().toLowerCase();
  if (normalized === '*') return '*';
  const wildcard = normalized.startsWith('*.');
  if (wildcard) normalized = normalized.slice(2);
  normalized = normalized.replace(/\.$/, '');
  const ascii = domainToASCII(normalized);
  if (!ascii || ascii.length > 253 || ascii.includes('/') || ascii.includes(':') || ascii.includes('@')) {
    throw new Error('Invalid domain');
  }
  return `${wildcard ? '*.' : ''}${ascii.toLowerCase()}`;
}

function normalizePath(value: string): string {
  const raw = value.trim();
  if (!raw.startsWith('/') || raw.includes('\\') || raw.includes('?') || raw.includes('#')) {
    throw new Error('Path must be an absolute path without query or hash');
  }
  const wildcard = raw.endsWith('/*');
  const base = wildcard ? raw.slice(0, -2) || '/' : raw;
  let pathname: string;
  try {
    pathname = new URL(`http://policy.invalid${base}`).pathname;
  } catch {
    throw new Error('Invalid path');
  }
  pathname = pathname.replace(/\/{2,}/g, '/');
  if (pathname.length > 1) pathname = pathname.replace(/\/$/, '');
  return wildcard ? `${pathname === '/' ? '' : pathname}/*` : pathname;
}

function normalizeRuleSet(ruleSet: PolicyRuleSet, kind: 'origin' | 'domain' | 'path' | 'capability'): PolicyRuleSet {
  const normalize = kind === 'origin'
    ? normalizeOrigin
    : kind === 'domain'
      ? normalizeDomain
      : kind === 'path'
        ? normalizePath
        : normalizeCapability;
  return {
    allow: unique(ruleSet.allow.map(normalize)),
    deny: unique(ruleSet.deny.map(normalize)),
  };
}

function normalizeScope(scope: PolicyScope): PolicyScope {
  const parsed = PolicyScopeSchema.parse(scope);
  return {
    ...parsed,
    capabilities: normalizeRuleSet(parsed.capabilities, 'capability'),
    origins: normalizeRuleSet(parsed.origins, 'origin'),
    domains: normalizeRuleSet(parsed.domains, 'domain'),
    paths: normalizeRuleSet(parsed.paths, 'path'),
    requireApproval: unique(parsed.requireApproval.map(normalizeCapability)),
    limits: { ...DEFAULT_SCOPE_LIMITS, ...parsed.limits },
  };
}

function domainMatches(rule: string, domain: string): boolean {
  if (rule === '*') return true;
  if (rule === domain) return true;
  if (!rule.startsWith('*.')) return false;
  const base = rule.slice(2);
  return domain === base || domain.endsWith(`.${base}`);
}

function pathMatches(rule: string, path: string): boolean {
  if (rule === path) return true;
  if (!rule.endsWith('/*')) return false;
  const prefix = rule.slice(0, -1);
  return path.startsWith(prefix);
}

function capabilityMatches(rule: string, capability: string): boolean {
  if (rule === '*' || rule === capability) return true;
  if (rule.endsWith('.*')) return capability.startsWith(`${rule.slice(0, -1)}`);
  return false;
}

function matches(kind: 'origin' | 'domain' | 'path' | 'capability', rule: string, value: string): boolean {
  if (kind === 'domain') return domainMatches(rule, value);
  if (kind === 'path') return pathMatches(rule, value);
  if (kind === 'capability') return capabilityMatches(rule, value);
  return rule === value;
}

function evaluateRules(
  ruleSet: PolicyRuleSet,
  kind: 'origin' | 'domain' | 'path' | 'capability',
  value: string,
  active: boolean = true,
): RuleEvaluation {
  if (!active) return { denied: false, allowed: true };
  const denied = ruleSet.deny.some(rule => matches(kind, rule, value));
  const allowed = ruleSet.allow.some(rule => matches(kind, rule, value));
  return { denied, allowed };
}

function canonicalize(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[depth-redacted]';
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.length > 4_096 ? `${value.slice(0, 4_096)}[truncated]` : value;
  if (Array.isArray(value)) return value.slice(0, 128).map(item => canonicalize(item, depth + 1));
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.keys(record).sort().slice(0, 128).reduce<Record<string, unknown>>((result, key) => {
      result[key] = canonicalize(record[key], depth + 1);
      return result;
    }, {});
  }
  return `[${typeof value}-redacted]`;
}

function digestAction(intent: NormalizedIntent): string {
  const canonical = JSON.stringify(canonicalize({
    action: intent.action,
    capability: intent.capability,
    resource: intent.resource,
    payload: intent.payload,
  }));
  return createHash('sha256').update(canonical).digest('hex');
}

function redactText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  return Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    })
    .join('')
    .slice(0, maxLength);
}

function cloneApproval(approval: PolicyApproval): PolicyApproval {
  return { ...approval };
}

function cloneScope(scope: PolicyScope): PolicyScope {
  return {
    ...scope,
    capabilities: { allow: [...scope.capabilities.allow], deny: [...scope.capabilities.deny] },
    origins: { allow: [...scope.origins.allow], deny: [...scope.origins.deny] },
    domains: { allow: [...scope.domains.allow], deny: [...scope.domains.deny] },
    paths: { allow: [...scope.paths.allow], deny: [...scope.paths.deny] },
    requireApproval: [...scope.requireApproval],
    limits: { ...scope.limits },
  };
}

export class InMemoryPolicyGate implements ScopedPolicyGate {
  private scope: PolicyScope | null = null;
  private readonly approvals = new Map<string, PolicyApproval>();
  private readonly listeners = new Set<PolicyListener>();
  private auditEvents: ScopedPolicyAuditEvent[] = [];
  private readonly now: Clock;

  constructor(options: PolicyGateOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  setScope(scope: PolicyScope): void {
    const normalized = normalizeScope(scope);
    this.expireApprovals(this.now());
    for (const approval of this.approvals.values()) {
      if (approval.status === 'pending' || approval.status === 'approved') {
        approval.status = 'cancelled';
        approval.decision = 'cancel';
        approval.resolvedAt = this.now();
      }
    }
    this.approvals.clear();
    this.scope = normalized;
    this.recordAudit({
      kind: 'scope_set',
      outcome: 'allowed',
      scopeId: normalized.id,
      reasonCodes: ['scope_set'],
    });
  }

  getScope(): PolicyScope | null {
    return this.scope ? cloneScope(this.scope) : null;
  }

  authorize(intent: PolicyIntent): PolicyAuthorization {
    const now = this.now();
    this.expireApprovals(now);
    const parsed = PolicyIntentSchema.safeParse(intent);
    if (!parsed.success) {
      const actionDigest = this.invalidIntentDigest(intent);
      return this.finishAuthorization('denied', actionDigest, ['invalid_intent'], undefined, undefined, now);
    }

    let normalizedIntent: NormalizedIntent;
    try {
      normalizedIntent = this.normalizeIntent(parsed.data);
    } catch {
      const actionDigest = this.invalidIntentDigest(parsed.data);
      return this.finishAuthorization('denied', actionDigest, ['invalid_resource'], undefined, undefined, now);
    }

    const actionDigest = digestAction(normalizedIntent);
    const scope = this.scope;
    if (!scope) {
      return this.finishAuthorization('denied', actionDigest, ['no_scope'], normalizedIntent, undefined, now);
    }

    const reasonCodes: string[] = [];
    if (scope.sessionId && scope.sessionId !== normalizedIntent.sessionId) reasonCodes.push('session_mismatch');
    if (scope.actorId && scope.actorId !== normalizedIntent.actorId) reasonCodes.push('actor_mismatch');

    const capabilityEvaluation = evaluateRules(scope.capabilities, 'capability', normalizedIntent.capability);
    if (capabilityEvaluation.denied) reasonCodes.push('capability_denied');
    if (!capabilityEvaluation.allowed) reasonCodes.push('capability_not_allowed');

    this.evaluateResource(scope.origins, 'origin', normalizedIntent.resource.origin, parsed.data.origin !== undefined, reasonCodes);
    this.evaluateResource(scope.domains, 'domain', normalizedIntent.resource.domain, parsed.data.domain !== undefined, reasonCodes);
    this.evaluateResource(scope.paths, 'path', normalizedIntent.resource.path, parsed.data.path !== undefined, reasonCodes);

    if (reasonCodes.length > 0) {
      return this.finishAuthorization('denied', actionDigest, unique(reasonCodes), normalizedIntent, undefined, now);
    }

    const approvalRequired = scope.requireApproval.some(rule => capabilityMatches(rule, normalizedIntent.capability));
    if (!approvalRequired) {
      return this.finishAuthorization('allowed', actionDigest, ['allowed'], normalizedIntent, undefined, now);
    }

    if (normalizedIntent.approvalId) {
      const approval = this.approvals.get(normalizedIntent.approvalId);
      if (!approval || approval.status !== 'approved' || approval.expiresAt <= now ||
        approval.sessionId !== normalizedIntent.sessionId || approval.actorId !== normalizedIntent.actorId ||
        approval.actionDigest !== actionDigest) {
        return this.finishAuthorization('denied', actionDigest, ['invalid_approval'], normalizedIntent, undefined, now);
      }
      approval.status = 'used';
      approval.usedAt = now;
      this.approvals.delete(approval.id);
      return this.finishAuthorization('allowed', actionDigest, ['approval_used'], normalizedIntent, approval, now);
    }

    const existing = [...this.approvals.values()].find(approval =>
      approval.status === 'pending' &&
      approval.sessionId === normalizedIntent.sessionId &&
      approval.actorId === normalizedIntent.actorId &&
      approval.actionDigest === actionDigest &&
      approval.expiresAt > now
    );
    if (existing) {
      return this.finishAuthorization('pending', actionDigest, ['approval_pending'], normalizedIntent, existing, now);
    }
    if ([...this.approvals.values()].filter(approval => approval.status === 'pending').length >= scope.limits.maxPendingApprovals) {
      return this.finishAuthorization('denied', actionDigest, ['approval_capacity_exhausted'], normalizedIntent, undefined, now);
    }

    const approval: PolicyApproval = {
      id: randomUUID(),
      sessionId: normalizedIntent.sessionId,
      actorId: normalizedIntent.actorId,
      actionDigest,
      capability: normalizedIntent.capability,
      createdAt: now,
      expiresAt: now + scope.limits.approvalTtlMs,
      status: 'pending',
    };
    PolicyApprovalSchema.parse(approval);
    this.approvals.set(approval.id, approval);
    return this.finishAuthorization('pending', actionDigest, ['approval_required'], normalizedIntent, approval, now);
  }

  resolveApproval(id: string, decision: PolicyApprovalDecision): PolicyApproval | null {
    const now = this.now();
    this.expireApprovals(now);
    const parsedDecision = PolicyDecisionSchema.safeParse(decision);
    if (!parsedDecision.success) return null;
    const approval = this.approvals.get(id);
    if (!approval || approval.status !== 'pending' || approval.expiresAt <= now) return null;
    approval.decision = parsedDecision.data;
    approval.resolvedAt = now;
    approval.status = parsedDecision.data === 'approve'
      ? 'approved'
      : parsedDecision.data === 'deny'
        ? 'denied'
        : 'cancelled';
    this.recordAudit({
      kind: 'approval_resolved',
      outcome: parsedDecision.data === 'approve' ? 'approved' : parsedDecision.data === 'deny' ? 'denied' : 'cancelled',
      scopeId: this.scope?.id,
      sessionId: approval.sessionId,
      actorId: approval.actorId,
      capability: approval.capability,
      actionDigest: approval.actionDigest,
      approvalId: approval.id,
      decision: parsedDecision.data,
      reasonCodes: [parsedDecision.data === 'approve' ? 'approval_approved' : parsedDecision.data === 'deny' ? 'approval_denied' : 'approval_cancelled'],
    });
    return cloneApproval(approval);
  }

  cancelSession(sessionId: string): void {
    const normalizedSessionId = redactText(sessionId.trim(), 128) ?? '';
    if (!normalizedSessionId) return;
    const now = this.now();
    for (const approval of this.approvals.values()) {
      if (approval.sessionId !== normalizedSessionId || (approval.status !== 'pending' && approval.status !== 'approved')) continue;
      approval.status = 'cancelled';
      approval.decision = 'cancel';
      approval.resolvedAt = now;
      this.recordAudit({
        kind: 'session_cancelled',
        outcome: 'cancelled',
        scopeId: this.scope?.id,
        sessionId: approval.sessionId,
        actorId: approval.actorId,
        capability: approval.capability,
        actionDigest: approval.actionDigest,
        approvalId: approval.id,
        reasonCodes: ['session_cancelled'],
      });
      this.approvals.delete(approval.id);
    }
  }

  subscribe(listener: PolicyListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private normalizeIntent(intent: PolicyIntent): NormalizedIntent {
    let origin = intent.origin ? normalizeOrigin(intent.origin) : undefined;
    let domain = intent.domain ? normalizeDomain(intent.domain) : undefined;
    let path = intent.path ? normalizePath(intent.path) : undefined;

    if (intent.url) {
      const parsed = new URL(intent.url);
      const urlOrigin = normalizeOrigin(parsed.origin);
      const urlDomain = normalizeDomain(parsed.hostname);
      const urlPath = normalizePath(parsed.pathname || '/');
      if (origin && origin !== urlOrigin) throw new Error('Origin does not match URL');
      if (domain && domain !== urlDomain) throw new Error('Domain does not match URL');
      if (path && path !== urlPath) throw new Error('Path does not match URL');
      origin ??= urlOrigin;
      domain ??= urlDomain;
      path ??= urlPath;
    }

    if (origin && !domain) {
      domain = normalizeDomain(new URL(origin).hostname);
    }
    return {
      sessionId: redactText(intent.sessionId, 128) ?? '',
      actorId: redactText(intent.actorId, 128) ?? '',
      action: normalizePattern(intent.action),
      capability: normalizeCapability(intent.capability),
      approvalId: intent.approvalId,
      resource: { origin, domain, path },
      payload: intent.payload,
    };
  }

  private evaluateResource(
    ruleSet: PolicyRuleSet,
    kind: 'origin' | 'domain' | 'path',
    value: string | undefined,
    explicitlyProvided: boolean,
    reasonCodes: string[],
  ): void {
    if (!value) return;
    const hasRules = ruleSet.allow.length > 0 || ruleSet.deny.length > 0;
    const evaluation = evaluateRules(ruleSet, kind, value, explicitlyProvided || hasRules);
    if (evaluation.denied) reasonCodes.push(`${kind}_denied`);
    if (!evaluation.allowed) reasonCodes.push(`${kind}_not_allowed`);
  }

  private invalidIntentDigest(intent: PolicyIntent): string {
    return createHash('sha256').update(JSON.stringify(canonicalize(intent))).digest('hex');
  }

  private finishAuthorization(
    status: PolicyAuthorization['status'],
    actionDigest: string,
    reasonCodes: string[],
    intent: NormalizedIntent | undefined,
    approval: PolicyApproval | undefined,
    now: number,
  ): PolicyAuthorization {
    const event = this.recordAudit({
      kind: 'authorization',
      outcome: status,
      scopeId: this.scope?.id,
      sessionId: intent?.sessionId,
      actorId: intent?.actorId,
      capability: intent?.capability,
      actionDigest,
      approvalId: approval?.id,
      reasonCodes,
      resource: intent?.resource,
    }, now);
    return {
      status,
      actionDigest,
      approval: approval ? cloneApproval(approval) : undefined,
      reasonCodes: [...reasonCodes],
      auditEvent: event,
    };
  }

  private expireApprovals(now: number): void {
    for (const approval of this.approvals.values()) {
      if ((approval.status === 'pending' || approval.status === 'approved') && approval.expiresAt <= now) {
        approval.status = 'expired';
        this.recordAudit({
          kind: 'approval_expired',
          outcome: 'expired',
          scopeId: this.scope?.id,
          sessionId: approval.sessionId,
          actorId: approval.actorId,
          capability: approval.capability,
          actionDigest: approval.actionDigest,
          approvalId: approval.id,
          reasonCodes: ['approval_ttl_expired'],
        }, now);
        this.approvals.delete(approval.id);
      }
    }
  }

  private recordAudit(
    input: Omit<ScopedPolicyAuditEvent, 'id' | 'timestamp'>,
    timestamp = this.now(),
  ): ScopedPolicyAuditEvent {
    const event: ScopedPolicyAuditEvent = {
      id: randomUUID(),
      timestamp,
      ...input,
      scopeId: redactText(input.scopeId, 128),
      sessionId: redactText(input.sessionId, 128),
      actorId: redactText(input.actorId, 128),
      capability: input.capability ? normalizeCapability(input.capability) : undefined,
      resource: input.resource && {
        origin: redactText(input.resource.origin, 2_048),
        domain: redactText(input.resource.domain, 512),
        path: redactText(input.resource.path, 4_096),
      },
    };
    this.auditEvents.push(event);
    const maxAuditEvents = this.scope?.limits.maxAuditEvents ?? DEFAULT_SCOPE_LIMITS.maxAuditEvents;
    if (this.auditEvents.length > maxAuditEvents) this.auditEvents.splice(0, this.auditEvents.length - maxAuditEvents);
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // An audit observer must not be able to change an authorization result.
      }
    }
    return event;
  }
}

export function createPolicyGate(options: PolicyGateOptions = {}): ScopedPolicyGate {
  return new InMemoryPolicyGate(options);
}

// Compatibility adapter for the policy edits already present in the app. New
// callers should use createPolicyGate/InMemoryPolicyGate and the scoped policy
// interface above; this adapter keeps existing automation and IPC seams intact.
interface LegacyApprovalRequest {
  id: string;
  intent: ActionIntent;
  scopeId: string;
  expiresAt: number;
  actionDigest: string;
}

type LegacyPolicyListener = (event: LegacyPolicyAuditEvent | PolicyApprovalRequest | LegacyApprovalRequest) => void;

function legacyScopeToPolicyScope(scope: TaskScope): PolicyScope {
  return {
    id: scope.id,
    capabilities: { allow: ['*'], deny: [] },
    origins: { allow: [], deny: [] },
    domains: { allow: [...scope.allowedDomains], deny: [] },
    paths: { allow: [], deny: [] },
    requireApproval: [...scope.requireApprovalFor],
    limits: {
      maxPendingApprovals: Math.min(scope.maxActions, DEFAULT_SCOPE_LIMITS.maxPendingApprovals),
      approvalTtlMs: Math.max(1_000, scope.expiresAt ? Math.max(1_000, scope.expiresAt - Date.now()) : DEFAULT_SCOPE_LIMITS.approvalTtlMs),
      maxAuditEvents: DEFAULT_SCOPE_LIMITS.maxAuditEvents,
    },
  };
}

const RESEARCH_GOAL = /\b(find|search|research|read|extract|summari[sz]e|compare|list|browse|look\s*up|learn)\b/i;
const SAFE_CLICK = /\b(next|previous|pagination|show more|expand|collapse|sort|filter)\b/i;

/**
 * A deliberately conservative intent classifier. It is deterministic policy,
 * not an LLM judgement: only non-destructive browsing steps can be auto-allowed
 * and only for a research-style user goal. Form entry, submission, checkout,
 * account changes, downloads, and arbitrary clicks remain approval-gated.
 */
function isSafeGoalAlignedAction(scope: TaskScope, intent: ActionIntent): boolean {
  if (intent.capability === 'browser.read' || intent.capability === 'browser.scroll') return true;
  // Reaching an allowed URL is non-mutating regardless of whether the goal is
  // research, support, or simply “open YouTube”. Domain/path rules were
  // already evaluated by the hard gate before this classifier runs.
  if (intent.capability === 'browser.navigate') return true;
  if (!RESEARCH_GOAL.test(scope.goal)) return false;
  return intent.capability === 'browser.click' && SAFE_CLICK.test(`${intent.summary} ${intent.target ?? ''}`);
}

function legacyIntentToPolicyIntent(intent: ActionIntent, approvalId?: string): PolicyIntent {
  return {
    sessionId: intent.sessionId,
    actorId: intent.actorId,
    action: intent.capability,
    capability: intent.capability,
    url: intent.url,
    approvalId,
    payload: intent.details,
  };
}

function legacyDecision(decision: 'allowed' | 'blocked' | 'approved', reason: string, approvalId?: string): LegacyPolicyDecision {
  return { decision, reason, approvalId };
}

export class PolicyGate {
  private readonly core: InMemoryPolicyGate;
  private readonly listeners = new Set<LegacyPolicyListener>();
  private readonly audit: LegacyPolicyAuditEvent[] = [];
  private readonly pending = new Map<string, { resolve: (decision: LegacyPolicyDecision) => void; intent: ActionIntent }>();
  private legacyScope: TaskScope | PolicyScope | null = null;
  private actionCount = 0;

  constructor(options: PolicyGateOptions = {}) {
    this.core = new InMemoryPolicyGate(options);
    this.core.subscribe(event => this.forwardAudit(event));
  }

  setScope(scope: TaskScope | PolicyScope): void {
    this.legacyScope = scope;
    this.actionCount = 0;
    this.core.setScope('allowedDomains' in scope ? legacyScopeToPolicyScope(scope) : scope);
  }

  getScope(): TaskScope | PolicyScope | null {
    return this.legacyScope;
  }

  async authorize(intent: ActionIntent): Promise<LegacyPolicyDecision>;
  authorize(intent: PolicyIntent): PolicyAuthorization;
  authorize(intent: ActionIntent | PolicyIntent): Promise<LegacyPolicyDecision> | PolicyAuthorization {
    if (!('source' in intent)) return this.core.authorize(intent);
    const scope = this.legacyScope;
    if (!scope || !('allowedDomains' in scope)) {
      return Promise.resolve(legacyDecision('blocked', 'No active task scope.'));
    }
    if (!scope.goal.trim()) {
      return Promise.resolve(legacyDecision('blocked', 'Declare the task goal before authorizing browser actions.'));
    }
    if (scope.expiresAt !== undefined && scope.expiresAt <= Date.now()) {
      return Promise.resolve(legacyDecision('blocked', 'Task scope has expired.'));
    }
    if (this.actionCount >= scope.maxActions) {
      return Promise.resolve(legacyDecision('blocked', 'Task action limit reached.'));
    }

    const result = this.core.authorize(legacyIntentToPolicyIntent(intent));
    if (result.status === 'denied') {
      const outsideScope = result.reasonCodes.includes('domain_not_allowed') || result.reasonCodes.includes('domain_denied');
      const reason = outsideScope ? 'domain_not_allowed' : result.reasonCodes.join(', ');
      return Promise.resolve(legacyDecision('blocked', reason));
    }
    if (result.status === 'allowed') {
      this.actionCount += 1;
      return Promise.resolve(legacyDecision('allowed', 'Action allowed.'));
    }

    const approval = result.approval;
    if (!approval) return Promise.resolve(legacyDecision('blocked', 'Approval could not be created.'));
    if (isSafeGoalAlignedAction(scope, intent)) {
      this.core.resolveApproval(approval.id, 'approve');
      const consumed = this.core.authorize(legacyIntentToPolicyIntent(intent, approval.id));
      if (consumed.status === 'allowed') {
        this.actionCount += 1;
        return Promise.resolve(legacyDecision('allowed', 'Allowed as a low-risk action aligned with the declared goal.'));
      }
      return Promise.resolve(legacyDecision('blocked', consumed.reasonCodes.join(', ')));
    }
    this.emitApprovalRequest(approval, intent);
    return new Promise(resolve => {
      this.pending.set(approval.id, { resolve, intent });
    });
  }

  resolveApproval(id: string, approved: boolean): LegacyPolicyDecision;
  resolveApproval(id: string, decision: PolicyApprovalDecision): PolicyApproval | null;
  resolveApproval(id: string, decision: boolean | PolicyApprovalDecision): LegacyPolicyDecision | PolicyApproval | null {
    if (typeof decision !== 'boolean') return this.core.resolveApproval(id, decision);
    const resolved = this.core.resolveApproval(id, decision ? 'approve' : 'deny');
    const waiting = this.pending.get(id);
    if (!resolved || !waiting) return legacyDecision('blocked', 'Approval request is no longer pending.', id);
    this.pending.delete(id);
    if (decision) {
      this.actionCount += 1;
      const result = legacyDecision('approved', 'Action approved by host.', id);
      waiting.resolve(result);
      return result;
    }
    const result = legacyDecision('blocked', 'Action rejected by host.', id);
    waiting.resolve(result);
    return result;
  }

  cancelSession(sessionId: string): void {
    this.core.cancelSession(sessionId);
    for (const [id, waiting] of this.pending) {
      if (waiting.intent.sessionId !== sessionId) continue;
      waiting.resolve(legacyDecision('blocked', 'Session cancelled.', id));
      this.pending.delete(id);
    }
  }

  subscribe(listener: LegacyPolicyListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getAudit(): LegacyPolicyAuditEvent[] {
    return this.audit.map(event => ({ ...event }));
  }

  private forwardAudit(event: ScopedPolicyAuditEvent): void {
    const legacy: LegacyPolicyAuditEvent = {
      id: event.id,
      timestamp: event.timestamp,
      type: event.kind === 'scope_set'
        ? 'scope.changed'
        : event.outcome === 'allowed'
          ? 'action.allowed'
          : event.outcome === 'pending'
            ? 'approval.requested'
            : event.outcome === 'denied'
              ? 'action.blocked'
              : 'approval.resolved',
      sessionId: event.sessionId ?? '',
      capability: event.capability as ActionCapability | undefined,
      target: event.resource?.origin ?? event.resource?.path,
      reason: event.reasonCodes.join(', '),
    };
    this.audit.push(legacy);
    if (this.audit.length > DEFAULT_SCOPE_LIMITS.maxAuditEvents) this.audit.shift();
    for (const listener of this.listeners) listener(legacy);
  }

  private emitApprovalRequest(approval: PolicyApproval, intent: ActionIntent): void {
    const request: PolicyApprovalRequest & LegacyApprovalRequest = {
      id: approval.id,
      intent: {
        ...intent,
        url: intent.url ? redactText(intent.url, 2_048) : undefined,
        details: undefined,
      },
      scopeId: this.legacyScope?.id ?? '',
      expiresAt: approval.expiresAt,
      actionDigest: approval.actionDigest,
      approval: { ...approval },
      action: redactText(intent.summary, 512) ?? intent.capability,
      capability: intent.capability,
      url: intent.url ? redactText(intent.url, 2_048) : undefined,
    };
    for (const listener of this.listeners) listener(request);
  }
}

const DEFAULT_TASK_SCOPE: TaskScope = {
  id: 'demo-scoped-task',
  name: 'Demo scoped task',
  goal: '',
  allowedDomains: ['*'],
  requireApprovalFor: ['browser.navigate', 'browser.click', 'browser.type', 'browser.keypress', 'browser.tab'],
  maxActions: 100,
};

export const policyGate = new PolicyGate();
policyGate.setScope(DEFAULT_TASK_SCOPE);
