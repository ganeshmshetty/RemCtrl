import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isEmptyProfile } from './browser-discovery.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('browser discovery helpers', () => {
  it('recognizes missing and initialized profile directories', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'remotectrl-profile-'));
    temporaryDirectories.push(directory);

    expect(isEmptyProfile(path.join(directory, 'missing'))).toBe(true);
    expect(isEmptyProfile(directory)).toBe(true);

    fs.mkdirSync(path.join(directory, 'Default'));
    fs.writeFileSync(path.join(directory, 'Default', 'Preferences'), '{}');
    expect(isEmptyProfile(directory)).toBe(false);
  });
});
