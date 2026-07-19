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
  const manager = createWhisperModelManager({
    userDataPath: app.getPath('userData'),
    onStateChange: (model) => {
      if (mainRuntime) broadcastToRenderers('speech:stateChanged', toSetupState(model, mainRuntime));
    },
  });
  const runtime: LocalWhisperRuntime = createLocalWhisperRuntime({ modelDirectory: manager.getModelPath() });
  mainManager = manager;
  mainRuntime = runtime;
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
  ipc.handle('speech:transcribe', async (...args) => {
    if (args.length !== 2) throw new TypeError('Speech transcription IPC requires one audio payload.');
    const audio = args[1];
    if (!(audio instanceof Float32Array)) throw new TypeError('Speech transcription requires a Float32Array audio payload.');
    const model = await services.manager.getState();
    if (model.status !== 'installed' || !model.verified) {
      throw new Error('Download and verify the local Whisper model in Settings before dictating.');
    }
    const availability = services.runtime.getAvailability();
    if (!availability.available) throw new Error(availability.message);
    return services.runtime.transcribe(audio);
  });
}
