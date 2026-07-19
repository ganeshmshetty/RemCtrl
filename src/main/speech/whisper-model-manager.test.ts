import { createHash } from 'node:crypto';
import * as nodeFs from 'node:fs/promises';
import { mkdtemp, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WHISPER_MODEL,
  createWhisperModelManager,
  type WhisperModelDefinition,
} from './whisper-model-manager.js';

const sha256 = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');

async function testDirectory() {
  return mkdtemp(join(tmpdir(), 'remotectrl-whisper-'));
}

function testModel(files: Record<string, Uint8Array>): WhisperModelDefinition {
  return {
    fileName: 'test-whisper',
    modelId: 'test-whisper',
    revision: 'test-revision',
    files: Object.entries(files).map(([filePath, bytes]) => ({
      path: filePath,
      url: `https://example.test/test-revision/${filePath}`,
      sha256: sha256(bytes),
      sizeBytes: bytes.byteLength,
    })),
  };
}

function fetchFor(files: Record<string, Uint8Array>) {
  return async (url: string) => {
    const filePath = url.split('/test-revision/')[1];
    const bytes = files[filePath];
    if (!bytes) return new Response(null, { status: 404 });
    return new Response(bytes, { headers: { 'content-length': String(bytes.byteLength) } });
  };
}

describe('local Whisper model manager', () => {
  it('pins the complete quantized tiny.en ONNX manifest to an immutable revision', () => {
    expect(DEFAULT_WHISPER_MODEL).toMatchObject({
      modelId: 'whisper-tiny.en',
      revision: '3a6d57ee9c665610614068e8592d8baee0188181',
    });
    expect(DEFAULT_WHISPER_MODEL.files).toHaveLength(12);
    expect(DEFAULT_WHISPER_MODEL.files).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'onnx/encoder_model_quantized.onnx',
        sizeBytes: 10124993,
        sha256: 'e93ec822f16a8fd264e7de972ad17d615ea7334b75a52d54c50c2e18dd503a25',
      }),
      expect.objectContaining({
        path: 'onnx/decoder_model_merged_quantized.onnx',
        sizeBytes: 30718858,
        sha256: 'c0592d0749413c960569e1c7fb806b060d5d18f3ebad4a95cbf9a77dc6e9be52',
      }),
      expect.objectContaining({ path: 'tokenizer.json', sizeBytes: 2405679 }),
    ]));
    expect(DEFAULT_WHISPER_MODEL.files.every((file) => file.url.includes(DEFAULT_WHISPER_MODEL.revision))).toBe(true);
  });

  it('downloads each asset, reports aggregate progress, verifies hashes, and atomically installs the directory', async () => {
    const files = {
      'config.json': new TextEncoder().encode('verified config'),
      'onnx/test.onnx': new TextEncoder().encode('verified local whisper model'),
    };
    const states: string[] = [];
    const manager = createWhisperModelManager({
      userDataPath: await testDirectory(),
      model: testModel(files),
      fetchImpl: fetchFor(files),
      onStateChange: (state) => states.push(state.status),
    });

    const state = await manager.download();

    expect(state.status).toBe('installed');
    expect(state.verified).toBe(true);
    expect(state.progress).toBe(1);
    expect(await readFile(join(manager.getModelPath(), 'onnx/test.onnx'))).toEqual(Buffer.from(files['onnx/test.onnx']));
    expect(states).toEqual(expect.arrayContaining(['downloading', 'verifying', 'installed']));
    expect(await stat(manager.getModelPath())).toBeTruthy();
    expect(await readdir(join(manager.getModelPath(), '..'))).not.toContain('.test-whisper.download');
  });

  it('removes a partial directory after cancellation', async () => {
    const bytes = new TextEncoder().encode('partial model bytes');
    const files = { 'model.onnx': bytes };
    let releaseFirstChunk: (() => void) | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 5));
        releaseFirstChunk = () => controller.close();
      },
    });
    const manager = createWhisperModelManager({
      userDataPath: await testDirectory(),
      model: testModel(files),
      fetchImpl: async () => new Response(body, { headers: { 'content-length': String(bytes.byteLength) } }),
    });

    const pending = manager.download();
    await new Promise((resolve) => setTimeout(resolve, 0));
    manager.cancel();
    releaseFirstChunk?.();
    const state = await pending;

    expect(state.status).toBe('not_installed');
    expect(await readdir(join(manager.getModelPath(), '..'))).not.toContain('.test-whisper.download');
  });

  it('closes each temporary file before deleting the temporary directory on stream failure', async () => {
    const bytes = new TextEncoder().encode('partial model bytes');
    let handleOpened = false;
    let handleClosed = false;
    const cleanupHandleStates: boolean[] = [];
    const fileSystem = {
      ...nodeFs,
      open: async (...args: Parameters<typeof nodeFs.open>) => {
        const fileHandle = await nodeFs.open(...args);
        handleOpened = true;
        const close = fileHandle.close.bind(fileHandle);
        fileHandle.close = async () => {
          handleClosed = true;
          return close();
        };
        return fileHandle;
      },
      rm: async (...args: Parameters<typeof nodeFs.rm>) => {
        if (handleOpened && args[0] !== join('/definitely-not-used', 'model')) {
          cleanupHandleStates.push(handleClosed);
          if (!handleClosed) throw new Error('EBUSY');
        }
        return nodeFs.rm(...args);
      },
    };
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.error(new Error('connection interrupted'));
      },
    });
    const manager = createWhisperModelManager({
      userDataPath: await testDirectory(),
      model: testModel({ 'model.onnx': bytes }),
      fetchImpl: async () => new Response(body),
      fileSystem,
    });

    const state = await manager.download();

    expect(state.status).toBe('error');
    expect(cleanupHandleStates).toEqual([true]);
  });

  it('allows retry after a failed download and never installs a mismatched model', async () => {
    const expected = new TextEncoder().encode('expected model');
    let attempts = 0;
    const files = { 'model.onnx': expected };
    const manager = createWhisperModelManager({
      userDataPath: await testDirectory(),
      model: testModel(files),
      fetchImpl: async () => {
        attempts += 1;
        return new Response(attempts === 1 ? 'wrong bytes' : expected);
      },
    });

    const failed = await manager.download();
    expect(failed.status).toBe('error');
    expect(failed.error).toMatch(/integrity/i);

    const retried = await manager.retry();
    expect(retried.status).toBe('installed');
    expect(attempts).toBe(2);
  });
});
