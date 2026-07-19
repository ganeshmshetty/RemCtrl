import { describe, expect, it } from 'vitest';
import {
  buildManagedChromeLaunchArgs,
  buildManagedPersistentContextOptions,
  MANAGED_BROWSER_WINDOW,
} from './browser-launch-options.js';

describe('managed browser launch options', () => {
  it('keeps a deterministic initial Chrome window without fixing the Playwright viewport', () => {
    const options = buildManagedPersistentContextOptions({
      remoteDebuggingPort: 9223,
      userDataDir: '/tmp/remotectrl-profile',
      headless: false,
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    });

    expect(options.args).toContain(`--window-size=${MANAGED_BROWSER_WINDOW.width},${MANAGED_BROWSER_WINDOW.height}`);
    expect(options.args).toContain(`--window-position=${MANAGED_BROWSER_WINDOW.x},${MANAGED_BROWSER_WINDOW.y}`);
    expect(options).not.toHaveProperty('viewport');
    expect(options.args).not.toContain('--headless=new');
  });

  it('preserves headless behavior in the Chrome process arguments', () => {
    const args = buildManagedChromeLaunchArgs({
      remoteDebuggingPort: 9223,
      userDataDir: '/tmp/remotectrl-profile',
      headless: true,
    });

    expect(args).toContain('--headless=new');
    expect(args).toContain('--no-first-run');
    expect(args).toContain('--disable-background-timer-throttling');
  });
});
