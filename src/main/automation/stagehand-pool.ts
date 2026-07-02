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

let activeStagehand: Stagehand | null = null;
let activeCdpUrl: string | null = null;
let activeModelName: string | null = null;
let pendingInit: Promise<Stagehand> | null = null;

export async function getStagehand(
  cdpUrl: string,
  config: StagehandModelConfig,
  onLog: (level: AgentLogPayload['level'], msg: string) => void,
): Promise<Stagehand> {
  if (pendingInit) {
    onLog('info', '[StagehandPool] Awaiting in-flight Stagehand initialization...');
    return pendingInit;
  }

  // Reuse existing instance if connected to same CDP URL and model
  if (activeStagehand && activeCdpUrl === cdpUrl && activeModelName === config.modelName) {
    onLog('info', '[StagehandPool] Reusing active Stagehand singleton instance.');
    return activeStagehand;
  }

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
    try {
      await Promise.race([
        instance.init(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Stagehand init timed out after 30s')), 30000),
        ),
      ]);
    } catch (initErr: any) {
      throw new StagehandConnectionError(initErr?.message ?? String(initErr));
    }
    onLog('info', '[StagehandPool] Stagehand ready.');

    activeStagehand = instance;
    activeCdpUrl = cdpUrl;
    activeModelName = config.modelName;
    return instance;
  })();

  try {
    return await pendingInit;
  } finally {
    pendingInit = null;
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
    activeCdpUrl = null;
    activeModelName = null;
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
