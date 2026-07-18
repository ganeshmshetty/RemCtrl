# Browser-agent prompt design

This document describes the prompt contract used by the browser agent. The
runtime prompt is built in `src/main/automation/agent-system-prompt.ts`, tool
contracts live in `src/main/automation/agent-tools.ts`, and long-run memory
compaction is in `src/main/automation/agent-history.ts`.

## Prompt inventory

| Surface | Purpose | Contract |
| --- | --- | --- |
| `buildAgentSystemPrompt` | Free-form browser task | Role, trusted goal, security mode, tools, observe/act/verify loop, success, recovery, terminal output |
| `buildWorkflowStepSystemPrompt` | Bounded `do` and `collect` steps | Same safety contract, with step-specific scope and pagination stopping rules |
| `createBrowserTools` descriptions | Tool selection and argument generation | Each tool states when to use it, important boundaries, and what to verify afterward |
| workflow self-heal task | Recover a stale saved selector | Failure context, original intent, exact action/value, verification, and terminal failure contract |
| history compaction system/prompt | Preserve state across long runs | Labeled facts/progress/errors/next sections; input is explicitly data, never instructions |
| `buildPromptContext` | Add earlier turns to a new request | Historical data is delimited and escaped; the current request is separate |

## Significant changes and rationale

### 1. Structured, delimited sections

Prompts now use `<role>`, `<task_goal>`, `<security>`, `<available_tools>`,
`<workflow>`, `<success_criteria>`, `<rules>`, `<failure_handling>`, and
`<output_format>`. Task text is JSON-serialized and XML-escaped before it is
inserted into the goal boundary. This makes the trusted instruction/data
boundary visible and prevents a task string containing a closing tag from
changing the prompt structure.

This follows Anthropic's guidance to establish success criteria before prompt
iteration and to use XML structuring, role prompting, and prompt chaining as
explicit techniques ([Prompt engineering overview](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/overview)).
It also applies the reusable-pattern approach described by the [Prompt Pattern
Catalog](https://arxiv.org/abs/2302.11382).

### 2. Deterministic observe → act → verify loop

The workflow says what to inspect, how to choose one next action, and how to
prove the state changed. Numeric element indices are declared short-lived, so
navigation, scrolling, modal changes, and failed actions require a fresh
observation. Completion requires an observable success signal instead of an
attempted click.

This reflects OpenAI's recommendation to make actions and edge cases explicit
and to break work into clear steps ([A practical guide to building agents](https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/)).
It also mirrors Browser Use's production guidance: name actions directly,
be specific about the task, and include recovery alternatives ([Browser Use
AGENTS.md](https://github.com/browser-use/browser-use/blob/main/AGENTS.md)).

### 3. Bounded retries and failure classification

The agent retries a transient wait/timeout once, re-observes stale targets, and
stops after three failures of the same target/action. CAPTCHA, 2FA, ambiguity,
destructive confirmation, and policy blocks become explicit human checkpoints
instead of infinite loops. A failed run has a single `done(false, message)`
terminal result with the observed blocker and useful partial result.

The prompt is intentionally not the only enforcement layer. Host policy,
abort signals, tool validation, and human checkpoints remain runtime controls.
OpenAI recommends layered guardrails and human intervention for edge cases, and
LangChain documents retries, call limits, context management, and deterministic
guardrails as middleware concerns ([LangChain agents](https://docs.langchain.com/oss/python/langchain/agents)).

### 4. Tool descriptions are operational contracts

Descriptions now explain “use when”, “avoid when”, freshness/side effects, and
failure recovery. `act` prefers the latest observation index; `extract` is
read-only; `wait` is bounded; `askUser` pauses; `notifyUser` does not finish;
`done` is terminal; and `runActionSequence` stops on the first failure and is
limited to stable DOM sequences.

Anthropic's agent guidance notes that tools deserve as much prompt engineering
as the overall prompt: descriptions should be obvious, include examples, and
state boundaries ([Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)).
Browser Use similarly requires descriptive action names and structured action
results ([AGENTS.md](https://raw.githubusercontent.com/browser-use/browser-use/refs/heads/main/AGENTS.md)).

### 5. Long-run memory is state, not instructions

History context is wrapped in `<historical_context>` and escaped so old page
text cannot masquerade as a fresh instruction. Compaction produces labeled
`TASK`, `FACTS`, `DECISIONS`, `PROGRESS`, `ERRORS`, and `NEXT` sections and is
explicitly forbidden from inventing facts or preserving secrets. This keeps the
next run useful without copying an ever-growing transcript.

### 6. Planning without unnecessary verbosity

The agent has a `think` checkpoint for a short next-action plan, but the prompt
does not ask it to emit long private reasoning. This keeps planning useful while
leaving the actual evidence in tool results and verification steps. PromptAgent
describes iterative refinement through error feedback; the equivalent runtime
loop here is observe, act, verify, classify, and recover ([PromptAgent](https://arxiv.org/abs/2310.16427)).

## Additional reliability recommendations

1. Add an evaluation suite with deterministic fixtures for navigation, stale
   indices, modals, pagination, policy blocks, CAPTCHA/2FA checkpoints, prompt
   injection, and partial failures. Assert both tool traces and terminal output.
2. Keep retry counters and a run/step budget in runtime state. Prompts describe
   the policy, but code should enforce maximum tool calls and wall-clock time.
3. Version prompts and tool schemas together. Store the prompt version, model,
   security mode, tool inputs, tool results, and final verification signal in the
   agent trace so regressions can be compared.
4. Return structured tool envelopes (`success`, `blocked`, `retryable`,
   `observedState`, and `errorCode`) so recovery decisions do not depend on
   parsing prose.
5. Keep destructive-action approval and domain/scope checks outside the model.
   A prompt can explain policy, but it must not be the policy enforcement point.
6. Run prompt snapshots against every supported provider/model family. Small
   wording changes should be reviewed with the same success criteria rather
   than judged by one successful demo.
