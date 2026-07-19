import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

export type WhisperModelStatus = 'not_installed' | 'downloading' | 'verifying' | 'installed' | 'error';

export interface WhisperModelFile {
  path: string;
  url: string;
  sha256: string;
  sizeBytes: number;
}

export interface WhisperModelDefinition {
  fileName: string;
  modelId: string;
  revision: string;
  files: readonly WhisperModelFile[];
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

const MODEL_REPOSITORY = 'https://huggingface.co/onnx-community/whisper-tiny.en';
const MODEL_REVISION = '3a6d57ee9c665610614068e8592d8baee0188181';
const modelFile = (relativePath: string, sizeBytes: number, sha256: string): WhisperModelFile => ({
  path: relativePath,
  url: `${MODEL_REPOSITORY}/resolve/${MODEL_REVISION}/${relativePath}`,
  sizeBytes,
  sha256,
});

/**
 * Immutable Transformers.js Whisper tiny.en manifest. The ONNX digests are
 * the Git LFS object digests from the pinned upstream revision.
 */
export const DEFAULT_WHISPER_MODEL: WhisperModelDefinition = {
  fileName: 'whisper-tiny.en',
  modelId: 'whisper-tiny.en',
  revision: MODEL_REVISION,
  files: [
    modelFile('config.json', 2197, '251ea843b5901a99efa58c0b99b8052c6019aa3e7d2baf46693a1128ff606233'),
    modelFile('generation_config.json', 1646, '7b2e8451ed5f118e75fdd991409d72119d21d2fef1eba9723f68fb9c57fe5dc9'),
    modelFile('preprocessor_config.json', 339, 'a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d'),
    modelFile('vocab.json', 999186, 'f6bd25a65e4e63ca31360e9fb11c7e4f9a391a78385d640acd814092dd6eee4f'),
    modelFile('tokenizer.json', 2405679, '5eb60cec1e77aeeb6869a2bb5a8e01a84c3fe5d072d75369343021fe6f5310d0'),
    modelFile('tokenizer_config.json', 282662, '93879c3dccdd4b976f709acd85b44778873f30c275e67026f30ca1e4c975230c'),
    modelFile('merges.txt', 456318, '1ce1664773c50f3e0cc8842619a93edc4624525b728b188a9e0be33b7726adc5'),
    modelFile('normalizer.json', 52666, 'bf1c507dc8724ca9cf9903640dacfb69dae2f00edee4f21ceba106a7392f26dd'),
    modelFile('special_tokens_map.json', 2173, '98bdf3ec5b32e31575b02f64b0a32bde7c0449075d34484a7df9bdd3cdeb9fb9'),
    modelFile('added_tokens.json', 34604, '560be47bea388757f8d4cc185c5d82067426cbb6361e38016dd90ddc01ab203a'),
    modelFile('onnx/encoder_model_quantized.onnx', 10124993, 'e93ec822f16a8fd264e7de972ad17d615ea7334b75a52d54c50c2e18dd503a25'),
    modelFile('onnx/decoder_model_merged_quantized.onnx', 30718858, 'c0592d0749413c960569e1c7fb806b060d5d18f3ebad4a95cbf9a77dc6e9be52'),
  ],
};

interface FetchResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
}

type FetchImplementation = (url: string, init: { signal: AbortSignal }) => Promise<FetchResponse>;

type FileHandle = Awaited<ReturnType<typeof open>>;
type FileSystem = {
  mkdir: typeof mkdir;
  open: typeof open;
  rename: typeof rename;
  rm: typeof rm;
  stat: typeof stat;
};

export interface WhisperModelManagerOptions {
  userDataPath: string;
  model?: WhisperModelDefinition;
  fetchImpl?: FetchImplementation;
  onStateChange?: (state: WhisperModelState) => void;
  fileSystem?: FileSystem;
}

export interface WhisperModelManager {
  getState(): Promise<WhisperModelState>;
  /** Retained for the existing internal seam; IPC never returns this path. */
  getModelPath(): string;
  getModelDirectory?: () => string;
  download(): Promise<WhisperModelState>;
  cancel(): void;
  retry(): Promise<WhisperModelState>;
}

const totalSize = (model: WhisperModelDefinition) => model.files.reduce((sum, file) => sum + file.sizeBytes, 0);

