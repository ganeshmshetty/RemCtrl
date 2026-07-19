import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WHISPER_MODEL,
  createWhisperModelManager,
  type WhisperModelDefinition,
} from './whisper-model-manager.js';

const sha1 = (value: Uint8Array) => createHash('sha1').update(value).digest('hex');

async function testDirectory() {
  return mkdtemp(join(tmpdir(), 'remotectrl-whisper-'));
}

function testModel(bytes: Uint8Array): WhisperModelDefinition {
  return {
    fileName: 'ggml-tiny.en.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
    sha1: sha1(bytes),
    sizeBytes: bytes.byteLength,
  };
}

describe('local Whisper model manager', () => {
  it('pins the requested official tiny English model endpoint and digest', () => {
    expect(DEFAULT_WHISPER_MODEL).toMatchObject({
      fileName: 'ggml-tiny.en.bin',
      url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
      sha1: 'bd577a113a864445d4c299885e0cb97d4ba92b5f',
    });
  });

  it('downloads to app data, reports progress, and installs only after hash verification', async () => {
    const bytes = new TextEncoder().encode('verified local whisper model');
    const states: string[] = [];
    const manager = createWhisperModelManager({
      userDataPath: await testDirectory(),
      model: testModel(bytes),
      fetchImpl: async () => new Response(bytes, { headers: { 'content-length': String(bytes.byteLength) } }),
      onStateChange: (state) => states.push(state.status),
    });

    const state = await manager.download();

    expect(state.status).toBe('installed');
    expect(state.verified).toBe(true);
    expect(state.progress).toBe(1);
    expect(await readFile(manager.getModelPath())).toEqual(Buffer.from(bytes));
    expect(states).toEqual(expect.arrayContaining(['downloading', 'verifying', 'installed']));
  });

  it('removes a partial download after cancellation', async () => {
    const bytes = new TextEncoder().encode('partial model bytes');
    let releaseFirstChunk: (() => void) | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 5));
        releaseFirstChunk = () => controller.close();
      },
    });
    const manager = createWhisperModelManager({
      userDataPath: await testDirectory(),
      model: testModel(bytes),
      fetchImpl: async () => new Response(body, { headers: { 'content-length': String(bytes.byteLength) } }),
    });

    const pending = manager.download();
    await new Promise((resolve) => setTimeout(resolve, 0));
    manager.cancel();
    releaseFirstChunk?.();
    const state = await pending;

    expect(state.status).toBe('not_installed');
    expect(await readdir(join(manager.getModelPath(), '..'))).not.toContain('.ggml-tiny.en.bin.download');
  });

  it('allows retry after a failed download and never keeps a mismatched model', async () => {
    const expected = new TextEncoder().encode('expected model');
    let attempts = 0;
    const manager = createWhisperModelManager({
      userDataPath: await testDirectory(),
      model: testModel(expected),
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) return new Response('wrong bytes');
        return new Response(expected);
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
