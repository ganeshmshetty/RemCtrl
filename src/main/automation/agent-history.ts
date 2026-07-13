/**
 * @file agent-history.ts
 * @description State manager and memory compactor for agent run histories. Ensures long-running agents retain context without exceeding context window limits.
 * Key Exported APIs: `AgentHistoryManager` class, `HistoryTurnItem` interface, and the `sessionHistory` singleton instance.
 * Internal Mechanics: Records individual conversation turns containing request instructions, final outputs, and action arrays. Implements smart history context building (embedding prior summaries, last 4 turns) and asynchronous context compaction.
 * LLM Integration: Invokes `generateText` dynamically to summarize past history logs when the accumulated log sizes exceed thresholds (>5 turns or >25k chars) to prevent token bloat.
 */

import { generateText } from 'ai';

export interface HistoryTurnItem {
  turnIndex: number;
  userRequest: string;
  finalMessage?: string;
  actionsTaken: string[];
  commandId?: string;
}

export class AgentHistoryManager {
  private turns: HistoryTurnItem[] = [];
  private compactedSummary: string | null = null;
  private initialRequest: string | null = null;

  /**
   * Clears the current conversational session history.
   */
  clear(): void {
    this.turns = [];
    this.compactedSummary = null;
    this.initialRequest = null;
  }

  /**
   * Returns whether this session already has prior turns recorded.
   */
  get hasHistory(): boolean {
    return this.turns.length > 0;
  }

  /**
   * Records a completed turn into session history.
   */
  recordTurn(userRequest: string, finalMessage: string | undefined, actionsTaken: string[], commandId?: string): void {
    if (this.turns.length === 0) {
      this.initialRequest = userRequest;
    }
    this.turns.push({
      turnIndex: this.turns.length + 1,
      userRequest,
      finalMessage,
      actionsTaken,
      commandId,
    });
  }

  /**
   * Rewinds the session history back to the start of the turn that matches the given commandId.
   */
  rewindTo(commandId: string): void {
    const idx = this.turns.findIndex(t => t.commandId === commandId);
    if (idx !== -1) {
      this.turns = this.turns.slice(0, idx);
    }
    if (this.turns.length === 0) {
      this.initialRequest = null;
      this.compactedSummary = null;
    }
  }

  /**
   * Builds the full prompt instruction with multi-turn context.
   * If this is the first turn, returns the instruction as-is.
   * If subsequent turn, embeds <initial_user_request>, <previous_compacted_memory>,
   * <past_session_history>, and <follow_up_user_request>.
   */
  buildPromptContext(newRequest: string): string {
    if (this.turns.length === 0) {
      return newRequest;
    }

    const sections: string[] = [];

    if (this.initialRequest) {
      sections.push(`<initial_user_request>\n${this.initialRequest}\n</initial_user_request>`);
    }

    if (this.compactedSummary) {
      sections.push(`<previous_compacted_memory>\n${this.compactedSummary}\n</previous_compacted_memory>`);
    }

    // Keep the most recent turns (up to last 4 turns)
    const recentTurns = this.turns.slice(-4);
    const turnsText = recentTurns
      .map((t) => {
        const actionLines = t.actionsTaken.slice(0, 10).map((a) => `  - ${a}`).join('\n');
        return `[Turn ${t.turnIndex}]\nUser Request: "${t.userRequest}"\nActions Executed:\n${actionLines || '  (None)'}\nOutcome / Final Message: ${t.finalMessage ?? 'Completed'}`;
      })
      .join('\n\n');

    sections.push(`<past_session_history>\n${turnsText}\n</past_session_history>`);
    sections.push(`<follow_up_user_request>\n${newRequest}\n</follow_up_user_request>`);

    return sections.join('\n\n');
  }

  /**
   * Compacts older turns using the LLM if history grows large (> 5 turns or > 30k characters).
   */
  async maybeCompactHistory(model: any): Promise<void> {
    if (this.turns.length <= 5) return;

    const fullHistoryText = this.turns
      .map(
        (t) =>
          `[Turn ${t.turnIndex}] Request: "${t.userRequest}" -> Actions: ${t.actionsTaken.join(', ')} -> Outcome: ${t.finalMessage ?? 'Done'}`
      )
      .join('\n\n');

    if (fullHistoryText.length < 25_000 && this.turns.length <= 8) return;

    try {
      console.log('[History] Auto-compacting long agent memory in the background to save tokens...');

      const promptText = [
        this.compactedSummary ? `Previous Summary:\n${this.compactedSummary}` : '',
        `History to Compact:\n${fullHistoryText}`,
      ].join('\n\n');

      const res = await generateText({
        model,
        system:
          'You are summarizing an agent run for prompt compaction. Capture task requirements, key facts learned, decisions, partial progress, errors, and next steps. Preserve important entities, values, URLs, and scraped data. Return plain text only.',
        prompt: promptText,
      });

      if (res.text && res.text.trim()) {
        this.compactedSummary = res.text.trim().slice(0, 3000);
        // Prune turns array keeping only the first and last 2 turns
        if (this.turns.length > 3) {
          this.turns = [this.turns[0], ...this.turns.slice(-2)];
        }
        console.log('[History] Memory compacted successfully.');
      }
    } catch (err) {
      console.warn(`[History] Memory compaction failed: ${err instanceof Error ? err.message : String(err)}. Retaining full context for now.`);
    }
  }
}

export const sessionHistory = new AgentHistoryManager();
