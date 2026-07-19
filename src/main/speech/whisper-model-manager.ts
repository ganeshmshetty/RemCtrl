import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

export type WhisperModelStatus = 'not_installed' | 'downloading' | 'verifying' | 'installed' | 'error';

export interface WhisperModelDefinition {
  fileName: string;
  url: string;
  sha1: string;
  sizeBytes: number;
}

export interface WhisperModelState {
  status: WhisperModelStatus;
  fileName: string;
  sizeBytes: number;
  bytesDownloaded: number;
  progress: number | null;
  verified: boolean;
  error?: string;
}

export const DEFAULT_WHISPER_MODEL: WhisperModelDefinition = {
  fileName: 'ggml-tiny.en.bin',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
  sha1: 'bd577a113a864445d4c299885e0cb97d4ba92b5f',
  sizeBytes: 75 * 1024 * 1024,
};

interface FetchResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
}

type FetchImplementation = (url: string, init: { signal: AbortSignal }) => Promise<FetchResponse>;

export interface WhisperModelManagerOptions {
  userDataPath: string;
  model?: WhisperModelDefinition;
  fetchImpl?: FetchImplementation;
  onStateChange?: (state: WhisperModelState) => void;
}

export interface WhisperModelManager {
  getState(): Promise<WhisperModelState>;
  getModelPath(): string;
  download(): Promise<WhisperModelState>;
  cancel(): void;
  retry(): Promise<WhisperModelState>;
}

const stateFor = (model: WhisperModelDefinition, status: WhisperModelStatus, partial: Partial<WhisperModelState> = {}): WhisperModelState => ({
  status,
  fileName: model.fileName,
  sizeBytes: model.sizeBytes,
  bytesDownloaded: 0,
  progress: status === 'installed' ? 1 : null,
  verified: status === 'installed',
  ...partial,
});

async function sha1File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha1');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export function createWhisperModelManager({
  userDataPath,
  model = DEFAULT_WHISPER_MODEL,
  fetchImpl = fetch as unknown as FetchImplementation,
  onStateChange,
}: WhisperModelManagerOptions): WhisperModelManager {
  const modelDirectory = path.join(userDataPath, 'whisper');
  const modelPath = path.join(modelDirectory, model.fileName);
  const temporaryPath = path.join(modelDirectory, `.${model.fileName}.download`);
  let abortController: AbortController | null = null;
  let state = stateFor(model, 'not_installed');

  const publish = (next: WhisperModelState) => {
    state = next;
    onStateChange?.(state);
    return state;
  };

  const cleanupTemporaryFile = async () => {
    await rm(temporaryPath, { force: true });
  };

  const inspectInstalledModel = async (): Promise<WhisperModelState> => {
    if (abortController) return state;
    try {
      await stat(modelPath);
      const digest = await sha1File(modelPath);
      if (digest === model.sha1) return publish(stateFor(model, 'installed', { bytesDownloaded: model.sizeBytes }));
      await rm(modelPath, { force: true });
      return publish(stateFor(model, 'not_installed', { error: 'The local Whisper model failed integrity verification and was removed.' }));
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      if (code === 'ENOENT') return publish(stateFor(model, 'not_installed'));
      return publish(stateFor(model, 'error', { error: 'Unable to inspect the local Whisper model.' }));
    }
  };

  const download = async (): Promise<WhisperModelState> => {
    if (abortController) return state;
    abortController = new AbortController();
    const activeController = abortController;
    let handle: Awaited<ReturnType<typeof open>> | null = null;

    try {
      await mkdir(modelDirectory, { recursive: true });
      await cleanupTemporaryFile();
      publish(stateFor(model, 'downloading', { progress: 0 }));

      const response = await fetchImpl(model.url, { signal: activeController.signal });
      if (!response.ok || !response.body) {
        throw new Error(`Model download failed with HTTP ${response.status}.`);
      }

      const contentLength = Number(response.headers.get('content-length'));
      const totalBytes = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : model.sizeBytes;
      const reader = response.body.getReader();
      let bytesDownloaded = 0;
      handle = await open(temporaryPath, 'w');

      while (true) {
        if (activeController.signal.aborted) throw new DOMException('Download cancelled', 'AbortError');
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        await handle.write(value);
        bytesDownloaded += value.byteLength;
        publish(stateFor(model, 'downloading', {
          bytesDownloaded,
          progress: Math.min(1, bytesDownloaded / totalBytes),
        }));
      }

      if (activeController.signal.aborted) throw new DOMException('Download cancelled', 'AbortError');
      await handle.close();
      handle = null;
      publish(stateFor(model, 'verifying', { bytesDownloaded, progress: 1 }));
      const digest = await sha1File(temporaryPath);
      if (digest !== model.sha1) {
        throw new Error('Downloaded model failed integrity verification. Retry the download.');
      }

      await rm(modelPath, { force: true });
      await rename(temporaryPath, modelPath);
      return publish(stateFor(model, 'installed', { bytesDownloaded, progress: 1 }));
    } catch (error) {
      await cleanupTemporaryFile();
      if (activeController.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        return publish(stateFor(model, 'not_installed'));
      }
      const message = error instanceof Error ? error.message : 'Unable to download the local Whisper model.';
      return publish(stateFor(model, 'error', { error: message }));
    } finally {
      await handle?.close();
      if (abortController === activeController) abortController = null;
    }
  };

  return {
    getState: inspectInstalledModel,
    getModelPath: () => modelPath,
    download,
    cancel: () => abortController?.abort(),
    retry: download,
  };
}
