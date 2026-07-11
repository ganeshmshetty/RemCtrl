/**
 * StallDetector - Detects when an agent is stuck in a loop or making no progress
 * Adapted from Open Browser's stall detection implementation
 */

import type { Page } from 'playwright';

// ─── Page Fingerprint ────────────────────────────────────────────────────────

export interface PageFingerprint {
  url: string;
  domHash: string;
  elementCount: number;
  scrollY: number;
  timestamp: number;
}

// ─── Stall Detection Configuration ─────────────────────────────────────────

export interface StallDetectorConfig {
  /** Max times the same action can repeat before flagging */
  maxRepeatedActions: number;
  /** Max consecutive identical page fingerprints */
  maxRepeatedFingerprints: number;
  /** Window size for history analysis */
  windowSize: number;
  /** Number of consecutive stagnant pages before raising stall alert */
  maxStagnantPages: number;
}

const DEFAULT_CONFIG: StallDetectorConfig = {
  maxRepeatedActions: 3,
  maxRepeatedFingerprints: 3,
  windowSize: 10,
  maxStagnantPages: 5,
};

// ─── Stall Check Result ────────────────────────────────────────────────────

export interface StallCheckResult {
  stuck: boolean;
  reason?: string;
  /** Escalation level: 0 = not stuck, 1 = mild, 2 = moderate, 3 = severe */
  severity: number;
}

// ─── Escalating Nudge Messages ─────────────────────────────────────────────

const ESCALATING_NUDGES = [
  {
    threshold: 5,
    severity: 1,
    message:
      'You seem to be repeating similar actions. Consider trying a different approach:\n' +
      '- Click a different element\n' +
      '- Try an alternative navigation path\n' +
      '- Use search to find what you need',
  },
  {
    threshold: 9,
    severity: 2,
    message:
      'WARNING: You are stuck in a loop and have been repeating actions. You MUST change your approach:\n' +
      '- Navigate to a completely different page\n' +
      '- Try a fundamentally different strategy\n' +
      "- If the current approach is not working, consider reporting that the task can't be completed",
  },
  {
    threshold: 12,
    severity: 3,
    message:
      'CRITICAL: You have been stuck for many steps. This approach is NOT working.\n' +
      'You MUST either:\n' +
      '1. Report that the task cannot be completed with your current approach\n' +
      '2. Navigate to a completely different website or page\n' +
      '3. Try a radically different interaction method\n' +
      'Do NOT repeat the same actions again.',
  },
];

// ─── StallDetector Class ───────────────────────────────────────────────────

export class StallDetector {
  private actionHistory: string[] = [];
  private fingerprintHistory: PageFingerprint[] = [];
  private totalRepetitions = 0;
  private lastCountedActionLen = 0;
  private lastCountedFpLen = 0;
  private cachedStuckResult: StallCheckResult | null = null;
  private config: StallDetectorConfig;

