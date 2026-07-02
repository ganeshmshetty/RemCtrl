/**
 * Stagehand Pool — Singleton Stagehand management for Automation Orchestrator
 *
 * Maintains a single Stagehand instance across commands and workflow steps,
 * saving ~500ms initialization time per task and accumulating cache context.
 * Features concurrency guards (pendingInit mutex) and init timeouts to prevent hangs.
 */

import { Stagehand } from '@browserbasehq/stagehand';
import { StagehandConnectionError } from '../errors.js';
import type { AgentLogPayload } from '../../shared/types.js';
import type { StagehandModelConfig } from './model-resolver.js';

interface TargetConfig {
  cdpUrl: string;
  modelName: string;
  apiKey: string;
  baseURL?: string;
}

function isSameConfig(a: TargetConfig | null, b: TargetConfig): boolean {
  if (!a) return false;
  return (
    a.cdpUrl === b.cdpUrl &&
    a.modelName === b.modelName &&
    a.apiKey === b.apiKey &&
    a.baseURL === b.baseURL
  );
}

let activeStagehand: Stagehand | null = null;
let activeConfig: TargetConfig | null = null;
let pendingInit: Promise<Stagehand> | null = null;
let pendingConfig: TargetConfig | null = null;

export async function getStagehand(
  cdpUrl: string,
  config: StagehandModelConfig,
  onLog: (level: AgentLogPayload['level'], msg: string) => void,
): Promise<Stagehand> {
  const requestedConfig: TargetConfig = {
    cdpUrl,
    modelName: config.modelName,
    apiKey: config.modelClientOptions.apiKey,
    baseURL: config.modelClientOptions.baseURL,
  };

  if (pendingInit) {
    if (isSameConfig(pendingConfig, requestedConfig)) {
      onLog('info', '[StagehandPool] Awaiting in-flight Stagehand initialization...');
      return pendingInit;
    }
    // If pending for a different config, wait for it to finish then replace it
    try {
      await pendingInit;
    } catch {
      // Ignore errors from the previous init
    }
  }

  // Reuse existing instance if connected to same CDP URL and model
  if (activeStagehand && isSameConfig(activeConfig, requestedConfig)) {
    onLog('info', '[StagehandPool] Reusing active Stagehand singleton instance.');
    return activeStagehand;
  }

  pendingConfig = requestedConfig;

  pendingInit = (async () => {
    // Otherwise, close old instance if present
    await closeStagehandInternal();

    onLog('info', `[StagehandPool] Creating new Stagehand singleton for CDP: ${cdpUrl}`);
    const instance = new Stagehand({
      env: 'LOCAL',
      localBrowserLaunchOptions: { cdpUrl },
      model: {
        modelName: config.modelName,
        apiKey: config.modelClientOptions.apiKey,
        baseURL: config.modelClientOptions.baseURL
      },
      logger: (logLine: any) => {
        const level = (logLine.level || 'info') as AgentLogPayload['level'];
        const msg: string =
          logLine.message ?? (typeof logLine === 'object' ? JSON.stringify(logLine) : String(logLine));
        onLog(level, `[Stagehand] ${msg}`);
      },
      verbose: 2,
    });

    onLog('info', '[StagehandPool] Initialising Stagehand...');
    let initTimeoutId: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        instance.init(),
        new Promise<never>((_, reject) => {
          initTimeoutId = setTimeout(() => reject(new Error('Stagehand init timed out after 30s')), 30000);
        }),
      ]);
    } catch (initErr: any) {
      await instance.close().catch(() => {});
      throw new StagehandConnectionError(initErr?.message ?? String(initErr));
    } finally {
      if (initTimeoutId) clearTimeout(initTimeoutId);
    }
    onLog('info', '[StagehandPool] Stagehand ready.');

    activeStagehand = instance;
    activeConfig = requestedConfig;
    return instance;
  })();

  try {
    return await pendingInit;
  } finally {
    // Only clear if we are still the pending config (avoids race if another call queued up)
    if (isSameConfig(pendingConfig, requestedConfig)) {
      pendingInit = null;
      pendingConfig = null;
    }
  }
}

async function closeStagehandInternal(): Promise<void> {
  if (activeStagehand) {
    try {
      await activeStagehand.close();
    } catch {
      // ignore errors on close
    }
    activeStagehand = null;
    activeConfig = null;
  }
}

export async function closeStagehand(): Promise<void> {
  if (pendingInit) {
    try {
      await pendingInit;
    } catch {
      // ignore init error if closing
    }
  }
  await closeStagehandInternal();
}
