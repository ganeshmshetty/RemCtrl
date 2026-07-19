import { app, ipcMain } from 'electron';
import type { LocalWhisperSetupState } from '../../shared/types.js';
import {
  createWhisperModelManager,
  type WhisperModelManager,
  type WhisperModelState,
} from '../speech/whisper-model-manager.js';
import { createLocalWhisperRuntime, type LocalWhisperRuntime } from '../speech/whisper-runtime.js';
import { broadcastToRenderers } from './renderer-events.js';

interface IpcMainLike {
  handle(channel: string, listener: (...args: unknown[]) => Promise<unknown>): void;
}

export interface RegisterSpeechIpcOptions {
  ipc?: IpcMainLike;
  manager?: WhisperModelManager;
  runtime?: LocalWhisperRuntime;
}

const toSetupState = (model: WhisperModelState, runtime: LocalWhisperRuntime): LocalWhisperSetupState => ({
  model,
  runtime: runtime.getAvailability(),
});

let mainManager: WhisperModelManager | null = null;
let mainRuntime: LocalWhisperRuntime | null = null;

function getMainServices() {
  if (mainManager && mainRuntime) return { manager: mainManager, runtime: mainRuntime };
  mainRuntime = createLocalWhisperRuntime();
  const runtime = mainRuntime;
  mainManager = createWhisperModelManager({
    userDataPath: app.getPath('userData'),
    onStateChange: (model) => broadcastToRenderers('speech:stateChanged', toSetupState(model, runtime)),
  });
  return { manager: mainManager, runtime };
}

export function registerSpeechIpc(options: RegisterSpeechIpcOptions = {}) {
  const ipc = options.ipc ?? (ipcMain as unknown as IpcMainLike);
  const services = options.manager && options.runtime
    ? { manager: options.manager, runtime: options.runtime }
    : getMainServices();
  const setupState = async () => toSetupState(await services.manager.getState(), services.runtime);
  const rejectPayload = (args: unknown[]) => {
    if (args.length > 1) throw new TypeError('Speech setup IPC does not accept renderer-supplied payloads.');
  };

  ipc.handle('speech:getSetupState', async (...args) => {
    rejectPayload(args);
    return setupState();
  });
  ipc.handle('speech:downloadModel', async (...args) => {
    rejectPayload(args);
    return toSetupState(await services.manager.download(), services.runtime);
  });
  ipc.handle('speech:cancelDownload', async (...args) => {
    rejectPayload(args);
    services.manager.cancel();
    return setupState();
  });
  ipc.handle('speech:retryDownload', async (...args) => {
    rejectPayload(args);
    return toSetupState(await services.manager.retry(), services.runtime);
  });
}