  constructor(config?: Partial<StallDetectorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record an action for stall detection.
   * Normalizes actions to detect semantic duplicates (e.g., clicking same element twice).
   */
  recordAction(actionType: string, targetInfo: string): void {
    const key = this.normalizeAction(actionType, targetInfo);
    this.actionHistory.push(key);

    // Keep only the window
    if (this.actionHistory.length > this.config.windowSize * 2) {
      this.actionHistory = this.actionHistory.slice(-this.config.windowSize * 2);
    }
  }

  /**
   * Record a page fingerprint for stall detection.
   */
  recordFingerprint(fingerprint: PageFingerprint): void {
    this.fingerprintHistory.push(fingerprint);

    if (this.fingerprintHistory.length > this.config.windowSize * 2) {
      this.fingerprintHistory = this.fingerprintHistory.slice(-this.config.windowSize * 2);
    }
  }

  /**
   * Check if the agent appears to be stuck.
   */
  isStuck(): StallCheckResult {
    // If neither action history nor fingerprint history has changed since last evaluation, return cached result
    if (
      this.cachedStuckResult &&
      this.actionHistory.length === this.lastCountedActionLen &&
      this.fingerprintHistory.length === this.lastCountedFpLen
    ) {
      return this.cachedStuckResult;
    }

    const isNewObservation =
      this.actionHistory.length !== this.lastCountedActionLen ||
      this.fingerprintHistory.length !== this.lastCountedFpLen;

    if (isNewObservation) {
      this.lastCountedActionLen = this.actionHistory.length;
      this.lastCountedFpLen = this.fingerprintHistory.length;
    }

    const computeResult = (): StallCheckResult => {
      // Check for repeated actions
      const actionRepetitions = this.countTrailingRepetitions(this.actionHistory);

      if (actionRepetitions >= this.config.maxRepeatedActions) {
        if (isNewObservation) this.totalRepetitions += actionRepetitions;
        const severity = Math.max(1, this.getSeverity(actionRepetitions));
        return {
          stuck: true,
          reason: `Same action repeated ${actionRepetitions} times`,
          severity,
        };
      }

      // Check for action cycle (A -> B -> A -> B)
      if (this.actionHistory.length >= 4) {
        const last4 = this.actionHistory.slice(-4);
        if (last4[0] === last4[2] && last4[1] === last4[3]) {
          if (isNewObservation) this.totalRepetitions += 2;
          return {
            stuck: true,
            reason: 'Detected action cycle (alternating between two actions)',
            severity: Math.max(1, this.getSeverity(this.totalRepetitions)),
          };
        }
      }

      // Check for triple cycle (A -> B -> C -> A -> B -> C)
      if (this.actionHistory.length >= 6) {
        const last6 = this.actionHistory.slice(-6);
        if (
          last6[0] === last6[3] &&
          last6[1] === last6[4] &&
          last6[2] === last6[5]
        ) {
          if (isNewObservation) this.totalRepetitions += 3;
          return {
            stuck: true,
            reason: 'Detected 3-step action cycle',
            severity: Math.max(1, this.getSeverity(this.totalRepetitions)),
          };
        }
      }

      // Check for repeated fingerprints (same page state)
      const fpRepetitions = this.countTrailingRepetitions(
        this.fingerprintHistory.map((fp) => this.hashFingerprint(fp)),
      );

      if (fpRepetitions >= this.config.maxRepeatedFingerprints) {
        if (isNewObservation) this.totalRepetitions += fpRepetitions;
        return {
          stuck: true,
          reason: `Page state unchanged for ${fpRepetitions} steps`,
          severity: Math.max(1, this.getSeverity(fpRepetitions)),
        };
      }

      // Check for consecutive stagnant pages
      const stagnantCount = this.countConsecutiveStagnantPages();
      if (stagnantCount >= this.config.maxStagnantPages) {
        if (isNewObservation) this.totalRepetitions += stagnantCount;
        return {
          stuck: true,
          reason: `Page appears stagnant for ${stagnantCount} consecutive steps (same URL and element structure)`,
          severity: Math.max(1, this.getSeverity(stagnantCount)),
        };
      }

      return { stuck: false, severity: 0 };
    };

    const res = computeResult();
    this.cachedStuckResult = res;
    return res;
  }

  /**
   * Get a helpful nudge message if stuck.
   */
  getLoopNudgeMessage(): string {
    const result = this.isStuck();
    if (!result.stuck) {
      return '';
    }

    const nudge = this.getEscalatingNudge();
    return `Warning: ${result.reason ?? 'You appear to be stuck'}.\n${nudge}`;
  }

  /**
   * Get total number of detected repetitions across the session.
   */
  getTotalRepetitions(): number {
    return this.totalRepetitions;
  }

  /**
   * Reset the stall detector state.
   */
  reset(): void {
    this.actionHistory = [];
    this.fingerprintHistory = [];
    this.totalRepetitions = 0;
    this.lastCountedActionLen = 0;
    this.lastCountedFpLen = 0;
    this.cachedStuckResult = null;
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  /**
   * Normalize action for better deduplication.
   */
  private normalizeAction(actionType: string, targetInfo: string): string {
    const type = actionType.toLowerCase();
    
    // Normalize common actions
    if (type === 'click' || type === 'tap') {
      return `click:${targetInfo}`;
    }
    
    if (type === 'type' || type === 'input_text') {
      // Include the text being typed
      return `type:${targetInfo}`;
    }
    
    if (type === 'navigate' || type === 'goto') {
      // Just the URL
      return `navigate:${targetInfo}`;
    }
    
    if (type === 'scroll') {
      return `scroll:${targetInfo}`;
    }
    
    // Generic fallback
    return `${actionType}:${targetInfo}`;
  }

  /**
   * Hash a page fingerprint for quick equality checks.
   */
  private hashFingerprint(fp: PageFingerprint): string {
    const scrollBucket = Math.floor(fp.scrollY / 200);
    return `${fp.url}|${fp.domHash}|${scrollBucket}|e:${fp.elementCount}`;
  }

  /**
   * Count how many trailing entries in a history array are identical.
   */
  private countTrailingRepetitions(history: string[]): number {
    if (history.length === 0) return 0;
    
    const last = history[history.length - 1];
    let count = 0;
    
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i] === last) {
        count++;
      } else {
        break;
      }
    }
    