const stateFor = (model: WhisperModelDefinition, status: WhisperModelStatus, partial: Partial<WhisperModelState> = {}): WhisperModelState => ({
  status,
  fileName: model.fileName,
  sizeBytes: totalSize(model),
  bytesDownloaded: 0,
  progress: status === 'installed' ? 1 : null,
  verified: status === 'installed',
  ...partial,
});

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function safeModelPath(root: string, relativePath: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(root, relativePath);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Invalid model manifest path: ${relativePath}`);
  }
  return resolvedPath;
}

async function closeFile(handle: FileHandle | null): Promise<null> {
  if (handle) await handle.close();
  return null;
}

export function createWhisperModelManager({
  userDataPath,
  model = DEFAULT_WHISPER_MODEL,
  fetchImpl = fetch as unknown as FetchImplementation,
  onStateChange,
  fileSystem = { mkdir, open, rename, rm, stat },
}: WhisperModelManagerOptions): WhisperModelManager {
  const modelRoot = path.join(userDataPath, 'whisper');
  const modelDirectory = path.join(modelRoot, model.modelId);
  const previousDirectory = path.join(modelRoot, `.${model.modelId}.previous`);
  const temporaryDirectory = path.join(modelRoot, `.${model.modelId}.download`);
  const modelBytes = totalSize(model);
  let abortController: AbortController | null = null;
  let state = stateFor(model, 'not_installed');

  const publish = (next: WhisperModelState) => {
    state = next;
    onStateChange?.(state);
    return state;
  };

  const cleanupTemporaryDirectory = async () => {
    await fileSystem.rm(temporaryDirectory, { force: true, recursive: true });
  };

  const inspectInstalledModel = async (): Promise<WhisperModelState> => {
    if (abortController) return state;
    try {
      for (const file of model.files) {
        const filePath = safeModelPath(modelDirectory, file.path);
        const details = await fileSystem.stat(filePath);
        if (details.size !== file.sizeBytes || await sha256File(filePath) !== file.sha256) {
          await fileSystem.rm(modelDirectory, { force: true, recursive: true });
          return publish(stateFor(model, 'not_installed', { error: 'The local Whisper model failed integrity verification and was removed.' }));
        }
      }
      return publish(stateFor(model, 'installed', { bytesDownloaded: modelBytes }));
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
    let bytesDownloaded = 0;

    try {
      await fileSystem.mkdir(modelRoot, { recursive: true });
      await cleanupTemporaryDirectory();
      await fileSystem.mkdir(temporaryDirectory, { recursive: true });
      publish(stateFor(model, 'downloading', { progress: 0 }));

      for (const file of model.files) {
        const response = await fetchImpl(file.url, { signal: activeController.signal });
        if (!response.ok || !response.body) throw new Error(`Model download failed with HTTP ${response.status}.`);

        const filePath = safeModelPath(temporaryDirectory, file.path);
        await fileSystem.mkdir(path.dirname(filePath), { recursive: true });
        const reader = response.body.getReader();
        let handle: FileHandle | null = null;
        try {
          handle = await fileSystem.open(filePath, 'w');
          while (true) {
            if (activeController.signal.aborted) throw new DOMException('Download cancelled', 'AbortError');
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;
            await handle.write(value);
            bytesDownloaded += value.byteLength;
            publish(stateFor(model, 'downloading', {
              bytesDownloaded,
              progress: Math.min(1, bytesDownloaded / modelBytes),
            }));
          }
        } finally {
          handle = await closeFile(handle);
        }

        publish(stateFor(model, 'verifying', { bytesDownloaded, progress: bytesDownloaded / modelBytes }));
        const actualSize = (await fileSystem.stat(filePath)).size;
        const actualSha256 = await sha256File(filePath);
        if (actualSize !== file.sizeBytes || actualSha256 !== file.sha256) {
          throw new Error(`Downloaded ${file.path} failed integrity verification. Retry the download.`);
        }
      }

      if (activeController.signal.aborted) throw new DOMException('Download cancelled', 'AbortError');
      await fileSystem.rm(previousDirectory, { force: true, recursive: true });
      try {
        await fileSystem.rename(modelDirectory, previousDirectory);
      } catch (error) {
        const code = error instanceof Error && 'code' in error ? error.code : undefined;
        if (code !== 'ENOENT') throw error;
      }
      try {
        await fileSystem.rename(temporaryDirectory, modelDirectory);
      } catch (error) {
        try {
          await fileSystem.rename(previousDirectory, modelDirectory);
        } catch {
          // Preserve the original install error; inspection will report the missing model.
        }
        throw error;
      }
      await fileSystem.rm(previousDirectory, { force: true, recursive: true });
      return publish(stateFor(model, 'installed', { bytesDownloaded, progress: 1 }));
    } catch (error) {
      await cleanupTemporaryDirectory();
      if (activeController.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        return publish(stateFor(model, 'not_installed', { bytesDownloaded }));
      }
      const message = error instanceof Error ? error.message : 'Unable to download the local Whisper model.';
      return publish(stateFor(model, 'error', { error: message, bytesDownloaded }));
    } finally {
      if (abortController === activeController) abortController = null;
    }
  };

  return {
    getState: inspectInstalledModel,
    getModelPath: () => modelDirectory,
    getModelDirectory: () => modelDirectory,
    download,
    cancel: () => abortController?.abort(),
    retry: download,
  };
}
