export type AutomationSecurityMode = 'local' | 'policy-enforced';

export function securityModeFromEnforcement(enforceScope: boolean): AutomationSecurityMode {
  return enforceScope ? 'policy-enforced' : 'local';
}

export function isPolicyEnforced(mode: AutomationSecurityMode): boolean {
  return mode === 'policy-enforced';
}
