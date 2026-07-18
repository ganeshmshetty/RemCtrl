import { ipcMain } from 'electron';
import { PolicyApprovalResolutionSchema, TaskScopeSchema } from '../../shared/schemas.js';
import { policyGate } from '../policy/policy-gate.js';
import { getTaskScope, saveTaskScope } from '../storage.js';
import { broadcastToRenderers } from './renderer-events.js';

/** Exposes scope authoring and host-only approval decisions to the renderer. */
export function registerPolicyIpc() {
  const storedScope = getTaskScope();
  if (storedScope) policyGate.setScope(storedScope);
  policyGate.subscribe((event) => {
    const channel = 'approval' in event ? 'policy:approvalRequested' : 'policy:audit';
    broadcastToRenderers(channel, event);
  });

  ipcMain.handle('policy:getScope', () => policyGate.getScope());
  ipcMain.handle('policy:getAudit', () => policyGate.getAudit());
  ipcMain.handle('policy:setScope', (_event, rawScope: unknown) => {
    const parsed = TaskScopeSchema.safeParse(rawScope);
    if (!parsed.success) return { ok: false, error: parsed.error.issues.map((issue) => issue.message).join('; ') };
    policyGate.setScope(parsed.data);
    saveTaskScope(parsed.data);
    return { ok: true };
  });
  ipcMain.handle('policy:resolveApproval', (_event, raw: unknown) => {
    const parsed = PolicyApprovalResolutionSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: 'Invalid approval decision.' };
    const decision = policyGate.resolveApproval(parsed.data.approvalId, parsed.data.approved);
    return { ok: decision.decision !== 'blocked' || decision.reason === 'Action rejected by host.', error: decision.decision === 'blocked' ? decision.reason : undefined };
  });
}
