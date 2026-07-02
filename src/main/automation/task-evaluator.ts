/**
 * Task Evaluator - Self-check if task succeeded
 * 
 * Evaluates whether the completed task actually satisfies the original request.
 * Provides confidence scores and identifies missing elements.
 * 
 * Example:
 * Task: "Find software engineer jobs with salary > $150k"
 * Result: { companies: [...], jobs: [...] }
 * Evaluation: {
 *   success: false,
 *   missingElements: ['salary information missing for 3 companies'],
 *   confidence: 0.65,
 *   suggestions: ['Extract salary data for remaining companies']
 * }
 */

import { getPreferredProvider, getApiKey } from '../storage.js';
import { generateObject } from 'ai';
import { resolveModel } from './model-resolver.js';
import { z } from 'zod';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EvaluationCriteria {
  hasMinimumData: boolean;
  dataQuality: 'low' | 'medium' | 'high';
  completeness: number; // 0.0 - 1.0
  accuracy: number; // 0.0 - 1.0
  relevance: number; // 0.0 - 1.0
}

export interface EvaluationResult {
  taskId: string;
  originalTask: string;
  success: boolean;
  confidence: number; // 0.0 - 1.0
  criteria: EvaluationCriteria;
  missingElements: string[];
  suggestions: string[];
  canContinue: boolean;
  nextStep?: string;
  timestamp: number;
}

export interface EvaluationOptions {
  strictMode?: boolean;
  minConfidence?: number;
  checkDataQuality?: boolean;
}

// ─── System Prompt for Evaluation ───────────────────────────────────────────

const EVALUATION_SYSTEM_PROMPT = `You are an expert task evaluator. Your job is to determine if a completed task actually satisfies the original request.

Evaluation criteria:
1. Completeness: Are all requested elements present?
2. Accuracy: Is the data correct and properly formatted?
3. Relevance: Does the data match what was requested?
4. Quality: Is the data useful and actionable?

Be strict but fair. If the task is incomplete, identify exactly what's missing.`;

// ─── Task Evaluator Class ───────────────────────────────────────────────────

export class TaskEvaluator {
  private options: Required<EvaluationOptions>;

  constructor(options?: EvaluationOptions) {
    this.options = {
      strictMode: options?.strictMode ?? true,
      minConfidence: options?.minConfidence ?? 0.7,
      checkDataQuality: options?.checkDataQuality ?? true,
    };
  }

  /**
   * Evaluate if task completion satisfies the original request using an LLM
   */
  async evaluate(
    originalTask: string,
    result: any,
    executionContext: {
      stepsExecuted: number;
      errors: string[];
      collectedData: Record<string, any>;
    },
  ): Promise<EvaluationResult> {
    const taskId = `eval_${Date.now()}`;

    const provider = getPreferredProvider();
    const apiKey = getApiKey(provider);

    const model = resolveModel(provider, apiKey);

    const EvaluatorSchema = z.object({
      success: z.boolean().describe("Whether the task successfully satisfied the original request."),
      confidence: z.number().min(0).max(1).describe("Confidence score of the evaluation (0.0 to 1.0)."),
      criteria: z.object({
        hasMinimumData: z.boolean(),
        dataQuality: z.enum(['low', 'medium', 'high']),
        completeness: z.number().min(0).max(1),
        accuracy: z.number().min(0).max(1),
        relevance: z.number().min(0).max(1),
      }),
      missingElements: z.array(z.string()).describe("Specific data elements or actions missing from the result."),
      suggestions: z.array(z.string()).describe("Actionable suggestions for how to fix or retry the missing elements."),
    });

    const safeStringify = (value: unknown): string => {
      try {
        return JSON.stringify(value, null, 2);
      } catch (err) {
        return `[Unserializable value: ${err instanceof Error ? err.message : String(err)}]`;
      }
    };
    const truncate = (value: string, maxLength = 12_000): string =>
      value.length > maxLength ? `${value.slice(0, maxLength)}\n...[truncated]` : value;
    const resultText = truncate(safeStringify(result));
    const collectedDataText = safeStringify(executionContext.collectedData);

    const promptText = `
Task Request: "${originalTask}"

Result Data: 
${resultText}

Execution Context:
Steps Executed: ${executionContext.stepsExecuted}
Errors Encountered: ${safeStringify(executionContext.errors)}
Collected Data Length: ${collectedDataText.length} bytes
Collected Data Content:
${truncate(collectedDataText)}

Evaluate the completeness and quality of this task output.
If elements are missing, list them in 'missingElements' and set success to false.
Provide suggestions on how to modify the approach to fix the gaps.
${this.options.checkDataQuality ? "Pay special attention to dataQuality: ensure the data is actionable and well-formatted." : ""}
    `;

    let object;
    try {
      const result = await Promise.race([
        generateObject({
          model,
          schema: EvaluatorSchema,
          system: EVALUATION_SYSTEM_PROMPT,
          prompt: promptText,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Evaluation timeout')), 30_000)
        ),
      ]);
      object = result.object;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      object = {
        success: false,
        confidence: 0,
        criteria: {
          hasMinimumData: false,
          dataQuality: 'low' as const,
          completeness: 0,
          accuracy: 0,
          relevance: 0,
        },
        missingElements: [`Evaluation failed or timed out: ${errMsg}`],
        suggestions: ['Retry the previous step or skip evaluation.'],
      };
    }

    // Enforce strict mode overrides if needed
    let finalSuccess = object.success;
    if (this.options.strictMode && object.confidence < this.options.minConfidence) {
      finalSuccess = false;
    }
    if (object.missingElements.length > 0) {
      finalSuccess = false;
    }

    const nextStep = !finalSuccess ? object.suggestions[0] : undefined;

    const evaluation: EvaluationResult = {
      taskId,
      originalTask,
      success: finalSuccess,
      confidence: object.confidence,
      criteria: object.criteria,
      missingElements: object.missingElements,
      suggestions: object.suggestions,
      canContinue: !finalSuccess,
      nextStep,
      timestamp: Date.now(),
    };

    return evaluation;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Generate evaluation ID
 */
export function generateEvaluationId(): string {
  return `eval_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