    return count;
  }

  /**
   * Count consecutive stagnant pages: same URL and similar element count.
   */
  private countConsecutiveStagnantPages(): number {
    if (this.fingerprintHistory.length < 2) return 0;

    const latest = this.fingerprintHistory[this.fingerprintHistory.length - 1];
    let count = 1;

    for (let i = this.fingerprintHistory.length - 2; i >= 0; i--) {
      const fp = this.fingerprintHistory[i];
      
      // Check URL match
      if (fp.url !== latest.url) break;

      // Check element count similarity (within 5% or 10 elements)
      if (latest.elementCount !== 0 && fp.elementCount !== 0) {
        const diff = Math.abs(latest.elementCount - fp.elementCount);
        const threshold = Math.max(10, Math.floor(latest.elementCount * 0.05));
        if (diff > threshold) break;
      }

      count++;
    }

    return count;
  }

  /**
   * Map repetition count to severity level (0-3).
   */
  private getSeverity(repetitions: number): number {
    if (repetitions >= 12) return 3;
    if (repetitions >= 9) return 2;
    if (repetitions >= 5) return 1;
    return 0;
  }

  /**
   * Get the appropriate escalating nudge message based on total repetitions.
   */
  private getEscalatingNudge(): string {
    let bestNudge = ESCALATING_NUDGES[0];
    
    for (const nudge of ESCALATING_NUDGES) {
      if (this.totalRepetitions >= nudge.threshold) {
        bestNudge = nudge;
      }
    }
    
    return bestNudge.message;
  }
}

// ─── Page Fingerprint Utilities ────────────────────────────────────────────

/**
 * Compute a fast hash of a DOM tree string.
 * Used for quick fingerprint comparison.
 */
export function hashPageTree(domTree: string): string {
  let hash = 0;
  for (let i = 0; i < domTree.length; i++) {
    const char = domTree.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return hash.toString(36);
}

/**
 * Compute a content-based text hash from visible page text.
 * More robust than DOM hash for detecting actual content changes.
 */
export function hashTextContent(text: string): string {
  const normalized = text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim();

  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return hash.toString(36);
}

/**
 * Create a page fingerprint from current page state.
 */
export async function createPageFingerprint(page: Page): Promise<PageFingerprint> {
  const url = page.url();
  const [domContent, elementCount, scrollY] = await Promise.all([
    // @ts-ignore
    page.evaluate(() => document.documentElement.outerHTML),
    page.locator('*').count(),
    // @ts-ignore
    page.evaluate(() => window.scrollY),
  ]);

  return {
    url,
    domHash: hashPageTree(domContent),
    elementCount,
    scrollY,
    timestamp: Date.now(),
  };
}
