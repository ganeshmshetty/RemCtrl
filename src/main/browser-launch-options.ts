export const MANAGED_BROWSER_WINDOW = {
  width: 1280,
  height: 800,
  x: 100,
  y: 100,
} as const;

export interface ManagedChromeLaunchConfig {
  remoteDebuggingPort: number;
  userDataDir: string;
  headless: boolean;
}

export function buildManagedChromeLaunchArgs({
  remoteDebuggingPort,
  userDataDir,
  headless,
}: ManagedChromeLaunchConfig): string[] {
  const args = [
    `--remote-debugging-port=${remoteDebuggingPort}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${MANAGED_BROWSER_WINDOW.width},${MANAGED_BROWSER_WINDOW.height}`,
    `--window-position=${MANAGED_BROWSER_WINDOW.x},${MANAGED_BROWSER_WINDOW.y}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--test-type',
  ];

  if (headless) args.push('--headless=new');
  return args;
}

export interface ManagedPersistentContextOptions {
  headless: boolean;
  executablePath?: string;
  args: string[];
}

export function buildManagedPersistentContextOptions({
  remoteDebuggingPort,
  headless,
  executablePath,
}: Pick<ManagedChromeLaunchConfig, 'remoteDebuggingPort' | 'headless'> & { executablePath?: string }): ManagedPersistentContextOptions {
  return {
    headless,
    ...(executablePath ? { executablePath } : {}),
    // Persistent contexts own the profile and headless lifecycle through
    // Playwright. Keep detached-only profile/window/headless flags out of this
    // path so its existing launch contract remains unchanged.
    args: [
      `--remote-debugging-port=${remoteDebuggingPort}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--test-type',
    ],
  };
}
