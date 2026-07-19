import { describe, expect, it } from 'vitest';
import {
  buildManagedChromeLaunchArgs,
  buildManagedPersistentContextOptions,
  MANAGED_BROWSER_WINDOW,
} from './browser-launch-options.js';

describe('managed browser launch options', () => {
  it('keeps persistent context launch behavior independent of Playwright viewport sizing', () => {
    const options = buildManagedPersistentContextOptions({
      remoteDebuggingPort: 9223,
      headless: false,
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    });

    expect(options.args).toContain('--remote-debugging-port=9223');
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

  it('keeps detached-only flags out of persistent headless context options', () => {
    const options = buildManagedPersistentContextOptions({
      remoteDebuggingPort: 9223,
      headless: true,
    });

    expect(options.headless).toBe(true);
    expect(options.args).toContain('--remote-debugging-port=9223');
    expect(options.args).not.toContain('--headless=new');
    expect(options.args).not.toContain('--user-data-dir=/tmp/remotectrl-profile');
    expect(options.args).not.toContain(`--window-size=${MANAGED_BROWSER_WINDOW.width},${MANAGED_BROWSER_WINDOW.height}`);
    expect(options.args).not.toContain(`--window-position=${MANAGED_BROWSER_WINDOW.x},${MANAGED_BROWSER_WINDOW.y}`);
  });
});
