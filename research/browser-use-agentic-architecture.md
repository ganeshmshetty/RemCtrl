# Browser-Use Agentic Architecture
## Original technical research
### Scope and provenance
This document analyzes the open-source browser-use architecture as an external system.
It is intentionally written as a design and adaptation study, not as a codebase review.
The current-project workspace was not inspected.
The upstream repository was examined from a temporary clone outside the workspace.
The repository snapshot analyzed here is commit 950eb03617e67548d759c02beac1ad122c6b6458.
The snapshot identifies itself as release 0.13.6.
Source repository snapshot: https://github.com/browser-use/browser-use/tree/950eb03617e67548d759c02beac1ad122c6b6458
The official documentation was consulted through its published documentation pages.
Documentation index: https://docs.browser-use.com/llms.txt
The conclusions below distinguish observed implementation facts from architectural inferences.
Observed facts refer to the pinned source tree or an official documentation page.
Inferences describe what the observed mechanisms imply for system design.
Version-sensitive defaults are called out because documentation and source can evolve independently.
### Research thesis
Browser-use is best understood as a closed-loop control system over a partially observed browser environment.
The language model is a policy synthesizer, not the browser runtime.
The browser session owns the authoritative world state.
The DOM and accessibility pipeline produces a lossy, token-oriented observation.
The action registry defines the executable boundary between model output and browser effects.
The agent loop joins observation, reasoning, validation, effect, and history.
Planning adds a working task model without replacing the loop.
Recovery is distributed across session reconnects, action-level timeouts, model fallback, loop nudges, and forced completion.
Security is distributed across domain policy, credential substitution, file containment, and human intervention surfaces.
This decomposition is more useful than describing browser-use as a single autonomous chatbot.
### Architectural map
The control path begins with a task and an LLM configuration.
The agent creates or receives a browser session.
The session starts a browser profile, target, page, and event infrastructure.
The DOM service snapshots the focused target and related frames.
The serializer converts that snapshot into a compact representation and selector map.
The message manager combines system instructions, task context, state, plan, and selected history.
The model returns a typed AgentOutput containing reasoning fields and an action sequence.
The action registry validates the sequence against currently available tools and domain filters.
The tool layer resolves selector indices, coordinates, secrets, files, and special runtime parameters.
The browser session executes the resulting Playwright or CDP operation.
The action result is fed back into history and the next observation.
Watchdogs and event handlers observe side effects such as downloads, popups, CAPTCHA states, and security violations.
Telemetry observes the run at agent, model, tool, browser, and cost boundaries.
Cloud APIs can place session creation, browser hosting, profiles, workspaces, and webhooks outside the local process.
The stable dependency direction is task policy toward browser effects, never browser effects toward arbitrary model text.
### Control-plane versus data-plane
The control plane includes task state, agent settings, plans, action schemas, retry counters, and event lifecycle.
The data plane includes pages, frames, cookies, downloads, screenshots, DOM text, and browser protocol messages.
The separation is architectural even when both planes share a Python process.
Control-plane records should be durable enough to explain a decision.
Data-plane objects should be treated as mutable and potentially hostile.
The model sees a projection of the data plane rather than direct browser objects.
Tools are the capability gateway from control plane to data plane.
The session is the owner of data-plane handles.
The message manager is the owner of model-facing state assembly.
The event bus is the coordination seam between imperative calls and asynchronous browser events.
### State machine vocabulary
The high-level run states are initialized, starting, observing, reasoning, acting, recovering, completed, failed, stopped, and closed.
The implementation does not need one enum for all of these states to behave as a state machine.
Its methods and guards encode the transitions.
An initialized agent has task configuration but may not have a live browser.
Starting binds the agent to a browser session and launches session infrastructure.
Observing obtains browser state, screenshot data, download status, and current actions.
Reasoning prepares messages and requests typed model output.
Acting validates and executes one or more actions.
Recovering handles browser, tool, model, or policy failures.
Completed is represented by a done action or an equivalent terminal result.
Failed can mean execution failure, budget exhaustion, or incomplete completion after forced termination.
Stopped is an explicit interruption or user-requested halt.
Closed releases session and telemetry resources.
The same run can pass through recovering several times before completion.
### Transition invariants
No model action should execute without a current browser observation.
No multi-action sequence should continue after a terminal action.
No action should use a selector map from an unrelated page state without a revalidation path.
No credential value should be interpolated into the general task prompt when a placeholder can be used.
No successful final result should be inferred solely from the absence of an exception.
No browser reconnect should silently change the semantic identity of the focused target.
No retry should be unbounded at the layer where it is introduced.
No telemetry record should become a new authority for task success.
These invariants are useful adaptation tests even if the implementation is replaced.
### Agent loop: preparation phase
The preparation phase gathers external facts before asking the model for a decision.
It waits when a CAPTCHA watchdog says that interaction is not yet appropriate.
It obtains browser state with the current page and optional screenshot.
It checks downloads and other asynchronous artifacts.
It updates page-specific action availability.
It resolves skill or capability descriptions needed for the current task.
It updates or renders the current plan.
It asks the message manager to prepare state messages.
It compacts older messages when configured thresholds are reached.
It injects budget warnings near the step limit.
It injects replan nudges after repeated failures.
It injects exploration nudges when execution has not advanced the plan.
It injects loop-detection nudges when action or page fingerprints stagnate.
It can restrict the final step to done.
It can restrict actions after too many failures to a completion attempt.
The preparation phase is therefore a policy-shaping boundary, not merely a serialization helper.
Source: https://github.com/browser-use/browser-use/blob/950eb03617e67548d759c02beac1ad122c6b6458/browser_use/agent/service.py
### Agent loop: reasoning phase
The reasoning phase creates a fresh model request from the assembled state.
The model-facing output is validated against a Pydantic AgentOutput schema.
The schema requires evaluation, memory, next goal, and an action list.
Optional thinking and plan fields give the model a scratchpad-like coordination surface.
The output contract rejects unexpected fields in the current source model.
An output with too many actions is truncated to the configured per-step limit.
Empty or malformed outputs trigger a bounded recovery path.
The current output is retained for callbacks, history, diagnostics, and possible judging.
The model request receives a session identifier when the provider supports it.
The reasoning phase does not itself click, type, navigate, or upload.
Its responsibility is to propose a typed transition in the action state machine.
Source: https://github.com/browser-use/browser-use/blob/950eb03617e67548d759c02beac1ad122c6b6458/browser_use/agent/views.py
### Agent loop: execution phase
Execution turns each model action into a registered tool invocation.
The action registry resolves the action name to a parameter model and implementation.
The action call receives runtime-only dependencies through special parameters.
Those dependencies can include the browser session, page URL, CDP client, file system, or extraction model.
The registry can filter actions by the current URL domain.
The tool layer applies an action timeout around the handler.
The action result records done status, success, errors, extracted content, attachments, and memory hints.
The loop may execute a short action sequence in one step.
A terminal action is expected to be the only action in its sequence.
Runtime guards can stop a sequence if the page or focus target changes.
Execution returns structured results rather than forcing the next model call to infer exceptions from prose.
Source: https://github.com/browser-use/browser-use/blob/950eb03617e67548d759c02beac1ad122c6b6458/browser_use/tools/service.py
### Agent loop: post-processing phase
Post-processing checks downloads and other action side effects.
It updates the plan from the model output.
It records action hashes for loop detection.
It records page fingerprints for stagnation detection.
It updates consecutive-failure counters.
It preserves the distinction between a single-action error and a multi-action interruption.
It appends results to agent history.
It may attach a judge result after the final done action.
The judge can assess the trace against ground truth.
The judge does not override the agent's self-reported success in the observed implementation.
This makes judging an evaluation signal rather than an execution authority.
Source: https://github.com/browser-use/browser-use/blob/950eb03617e67548d759c02beac1ad122c6b6458/browser_use/agent/service.py
### Agent loop: finalization phase
Finalization is attempted regardless of whether the step succeeded.
Run finalization emits usage and telemetry information.
The run can produce history, screenshots, GIFs, structured output, and a final result.
The event bus is stopped with a bounded timeout.
The browser session can be closed depending on lifecycle settings.
The final state distinguishes done, successful, errored, interrupted, and incomplete histories.
This phase is operationally important because agent execution often fails during cleanup.
Cleanup failure should be reported without obscuring the primary task outcome.
Source: https://docs.browser-use.com/open-source/customize/agent/output-format
### Loop pseudocode
The essential loop can be represented as:
1. Start or attach to a browser session.
2. While budget and stop conditions permit, observe browser state.
3. Assemble model context from state, plan, history, and policy.
4. Request typed actions from the model.
5. Validate actions and execute a bounded sequence.
6. Record effects, update plan, and fingerprint state.
7. If done, finalize; otherwise recover or continue.
8. On interruption or exhaustion, preserve a truthful partial trace.
This pseudocode omits implementation names but preserves the control semantics.
The key design choice is that observation precedes every model decision.
The second key choice is that effect execution is typed and bounded.
The third key choice is that state progression is measured independently from model confidence.
### Budget semantics
The step budget is a liveness guard, not a correctness proof.
The source run loop currently exposes a max_steps default of 500.
The official all-parameters documentation describes a max_steps default of 100.
This is a version and surface discrepancy that adapters must resolve explicitly.
Budget warnings are injected before the hard limit.
At the final step, the action surface is narrowed to done.
After the failure threshold, the action surface is likewise narrowed.
The final response can preserve a partial result after forced completion.
An adapter should expose both step budget and wall-clock budget.
It should also distinguish model calls, browser calls, and waiting time.
Source: https://docs.browser-use.com/open-source/customize/agent/all-parameters
### Browser session abstraction
BrowserSession is the high-level runtime object for a live browser.
It combines event-driven lifecycle handling with direct CDP and Playwright operations.
This dual interface supports agents, tools, watchdogs, and lower-level integrations.
The session owns the event bus used by browser lifecycle and side-effect watchers.
It tracks the agent focus target and current page state.
It manages CDP connections, target sessions, selector maps, downloads, popup messages, and reconnect state.
It keeps watchdogs near the resource they observe.
It can connect to a local browser, a remote browser, or a cloud-managed browser surface.
The abstraction avoids exposing raw browser protocol details to the agent policy.
Source: https://github.com/browser-use/browser-use/blob/950eb03617e67548d759c02beac1ad122c6b6458/browser_use/browser/session.py
### Session lifecycle
Starting a session dispatches a browser-start event and awaits the session startup path.
Startup establishes the protocol connection and initializes target and watchdog state.
New pages can be opened through the session rather than directly through an arbitrary page handle.
The current page is resolved through target and focus management.
Stopping saves storage state when configured and performs a non-force shutdown.
Killing forcefully stops the browser and resets runtime state.
Resetting clears target managers, cached state, focus, watchdogs, and reconnect markers.
The lifecycle is intentionally reusable for warm-resume scenarios.
The session can be running before an agent step begins.
An adapter should make lifecycle ownership explicit so that two agents cannot close a shared session accidentally.
Source: https://github.com/browser-use/browser-use/blob/950eb03617e67548d759c02beac1ad122c6b6458/browser_use/browser/session_manager.py
### Target and focus management
Modern pages are not a single document.
Browser targets include tabs, popups, workers, and browser-level protocol targets.
The session manager owns target sessions and resolves the current focus.
The agent focus target is a semantic pointer used by state extraction and action execution.
Focus can change after a click opens a popup or after a new tab becomes active.
The current page must be obtained at action time rather than cached indefinitely.
Multi-action guards compare target or URL identity before continuing a sequence.
This guards against applying a stale next action to a newly opened page.
The implication is that focus is part of action precondition state.
Source: https://github.com/browser-use/browser-use/blob/950eb03617e67548d759c02beac1ad122c6b6458/browser_use/browser/session_manager.py
### Browser profile as launch policy
BrowserProfile is a configuration template for launch, connection, context, and policy.
It carries local or cloud connection settings.
It can specify a persistent profile directory, proxy, window geometry, and extensions.
It can configure page-load waits, inter-action delay, screenshots, downloads, video recording, and CAPTCHA solving.
It carries allowed and prohibited domain rules.
It can block IP-address navigation.
It controls cross-origin iframe traversal and iframe limits.
It controls whether the browser is kept alive after an agent run.
This makes the profile more than a convenience object.
It is a deploy-time policy bundle and should be versioned separately from task prompts.
Source: https://github.com/browser-use/browser-use/blob/950eb03617e67548d759c02beac1ad122c6b6458/browser_use/browser/profile.py
### Domain policy semantics
The profile supports allowlists and denylists using glob-like matching.
The documented policy gives the allowlist precedence when both lists are present.
Wildcard TLD patterns are intentionally constrained.
Large exact allowlists can be optimized into a set-based lookup.
Malformed and ambiguous URL forms require canonicalization before policy decisions.
Policy should be checked at navigation, action dispatch, and redirect boundaries.
An initial page being allowed does not prove that every later target is allowed.
The action registry can additionally remove domain-restricted tools from the model's available set.
This is defense in depth, not a substitute for browser or network isolation.
Source: https://docs.browser-use.com/open-source/customize/browser/all-parameters
### Session versus browser resource
The cloud documentation separates an agent session from a browser session.
An agent session represents a task execution and its result lifecycle.
A browser session represents a running browser endpoint with a CDP and live-view surface.
One agent session can be associated with a browser resource.
Follow-up tasks can reuse browser state while creating a new agent context.
That arrangement carries cookies, tabs, and page state across the handoff.
It does not imply that the new agent inherits the prior agent's message context.
This distinction is crucial for privacy, audit, and authorization boundaries.
Source: https://docs.browser-use.com/cloud/api-v3/sessions/create-session
### Local and hosted boundaries
In local mode, the agent, browser session, DOM service, tool registry, and model client can run in one process.
In hosted mode, browser execution can move behind a cloud API and remote CDP endpoint.
The task client then becomes a control-plane client.
The cloud service owns scheduling, browser placement, recording, and session state.
Webhooks can carry status transitions back to an application.
Profiles and workspaces add durable state beyond one browser process.
MCP exposes selected session operations to external tool consumers.
Each boundary changes the threat model because commands, results, and credentials cross a transport.
Source: https://docs.browser-use.com/cloud/guides/webhooks
### Architectural inference
The smallest reliable unit is not an Agent object.
It is a run coordinator around an isolated session, policy bundle, tool capability set, and trace sink.
The Agent object is a convenient orchestration surface for that unit.
This inferred unit gives adapters a stable seam for tenancy, quotas, and teardown.
It also allows a browser session to be reused without reusing an untrusted reasoning history.
### Research checkpoints
Checkpoint A: observation is assembled from browser state, not from the model's previous prose.
Checkpoint B: action effects pass through registered schemas and runtime dependencies.
Checkpoint C: recovery is multi-layered and has separate counters.
Checkpoint D: browser state and agent context can have different lifetimes.
Checkpoint E: policy enforcement must occur below the prompt layer.
Checkpoint F: traces need to preserve both intended actions and observed effects.
Checkpoint F: traces need to preserve both intended actions and observed effects.
## DOM extraction and accessibility architecture
### Why browser state needs a projection
Raw HTML is too large, unstable, and semantically incomplete for a model context.
Screenshot pixels expose visual structure but hide many programmatic affordances.
Accessibility trees expose roles and names but can omit geometry, listeners, and frame ownership.
Browser-use therefore builds a composite representation.
The composite joins DOM nodes, accessibility nodes, layout snapshots, viewport facts, and event-listener hints.
The result is still a projection, not a canonical browser ontology.
That distinction matters when an element is visually present but not interactable.
It also matters when a control is interactable through a shadow root but not through ordinary selectors.
### Snapshot acquisition
The DOM service captures a DOM snapshot with computed styles, paint order, and DOM rectangles.
It obtains a complete document tree with piercing enabled for relevant browser boundaries.
It requests accessibility trees for frame contexts and merges their information.
It obtains viewport and device-pixel-ratio data.
It can inspect JavaScript event listeners to identify likely interactive nodes.
Event-listener inspection is skipped or limited for very large pages.
The acquisition path uses parallel protocol calls where possible.
Required calls have bounded timeouts.
Pending acquisition work can be retried after a short delay.
Failure of required calls is surfaced rather than silently producing a false complete tree.
This is a broad fan-in operation and is a natural latency hotspot.
Source: https://github.com/browser-use/browser-use/blob/950eb03617e67548d759c02beac1ad122c6b6458/browser_use/dom/service.py
### Frame and shadow boundaries
Cross-origin iframes are first-class observations when the browser protocol permits access.
The profile limits iframe count and depth to bound work and avoid pathological documents.
Frame offsets and scroll positions are corrected when geometry is merged into the parent view.
Shadow roots are retained as child structures rather than flattened into arbitrary text.
Selector generation stops at iframe and shadow boundaries where a parent-document path is not valid.
An interaction must therefore carry enough frame or target context to locate its node later.
The system's frame-aware model prevents a main-document selector from being misapplied inside a child frame.
An adapter that discards frame identity will create intermittent stale-element failures.
Source: https://github.com/browser-use/browser-use/blob/950eb03617e67548d759c02beac1ad122c6b6458/browser_use/dom/views.py
### Enhanced node model
An enhanced node holds a browser node identifier and a backend DOM identifier.
It includes node type, name, value, attributes, parent, children, and meaningful text.
It can carry an accessibility node and a layout snapshot node.
It can carry absolute position and visibility state.
It carries target, frame, and session identity.
It can mark scrollability and JavaScript listener presence.
It can include content documents and shadow roots.
It can preserve metadata for hidden iframe cases.
Each node can receive a UUID useful for local identity in a serialized tree.
Meaningful text is selected from values, accessible names, labels, titles, placeholders, alt text, and descendants.
The selection order is a heuristic for grounding, not a guarantee of visual reading order.
Source: https://github.com/browser-use/browser-use/blob/950eb03617e67548d759c02beac1ad122c6b6458/browser_use/dom/views.py
### Visibility is computed, not assumed
The DOM tree uses CSS and layout evidence to determine whether a node is visible.
Bounds are compared with the viewport and page geometry.
Paint order can help distinguish an exposed control from an occluded descendant.
A node can exist in the DOM while being excluded from the model representation.
Disabled controls and irrelevant SVG descendants are filtered by the serializer.
Containment rules reduce duplicate or misleading bounding boxes.
Visibility is a policy for context selection, not a universal truth about the browser.
Some keyboard-focusable controls may look invisible and still be important.
Some offscreen elements become valid after scrolling.
### Accessibility as a semantic index
Accessibility data contributes roles, names, states, and relationships.
It improves grounding when class names and generated IDs are unstable.
Accessible names can identify buttons whose DOM text is empty.
ARIA metadata can reveal a control's intended function without trusting visual styling.
Accessibility trees can be incomplete, stale, or altered by application bugs.
They should be combined with DOM and geometry rather than treated as the sole source.
The serializer can preserve an accessible name as a matching signal.
The interaction record can retain the accessibility name used during grounding.
This supports postmortem analysis when a role-based match later becomes ambiguous.
### Serialization is an information budget
The serializer creates an LLM representation designed for token economy.
It creates a separate evaluation representation that preserves more structural detail.
The LLM view and evaluation view should not be conflated.
The LLM view can omit non-interactive descendants that add little decision value.
The serializer keeps useful text close to interactive nodes.
It indexes visible interactive nodes for action grounding.
It includes compound controls such as file inputs, selects, details, audio, and video.
It can show option previews without dumping every implementation detail.
It excludes nodes marked with a session-specific browser-use exclusion attribute.
It also recognizes a legacy exclusion marker for compatibility.
This is a controlled lossy compression stage.
Source: https://github.com/browser-use/browser-use/blob/950eb03617e67548d759c02beac1ad122c6b6458/browser_use/dom/serializer/serializer.py
### Selector-map semantics
The selector map links a model-facing index to interaction metadata.
The metadata includes browser identifiers, backend identifiers, attributes, bounds, XPath-like paths, and accessible names.
The current source uses backend node identifiers as an internal map key even when the user-facing concept is an index.
The index is therefore a session-local grounding handle, not a globally stable selector.
A new DOM state can invalidate an old index.
The agent history can retain the old action, but the tool must resolve it against current state.
The serializer can compare a prior serialized state and mark changed or newly introduced nodes.
Any adapter should attach an observation version or fingerprint to each action.
This turns a silent stale-index bug into an explicit precondition failure.
### Matching levels
Interaction records support several fallback matching signals.
Exact structural identity is the strongest match when browser identifiers still resolve.
Stable identity can survive some DOM changes.
An XPath-like path can help when hierarchy is stable.
Accessible-name matching can recover a semantic target.
Attribute matching can serve as a weaker last resort.
These levels should be ordered from least ambiguous to most ambiguous.
Fallback matching should emit an audit event naming the level that succeeded.
Automatic fallback must stop when multiple candidates have comparable confidence.
An uncertain click is a safety event, not merely a selector inconvenience.
### Cached state and invalidation
Browser state is cached to avoid unnecessary serialization work.
The cache is invalidated by navigation, page changes, target changes, and relevant action effects.
The action loop's page fingerprint uses URL, element count, and a hash of DOM text.
That fingerprint is useful for stagnation detection but too weak to prove semantic identity.
Two pages can share the same text and differ in hidden actions.
Two versions of a page can change controls while preserving most text.
An adapter should include target ID, frame context, and a selector-map generation in stronger fingerprints.
### Page-specific action availability
The action registry can filter actions by domain.
That filtering changes the model's available tool vocabulary before reasoning.
The same capability can also be rejected at dispatch time.
Page-specific availability reduces accidental use of a tool on an untrusted origin.
It can make the model's planning easier because impossible actions disappear.
It can also produce confusing behavior if the model is not told why a tool vanished.
The message layer should describe missing capabilities without leaking secret policy internals.
### Screenshots and DOM are complementary
Screenshots help the model reason about visual layout, overlays, and spatial controls.
DOM state provides labels, roles, values, selectors, and hidden structure.
Vision should not replace DOM grounding for sensitive or high-impact actions.
DOM should not replace screenshots for canvas apps, image pickers, and visual verification.
The profile can disable vision on sensitive pages.
The action model can accept coordinates for model providers that support coordinate grounding.
Coordinate actions require scaling when the screenshot size differs from the browser viewport.
Source: https://docs.browser-use.com/open-source/customize/agent/all-parameters
### DOM extraction as a contract
The DOM service should be treated as an observation API with explicit freshness.
Its output contract should include capture time, target, URL, frame graph, and serializer version.
It should distinguish unavailable data from empty data.
It should retain timing breakdowns for protocol calls and serialization.
It should expose truncation or filtering decisions to the trace.
It should make the maximum frame and node budgets visible to operators.
It should allow deterministic replay using saved raw or normalized snapshots.
### Extraction versus interaction
Interaction grounding asks which element can safely receive an action.
Content extraction asks which page content is relevant to the task.
The built-in extract action uses clean markdown and can use a separate extraction LLM.
Extraction may chunk long content and continue from a character position.
Structured extraction can validate output against a provided schema.
Links and images can be included as explicit extracted fields.
Extraction output should not be treated as proof that a side effect occurred.
Content can be stale, adversarial, or instruction-bearing.
Source: https://docs.browser-use.com/open-source/customize/tools/available
### Adversarial DOM
Page text is untrusted input even when it appears in a system-generated state message.
A webpage can present instructions that conflict with the task or tool policy.
Accessibility labels can be misleading or deliberately crafted.
Hidden nodes can contain prompt injection payloads that become visible after an action.
A serialized DOM should mark content as page-originated data.
The system prompt should establish that page text cannot authorize new capabilities.
High-impact actions should require an independent policy check.
### Observation failure modes
The protocol can time out while the page continues loading.
A cross-origin frame can be visible but inaccessible.
A shadow-root component can expose a role without a stable path.
A virtualized list can replace nodes after serialization.
A single-page application can change state without changing the URL.
An overlay can intercept a click after the snapshot.
A page can mutate between selector resolution and event dispatch.
These are normal distributed-systems races inside one browser process.
The correct response is bounded re-observation and policy-aware retry.
### Architectural inference
The DOM serializer is a model-facing compiler.
Its input language is a live, messy browser document.
Its output language is a small grounding grammar with semantic and spatial hints.
Treating it as a compiler suggests compiler-like tests for determinism, loss budgets, and invalidation.
It also suggests versioning the output grammar independently of the action API.
### DOM research checkpoints
Checkpoint G: a selector index is an ephemeral capability handle.
Checkpoint H: accessibility improves semantic grounding but is not a security authority.
Checkpoint I: screenshots and structured DOM observations cover different blind spots.
Checkpoint J: frame and shadow identity must survive serialization.
Checkpoint K: observation freshness belongs in action preconditions.
Checkpoint L: extracted page text remains untrusted data.
Checkpoint L: extracted page text remains untrusted data.
## Action model and capability registry
### Typed actions as the effect boundary
The action registry defines the set of effects that a model can request.
Each registered action has a name, description, function, parameter model, termination flag, and optional domain restriction.
The model sees descriptions and schemas rather than arbitrary Python callables.
The registry builds a union of action models for the current availability set.
Pydantic validation rejects malformed parameters before browser effects occur.
The registry can normalize action function signatures into generated parameter models.
This is a capability system encoded as data.
It is safer and easier to inspect than interpreting model-generated source code.
Source: https://github.com/browser-use/browser-use/blob/950eb03617e67548d759c02beac1ad122c6b6458/browser_use/tools/registry/service.py
### Action model shape
The agent output contains an ordered action list.
Each action is represented by a model whose discriminator is the registered action name.
The model can include a single no-op or wait action when the page needs time.
The model can request navigation, history movement, clicks, input, upload, extraction, scrolling, screenshots, evaluation, and completion.
The model output also contains evaluation of the previous goal.
It contains short memory and a next-goal statement.
It can carry a current plan item and plan update.
These fields separate decision explanation from executable effects.
The runtime should persist the action list exactly as validated.
### Runtime-only parameters
Some action parameters are not model-controlled.
Special action parameters can inject the browser session.
They can inject the current page URL and a CDP client.
They can inject a page-extraction model.
They can inject a file system and available file paths.
They can indicate whether sensitive data is available.
They can provide an extraction schema.
Keeping these values outside the model schema prevents the model from forging infrastructure handles.
It also makes dependency injection visible to tests.
Source: https://github.com/browser-use/browser-use/blob/950eb03617e67548d759c02beac1ad122c6b6458/browser_use/tools/registry/views.py
### Action semantics
An action should define preconditions, effect summary, and observation invalidation.
Browser-use encodes some of this through descriptions, return results, and termination flags.
Adapters should make it more explicit for high-impact systems.
For example, click requires a current target and a grounded selector or coordinate.
Input requires a focused or addressable control and can invoke secret substitution.
Upload requires a path in the allowed file set.
Navigate requires a URL allowed by policy.
Extract requires content availability and can consume an extraction budget.
Done requires a success claim and optionally structured output.
### Terminating actions
Registered actions can declare that they terminate a multi-action sequence.
Done is a special terminal case and is expected to be used alone.
The runtime stops a sequence after a terminal action.
This prevents a completion action from being followed by an unintended click.
An action that opens a new page can be semantically terminal even when it is not marked that way.
The multi-action runtime therefore also checks page URL and focus-target changes.
Static termination metadata and runtime change detection form a two-layer guard.
Source: https://github.com/browser-use/browser-use/blob/950eb03617e67548d759c02beac1ad122c6b6458/browser_use/agent/service.py
### Multi-action economics
Multiple compatible actions per step reduce model round trips.
Short sequences can type, submit, and wait without a full reasoning call between every event.
The benefit is largest for deterministic operations on a stable page.
The risk is that the first action changes the preconditions of later actions.
Browser-use caps the number of actions per step.
The current source default is five.
The all-parameters documentation describes four as a default on its documented surface.
Adapters must choose one versioned setting and expose it in telemetry.
Sequence length should be lower for destructive or navigation-changing tools.
Source: https://docs.browser-use.com/open-source/customize/agent/all-parameters
### Action timeout boundaries
The tool layer wraps each action in a timeout.
The current source default is taken from BROWSER_USE_ACTION_TIMEOUT_S or a 180-second fallback.
Invalid timeout values fall back to a safe default in the tested path.
The timeout should be longer than inner extraction waits but bounded against hung handlers.
An action timeout becomes a structured error result.
The agent loop can then decide whether to retry, re-observe, replan, or finish partially.
Timeouts need a cause label because a page wait, network stall, and browser disconnect have different recovery paths.
Source: https://github.com/browser-use/browser-use/blob/950eb03617e67548d759c02beac1ad122c6b6458/browser_use/tools/service.py
### Sensitive-data substitution
The action registry supports secret placeholders in model-generated input.
The placeholder can identify a key inside a sensitive-data map.
The current page domain is checked before a secret is substituted.
TOTP-style keys can be handled with a recognized suffix convention.
Unknown placeholders can remain literal rather than becoming an empty secret.
The secret map is passed to the input action only when needed.
History serialization redacts sensitive values from model outputs.
This keeps the secret value out of the general prompt and most traces.
The substitution layer is a credential broker, not a prompt feature.
Source: https://github.com/browser-use/browser-use/blob/950eb03617e67548d759c02beac1ad122c6b6458/browser_use/agent/message_manager/service.py
### File capabilities
Upload action inputs are checked against available file paths.
The local file system abstraction can protect against path traversal.
Downloaded files may become available through an explicit allowed path set.
An action should never accept an arbitrary model-provided absolute path.
Path normalization must occur before containment checks.
Symlink behavior should be defined for a production adapter.
The trace should record a file capability identifier and metadata, not the file contents by default.
Source: https://docs.browser-use.com/open-source/customize/tools/add
### Custom tools
The documented extension path uses a tools object and an action decorator.
Custom actions can receive the browser session through a special parameter.
The action can return an ActionResult to preserve structured completion and extracted content.
Domain restriction can be specified for a custom action.
A custom action expands the agent's effect surface and must undergo the same review as a built-in action.
The decorator's convenience should not bypass policy, timeout, audit, and idempotency requirements.
Custom actions should state whether they are read-only, reversible, transactional, or terminal.
Source: https://docs.browser-use.com/open-source/customize/tools/add
### Evaluate as a privileged capability
Browser evaluation can execute arbitrary page-context JavaScript.
This is substantially more powerful than a click or extraction action.
It can read tokens from the page, mutate application state, invoke hidden APIs, or bypass visible UI controls.
It should be disabled by default for untrusted tasks.
If enabled, it needs its own policy, audit, timeout, origin check, and review status.
The model should not receive unrestricted evaluation as a generic escape hatch.
### Action idempotency
Clicks, inputs, uploads, and submissions are not generally idempotent.
A retry after a timeout can duplicate a purchase or send a second message.
The action result needs an effect uncertainty flag when the browser may have accepted the event before the timeout.
Recovery should re-observe and verify state before repeating a non-idempotent action.
Idempotency keys can be added at the application layer where the target supports them.
A generic browser runtime cannot manufacture idempotency for an arbitrary web form.
### Planning representation
Planning is represented as a small list of PlanItem values.
Each item has text and a status such as pending, current, done, or skipped.
The current plan item is advanced as execution progresses.
The model can propose a plan update.
The agent renders plan markers into the context so progress is visible.
The plan is a working hypothesis, not an externally committed workflow.
A plan should remain short enough to fit beside live browser state.
It should be revised after evidence contradicts the assumed route.
Source: https://github.com/browser-use/browser-use/blob/950eb03617e67548d759c02beac1ad122c6b6458/browser_use/agent/views.py
### Planning lifecycle
At initialization, the plan can be empty.
The first useful model output can populate it.
When a plan update arrives, the list is replaced and the current index resets.
When the current item changes, the old item becomes done or skipped according to progress.
The render path annotates completed, active, pending, and skipped items.
After repeated failures, the agent injects a replan instruction.
After too many steps without a current plan item, it injects exploration guidance.
Flash mode and explicit planning configuration can disable or reduce this behavior.
The plan is therefore both a model output and a control signal.
### Plan versus workflow engine
A PlanItem list does not enforce business invariants.
It does not reserve resources.
It does not provide compensation for partially completed effects.
It does not prove that a step's text was accomplished.
It does provide a compact shared language between the model and the loop.
High-impact automation should put a deterministic workflow engine around the agent.
The agent can then fill bounded perception or interaction gaps inside workflow states.
### Memory channels
AgentOutput has short memory fields that help the next step.
ActionResult can carry long-term memory, extracted content, attachments, and metadata.
History stores model outputs, results, browser state history, and step metadata.
The message manager derives a history description from these sources.
Long-term memory can be retained when an action explicitly marks it.
Read state can be included only once for large content.
Screenshots can likewise be included once to control context growth.
These are different channels with different retention costs.
### History compaction
Message compaction runs on a configured cadence and minimum character threshold.
It can include the latest read state when requested.
The compaction prompt asks for durable task context and explicit confirmation information.
Sensitive values are filtered before compaction.
The compacted text is labeled as unverified context.
The manager keeps the first system message and a configurable recent tail.
Compaction reduces token cost while preserving a bounded continuity signal.
It cannot guarantee that every browser fact survives.
Operators should record the compaction boundary and source message IDs.
Source: https://github.com/browser-use/browser-use/blob/950eb03617e67548d759c02beac1ad122c6b6458/browser_use/agent/message_manager/service.py
### Unverified context rule
Compacted memories and page-derived notes are not authoritative facts.
They can be stale after navigation or a new login state.
They can contain a prompt injection from a page.
The model should verify high-impact claims against current browser state.
The action layer should verify preconditions independently of memory.
The label unverified context is a useful semantic barrier.
An adapter should propagate that label into logs and evaluator inputs.
### Context shaping
The system message provides role, action schema, constraints, and task conventions.
The state message contains the current browser projection.
The history description supplies selected prior outcomes.
The plan description supplies task structure.
The sensitive-data description supplies placeholders without values.
The file section supplies permitted file capabilities.
The sequence keeps live state close to the decision point.
Older history is compressed or dropped before the next request.
This is a layered context architecture rather than a single prompt transcript.
### Model variants
The agent can use a primary LLM and a fallback LLM.
The fallback path is selected for specific provider or transient status classes.
Once switched, the fallback can become the run's model for subsequent calls.
A page-extraction LLM can be separate from the action-planning LLM.
A judge LLM can separately assess the final trace.
These roles allow cost, latency, and capability specialization.
They also create model-boundary risks that need consistent policy injection.
Source: https://docs.browser-use.com/open-source/supported-models
### Flash mode
Flash mode reduces reasoning overhead for speed-sensitive runs.
The current source also couples provider-specific behavior to planning configuration.
An adapter should not assume that a speed flag only changes token budgets.
Any mode that changes planning or action output semantics must be visible in the run configuration.
Fast paths need the same domain, secret, file, and terminal-action safeguards.
### Memory failure modes
The model can write a confident but false memory.
Compaction can erase a critical exception.
The first-plus-recent retention strategy can omit a middle-step side effect.
Long-term memory can outlive the browser profile to which it refers.
Attachments can preserve evidence without preserving the authorization context.
Memory should therefore carry provenance, timestamp, target, and confidence.
### Planning and memory research checkpoints
Checkpoint M: plans coordinate reasoning but do not enforce side-effect semantics.
Checkpoint N: action schemas are the principal effect boundary.
Checkpoint O: secret substitution should be a domain-scoped broker.
Checkpoint P: compaction is lossy and must be marked unverified.
Checkpoint Q: model roles should be separately governed.
Checkpoint R: retries need idempotency awareness.
Checkpoint R: retries need idempotency awareness.
## Error, retry, and recovery design
### Failure taxonomy
Browser-use encounters failures at several layers.
Model failures include authentication, rate limiting, server errors, truncated output, and empty action lists.
Schema failures include invalid action names, malformed parameters, and extra fields.
Browser failures include disconnected CDP sessions, closed pages, target changes, and load stalls.
DOM failures include snapshot timeouts, inaccessible frames, and stale selector maps.
Tool failures include handler exceptions, invalid files, policy rejection, and action timeout.
Task failures include loops, budget exhaustion, and an incomplete final result.
Operational failures include telemetry or cleanup errors.
These categories should not share one generic retry loop.
### Step error envelope
The step method wraps preparation, model generation, and execution in a broad exception boundary.
The boundary records an ActionResult-style error when possible.
Interruption is treated specially so user stops are not mistaken for faults.
Connection-like errors cause a wait for reconnect.
If the browser is restored, the next step receives an informational result.
If the browser is closed, the agent marks the run stopped.
Other errors increment consecutive failures and return structured context to the model.
The broad boundary is a last-resort containment mechanism.
Lower layers should retain typed causes before the broad boundary formats them.
Source: https://github.com/browser-use/browser-use/blob/950eb03617e67548d759c02beac1ad122c6b6458/browser_use/agent/service.py
### Connection recovery
The browser session exposes connection and reconnect state.
Warm-resume logic can restart an event bus after a previous teardown.
A disconnected browser is not equivalent to a failed task.
The recovery path should avoid replaying the last non-idempotent action automatically.
It should first determine whether the browser accepted the action before disconnecting.
The current loop can inform the next model step that the connection recovered.
That informational result should remain separate from an application success result.
Remote sessions add network and lease failures to the same category.
Source: https://github.com/browser-use/browser-use/blob/950eb03617e67548d759c02beac1ad122c6b6458/browser_use/browser/session.py
### Model fallback
The tested fallback path switches on status classes including 401, 402, 429, 500, 502, 503, and 504.
It does not switch for every client-side 400 error.
An output truncation exception can also trigger fallback behavior.
The switch is intended to happen once rather than oscillating between providers.
Fallback should preserve the same action schema and system policy.
Different model capabilities can still alter grounding quality or structured output behavior.
The trace should record the provider switch, reason, and step number.
Source: https://github.com/browser-use/browser-use/blob/950eb03617e67548d759c02beac1ad122c6b6458/tests/ci/test_fallback_llm.py
### Empty and invalid model output
An empty action list creates no browser effect but can consume a model turn.
The agent retries empty output through a bounded path.
Schema validation errors should return actionable feedback to the model when safe.
Repeated invalid output should count against failure budgets.
The system must not execute an approximate action because a schema was invalid.
A structured-output provider can still produce semantically nonsensical but schema-valid actions.
Semantic validation belongs after schema validation and before effect execution.
### Action timeout recovery
A handler that hangs is bounded by the tools action timeout.
Tests cover invalid timeout values such as NaN, infinity, and nonpositive values.
The default timeout is expected to exceed the inner extract wait in the tested configuration.
After a timeout, the browser may be in an unknown post-effect state.
The next recovery step should observe the page before repeating.
A timeout on read-only extraction is easier to retry than a timeout on submission.
The error result should include action name, elapsed time, target, URL, and uncertainty.
Source: https://github.com/browser-use/browser-use/blob/950eb03617e67548d759c02beac1ad122c6b6458/tests/ci/test_action_timeout.py
### Failure counters
Consecutive failures are a liveness guard.
They should reset only after meaningful progress, not merely after a successful wait.
The current agent has a configurable max_failures setting.
The current source default is five.
The official parameter documentation describes three on its documented surface.
This is another version-sensitive discrepancy that should be pinned in an adapter.
The count should distinguish model, browser, policy, and application errors.
One shared number is useful for stopping but insufficient for diagnosis.
### Replan nudge
Repeated errors can trigger a replan instruction.
The nudge tells the model that the current route is not advancing.
This is a soft recovery because it changes context rather than execution policy.
Soft recovery is appropriate when the browser is healthy and a different route may work.
It is not sufficient when the action is forbidden or the browser is disconnected.
The nudge should include evidence without exposing secrets or untrusted instructions as authority.
### Exploration nudge
The agent can prompt exploration when it has spent steps without assigning a plan item.
This helps escape a loop where the model repeatedly performs local actions without task structure.
Exploration should have a separate budget.
Otherwise the agent can trade a short loop for an expensive site tour.
The model should be instructed to use read-only actions first when exploring.
### Loop detection
Action loop detection normalizes actions before hashing them.
Tests cover repeating patterns at thresholds such as five, eight, and twelve occurrences.
The detector uses a sliding window rather than an unbounded transcript.
Page stagnation is detected after repeated identical page fingerprints.
The fingerprint includes URL, element count, and a DOM-text hash.
The loop detector can combine repeated actions and stagnant page state.
Wait, done, and go-back actions are excluded from some action-hash updates.
Exclusions reduce false positives but can hide loops involving navigation or waiting.
The nudge path is a warning signal before hard termination.
Source: https://github.com/browser-use/browser-use/blob/950eb03617e67548d759c02beac1ad122c6b6458/tests/ci/test_action_loop_detection.py
### Loop detector interpretation
A repeated action may be legitimate when polling a job status.
A stable page may be the correct state while a server-side job runs.
The detector should understand wait duration and application progress where available.
A page fingerprint can miss data changes that occur outside visible text.
It can also report stagnation when an interaction succeeded but rendered the same page.
Use loop detection to trigger verification and replanning before stopping.
### Multi-action guards
Multi-action execution includes static terminal-action guards.
It also compares URL and focus target identity after an action.
If the page changes, the remaining actions are dropped.
This avoids running stale selectors after navigation, popup opening, or tab switching.
A model can still make a wrong first action before the guard fires.
The first action needs the strongest grounding and policy checks.
The guard should record why the sequence stopped.
Source: https://github.com/browser-use/browser-use/blob/950eb03617e67548d759c02beac1ad122c6b6458/tests/ci/test_multi_act_guards.py
### Browser reconnect versus page recovery
Reconnect restores the transport and session handles.
It does not prove that the page state is unchanged.
After reconnect, the DOM and focus should be recaptured.
Downloads and popup events may have occurred while the process was disconnected.
The session should reconcile browser reality with the last recorded observation.
The action result should not claim success until that reconciliation completes.
### Forced completion after failure
After the configured failure limit, the model receives a reduced action surface.
The remaining attempt is used to return done and preserve partial output.
The resulting final result can be incomplete even when the done action reports success.
The history exposes both success metadata and errors.
Consumers must inspect is_done, is_successful, has_errors, and final result together.
Forced completion is graceful degradation, not a correctness guarantee.
### Forced completion after budget
After the last step, only done is available.
The final done payload should state what was achieved and what was not verified.
The run history should include a budget-exhaustion error.
If the task output has a schema, partial structured output should be distinguishable from validated complete output.
### Judge and ground truth
An optional judge evaluates the final trace against task ground truth.
The trace can include the task, final result, steps, screenshots, and a separate judge model.
The judge is useful for evaluation and regression monitoring.
It should not be allowed to authorize external side effects.
Ground truth may itself be incomplete or ambiguous for dynamic web tasks.
Judge disagreement is an evaluation finding, not necessarily a runtime failure.
Source: https://github.com/browser-use/browser-use/blob/950eb03617e67548d759c02beac1ad122c6b6458/browser_use/agent/service.py
### Error propagation contract
Every failure should carry layer, action, target, URL, retryability, idempotency risk, and evidence.
The user-facing message can be concise while the trace preserves the full envelope.
The model-facing message should describe the next safe decision.
The policy-facing event should say whether an attempted effect was blocked.
The operations-facing metric should support aggregation by provider, domain, action, and cause.
One string cannot satisfy all four audiences.
### Recovery decision table
If the model returns a transient provider error, retry or switch provider within a cap.
If schema validation fails, re-prompt with a precise validation issue.
If the browser disconnects, wait for reconnect and re-observe.
If the page changes mid-sequence, stop the sequence and recapture DOM.
If a policy check fails, do not retry unless policy state changed under authorization.
If a read-only action times out, re-observe and retry once or twice.
If a non-idempotent action times out, verify effect before repeating.
If loops persist, replan or stop with partial evidence.
If budget expires, force truthful completion and preserve the trace.
### Recovery research checkpoints
Checkpoint S: recovery must separate unknown effect from known failure.
Checkpoint T: fallback must preserve policy and schema contracts.
Checkpoint U: retry budgets belong to layers and action classes.
Checkpoint V: loop detection should prompt verification before termination.
Checkpoint W: graceful finalization must preserve partial truth.
Checkpoint X: judge outputs are evaluation signals, not authorities.
Checkpoint X: judge outputs are evaluation signals, not authorities.
## Multi-agent and service boundaries
### Why boundaries matter
An agent can be embedded in a synchronous application or run as a long-lived service.
The browser can be local, remote, or cloud hosted.
Credentials can be injected by the caller, a profile, or a managed secret broker.
Observability can be in-process or exported through OpenTelemetry.
These choices create different failure domains.
They also change which component is trusted to make an authorization decision.
An adaptation should map each boundary before adding concurrency.
### Process-local topology
The simplest topology has one coordinator process.
The coordinator owns Agent, BrowserSession, MessageManager, ToolRegistry, and model clients.
The browser runs as a child process or an attached external browser.
This topology has low latency and simple object ownership.
It also shares memory, file descriptors, and credentials across components.
An untrusted custom tool can reach more state than its action signature suggests.
Process-local convenience is not process-level isolation.
### Remote browser topology
In a remote browser topology, the coordinator holds a session reference and CDP endpoint.
The browser service owns the actual page, profile, cookies, downloads, and recording.
The coordinator sends browser operations through a protocol.
Connection loss becomes a first-class distributed failure.
The browser service must authenticate every session operation.
The CDP endpoint should never be exposed as an unauthenticated public capability.
Live-view URLs need their own access policy and expiry.
### Cloud session topology
The cloud API separates agent sessions and raw browser sessions.
Creating an agent session can create or attach to a browser resource.
The API supports task submission, status polling, outputs, cost limits, and recordings.
Session identifiers become durable correlation handles.
Follow-up tasks can reuse browser state without reusing agent message context.
Profiles persist cookies, local storage, and other browser state when sessions are stopped appropriately.
Workspaces persist files across sessions.
Webhooks provide an asynchronous status channel.
Source: https://docs.browser-use.com/cloud/api-v3/sessions/get-session
### Control-plane API
The control plane should expose create, observe, interrupt, continue, and terminate operations.
Create should bind task, policy, model, profile, workspace, and budget.
Observe should return status, current step, last summary, cost, and evidence references.
Interrupt should stop new effects and preserve a coherent trace.
Continue should require explicit authorization when the page or credentials changed.
Terminate should release the browser lease and decide whether profile state persists.
The public API should not expose arbitrary internal Python objects.
### Event boundary
The event bus connects browser lifecycle and watchdogs with agents and tools.
Events can indicate browser start, page creation, download, popup, CAPTCHA, security rejection, and shutdown.
Event handlers must be nonblocking or isolated from the action path.
The resilience tests model a warm-resume case where a previous bus is torn down.
Dispatch can restart the event bus or become a safe no-op according to lifecycle.
This prevents a stale event channel from crashing a resumed task.
Source: https://github.com/browser-use/browser-use/blob/950eb03617e67548d759c02beac1ad122c6b6458/tests/ci/test_event_bus_resilience.py
### Multi-agent patterns
One coordinator with one browser is the safest default.
A planner agent can propose subgoals while an executor agent owns browser effects.
A verifier agent can inspect results without having write-capable tools.
A specialist extraction agent can process page content under a narrower data budget.
A human-in-the-loop operator can take control for authentication or high-risk steps.
Each additional agent adds context transfer and disagreement surfaces.
The browser should have one serialized write authority unless concurrency is explicitly designed.
### Shared browser state
Multiple agents can share tabs, cookies, and local storage if they use a common browser session.
They should not automatically share message history or secret maps.
The shared state needs a lease or focus lock.
Writes should carry an agent identity and expected page version.
An agent resuming after another agent's action must recapture DOM.
The cloud follow-up model provides a useful separation: browser continuity without reasoning continuity.
Source: https://docs.browser-use.com/cloud/agent/follow-up-tasks
### Planner and executor boundary
The planner can produce a plan, constraints, and required evidence.
The executor can translate one plan item into bounded browser actions.
The executor should reject plans that violate profile policy.
The planner should not receive raw credentials or unnecessary page secrets.
The executor should report observations and effect status, not rewrite the plan silently.
This boundary limits the blast radius of a hallucinated plan.
### Verifier boundary
A verifier can inspect the current browser state and action trace.
It can check whether a confirmation page, receipt, or record exists.
It should use read-only tools whenever possible.
Its result should distinguish observed facts, inferred facts, and missing evidence.
The executor should not be able to mark its own high-impact action verified without an independent observation.
### Human boundary
Human-in-the-loop is a browser-state transition, not merely a chat message.
The human can interact through a live URL.
The agent can later continue with a follow-up task on the same state.
The inactivity window and overall session duration are operational controls.
The handoff should record who authorized continuation and what page was visible.
The agent should re-check domain and sensitive-data policy after the human returns control.
Source: https://docs.browser-use.com/cloud/agent/human-in-the-loop
### MCP boundary
The cloud MCP server exposes selected session operations to an external tool client.
MCP turns session status and messages into a capability surface for another model or orchestrator.
The server should apply tenant, session, and action authorization to every method.
Message retrieval can contain page-originated prompt injection and secrets if redaction is incomplete.
MCP consumers should treat returned messages as untrusted context.
The MCP boundary should not be assumed to inherit the browser's domain policy automatically.
Source: https://docs.browser-use.com/cloud/guides/mcp-server
### Webhook boundary
Webhooks provide asynchronous status delivery.
They should be signed, replay-protected, and idempotently consumed.
The event payload should include session identity, event type, status, timestamp, and a correlation ID.
Consumers should fetch authoritative state rather than trusting a single delivery.
Webhook handlers should not resume a browser action without explicit policy evaluation.
### Profile boundary
A browser profile is durable authority over cookies and local storage.
Persisting it across tasks can create unintended cross-task identity.
Profile IDs should be tenant-scoped and access-controlled.
Profile state should have retention, revocation, and deletion policies.
The user-facing task should state whether profile reuse is intended.
Source: https://docs.browser-use.com/cloud/guides/profile-sync
### Workspace boundary
Persistent workspaces are useful for downloads, generated files, and multi-step tasks.
They are also a cross-task data channel.
Files should be namespaced by tenant, session, and task purpose.
Downloads need content-type, size, and malware policy.
The browser action should never be able to write outside its workspace capability.
Workspace cleanup should be explicit and auditable.
Source: https://docs.browser-use.com/cloud/agent/workspaces
### Queue and scheduler
A service wrapper should treat each run as a lease-bearing job.
The scheduler assigns a browser resource and a policy profile.
The coordinator renews the lease while the run is active.
Heartbeat failure should stop new side effects before the browser is orphaned.
Cancellation should be propagated to model calls, tool calls, and browser events.
A stuck job should be recoverable without replaying unknown effects.
### Tenancy
Tenant identity should be bound to every session, profile, workspace, model request, and trace.
Domain policy should be tenant-specific.
Secret substitution should select secrets from the tenant's vault, not a global dictionary.
Recordings and screenshots can contain personal data and need tenant isolation.
Cloud cost and token metrics should be attributed to the tenant that authorized the run.
### Concurrency
Browser actions should usually be serialized per focus target.
Independent extraction of a saved page can be parallelized if it uses immutable content.
Watchdog observations can be concurrent with agent reasoning only if snapshots are versioned.
Parallel actions on one tab create event-order ambiguity.
An action queue with expected page versions is safer than unrestricted asyncio concurrency.
### Multi-agent research checkpoints
Checkpoint Y: shared browser state does not imply shared reasoning authority.
Checkpoint Z: one serialized write owner is a safe default.
Checkpoint AA: human takeover requires a post-handoff policy recheck.
Checkpoint AB: cloud session, browser session, profile, and workspace are distinct assets.
Checkpoint AC: every service boundary needs identity, lease, and replay semantics.
## Observability and evidence
### Trace model
An agent trace should connect task, session, step, model request, action, browser effect, and final result.
The agent history already carries model outputs, results, browser state history, and step metadata.
A production trace should add stable IDs to each of those records.
Timestamps should use a monotonic duration clock plus wall-clock event time.
Every action should identify target, URL, frame, grounding method, and policy decision.
### Agent-level telemetry
Agent telemetry can report run start, step start, step end, done, failure, interruption, and cleanup.
It can report configured budgets and actual step count.
It can report whether planning, vision, fallback, and judging were enabled.
Configuration values should be redacted or normalized when they contain endpoints or sensitive data.
The run should expose a correlation ID to the caller.
### Model-level telemetry
Model spans should record provider, model, request latency, response latency, token counts, status, and fallback transitions.
Prompt bodies should not be logged by default when page content or credentials can appear.
A hashed prompt fingerprint can help compare regressions without retaining contents.
Structured-output validation failures should include schema version and field path.
Cost should be computed from provider metadata where possible and marked estimated otherwise.
### Browser-level telemetry
Browser spans should record page navigation, target creation, target focus changes, CDP calls, and action timing.
Selectors and coordinates should be logged as redacted or hashed values when they may contain secrets.
Screenshots and recordings need access control and retention.
Downloads should record size, path capability, and digest rather than raw content by default.
### Tool spans
OpenTelemetry instrumentation can represent high-level agent spans and lower-level browser action spans.
OpenLIT documentation emphasizes granular agent-to-browser traces, token usage, cost, and failure debugging.
Laminar documentation describes execution traces, costs, session recordings, and a synchronized timeline.
The implementation should not depend on either vendor to preserve the span vocabulary.
The semantic vocabulary should be stable across exporters.
Source: https://docs.browser-use.com/open-source/development/monitoring/openlit
Source: https://docs.browser-use.com/open-source/development/monitoring/observability
### Event timeline
The most useful timeline interleaves intention and effect.
Record the model's selected action before dispatch.
Record policy evaluation before the browser call.
Record browser acknowledgement or timeout after dispatch.
Record the next observation and whether it confirms the intended effect.
This sequence exposes the difference between proposed, permitted, sent, accepted, observed, and verified.
### Evidence attachments
Action results can carry attachments, screenshots, and extracted content.
Evidence should be bound to the page URL, target identity, and capture time.
An attachment should state whether it is raw, filtered, or model-generated.
Structured output should retain a reference to the evidence that supports each critical field.
Evidence is not automatically trustworthy because it came from the browser.
### Metrics
Useful metrics include task completion rate, verified completion rate, false-success rate, and forced-completion rate.
Track model calls per successful task and browser actions per successful task.
Track stale-selector retries, policy blocks, action timeouts, reconnects, and loop nudges.
Track fallback provider rate and schema-invalid output rate.
Track extraction truncation and context-compaction frequency.
Track time spent waiting for CAPTCHA or human interaction.
Track cost by task class, domain, model role, and outcome.
### Logs and privacy
Structured logs should classify data sensitivity before export.
Page text is often personal or proprietary.
Inputs can contain secrets even when placeholders were used in the model prompt.
URLs can include query parameters with tokens or identifiers.
Screenshots can include full account pages.
Logging policy should default to metadata and sampled, redacted evidence.
Debug mode should require an explicit operator authorization and retention limit.
### Recordings
Browser recordings help explain visual misgrounding and side effects.
They also capture credentials, personal data, and private communications.
Recording must be a policy choice, not an invisible observability default.
Cloud sessions expose recording configuration and references.
The trace should indicate whether a recording exists and how long it is retained.
Source: https://docs.browser-use.com/cloud/api-v3/sessions/get-session
### User-facing status
Long-running cloud sessions need status, last summary, current step, cost, and live-view references.
Status should be monotonic and idempotent under polling.
A summary should not replace the authoritative final result.
The caller should see when the agent is waiting for a human or CAPTCHA.
The caller should see when a model fallback or policy block occurred.
### Audit semantics
An audit record should answer who authorized the run, which profile was used, what domain policy applied, which actions were proposed, which were permitted, and what evidence was observed.
It should support reconstruction without requiring raw prompt retention.
Audit records should be append-only from the coordinator's perspective.
Corrections should be new events, not mutations of old evidence.
### Observability research checkpoints
Checkpoint AD: intention and effect need separate spans.
Checkpoint AE: trace data is itself sensitive.
Checkpoint AF: verification rate is more informative than self-reported success.
Checkpoint AG: stable semantic spans enable vendor-neutral exports.
Checkpoint AH: recordings are evidence and a privacy liability.
Checkpoint AH: recordings are evidence and a privacy liability.
## Security and policy implications
### Threat model
The browser page is an adversarial information source.
The model is a probabilistic policy generator.
The browser runtime is a powerful effect executor.
Credentials, files, and profiles are high-value assets.
The network can redirect, degrade, or impersonate expected endpoints.
The operator can be rushed by a convincing page or task result.
The primary security objective is to prevent untrusted page content from expanding authorized capabilities.
### Prompt injection
Page text can contain instructions addressed to the agent.
Those instructions must remain data in the observation channel.
The model's system policy must state that page text cannot change tools, domains, secrets, or approval requirements.
Context compaction can accidentally remove the warning while retaining the injection.
The message manager should preserve the untrusted-data boundary across compaction.
Extracted markdown and accessibility names require the same treatment as visible text.
### Origin policy
Allowed domains should be explicit for sensitive workflows.
Prohibited domains provide a second blocklist but do not replace an allowlist.
Canonical URL parsing must handle ports, userinfo, fragments, punycode, redirects, and malformed input.
Policy should compare the effective origin, not a substring in the displayed URL.
IP-address blocking can reduce SSRF-like navigation paths but needs an explicit local-network policy.
Wildcards should not unexpectedly match sibling domains or deceptive public suffixes.
Test cases should include URL encoding, alternate ports, credentials in URLs, and malformed schemes.
Source: https://github.com/browser-use/browser-use/blob/950eb03617e67548d759c02beac1ad122c6b6458/tests/ci/security/test_domain_filtering.py
### Redirect policy
A permitted starting URL can redirect to a forbidden origin.
The browser must apply policy after redirects and popup creation.
A navigation action that returns a redirect chain should record every origin.
The policy decision should occur before exposing sensitive data to the new page.
Domain-specific action availability should be recomputed after navigation.
### Credential policy
Credentials should be bound to exact or safely matched domains.
The domain map should not allow a broad parent domain to satisfy a sensitive subdomain unless intended.
The action prompt can include placeholder names and instructions but not secret values.
The substitution layer should preserve literal user text that resembles a placeholder when it is not authorized.
TOTP generation should be time-bounded and never placed in long-term memory.
Secrets should be absent from screenshots, recordings, logs, compaction summaries, and telemetry payloads where possible.
Source: https://docs.browser-use.com/open-source/customize/browser/authentication
### Authentication profiles
Using a real Chrome profile can retain existing login state.
Storage state can provide a portable authentication snapshot.
TOTP support can automate time-based challenges.
Persistent profiles improve convenience but increase cross-task contamination risk.
The task should identify whether authentication is interactive, delegated, or pre-established.
The browser profile should be disposable for untrusted sites.
For high-value workflows, use a dedicated account with least privilege.
### Human approval policy
A model should not be the sole approver for irreversible or legally significant effects.
Examples include purchases, deletion, external communications, permission changes, and financial actions.
Approval should be requested at the point where the final effect is known.
A generic approval at task start is weaker because the actual target can change.
The approval record should include target, amount or scope, destination, and summarized consequence.
Human takeover should expire and require reauthorization after navigation or policy changes.
### Confirmation page verification
A visually reassuring confirmation page is not enough for high-value actions.
The verifier should inspect transaction identifiers, target identity, and application state where possible.
An application API or out-of-band receipt can provide stronger evidence than DOM text.
The agent should return unverified when the page cannot prove the effect.
### File and download policy
Downloads can contain malware, secrets, or unexpected data volumes.
The download watcher should enforce size, type, count, and destination limits.
The file capability should be scoped to the current task and workspace.
Uploads should require explicit authorization for file category and destination.
Downloaded data should not automatically become available to future sessions.
### Browser isolation
Run untrusted tasks in a sandboxed browser with a separate OS identity.
Restrict network egress to allowed origins where feasible.
Disable extensions unless they are required and trusted.
Use an ephemeral profile for tasks that do not need persistent login.
Limit CDP access to the coordinator and authenticated browser service.
The browser sandbox reduces impact but cannot fix a confused deputy in the coordinator.
### Tool policy
Tools should be classified read-only, reversible-write, irreversible-write, credentialed, file-capable, and code-capable.
The model should receive only the subset needed for the task.
The registry should enforce class policy before function invocation.
Evaluate and upload deserve stronger default restrictions than click and extract.
Custom tools should declare data access and side-effect classes.
### Action provenance
An action record should carry the model call ID that proposed it.
It should carry the policy version that permitted it.
It should carry the observation version used for grounding.
It should carry the human approval ID when required.
This makes later attribution possible without trusting free-form model text.
### Browser context leakage
A persistent profile can expose cookies to a follow-up task.
A shared workspace can expose downloads.
A shared tab can expose prior task content.
A reused session can expose page history or in-memory tokens.
Follow-up tasks need explicit state inheritance declarations.
The default should be least state, not maximum convenience.
### Cross-agent confusion
Agent A can leave a form half-complete.
Agent B can interpret that as intentional setup.
Agent B can submit it with a different task's authorization.
The session needs a handoff summary plus a fresh observation.
The handoff summary must not be the only source of truth.
### Denial of service
Large DOMs, deep iframe trees, event-listener scans, and screenshots consume resources.
The profile limits iframe count and depth.
Node, text, screenshot, action, model, and wall-clock budgets should be explicit.
A hostile page can cause repeated navigation, downloads, or popup creation.
Rate limits and circuit breakers belong below the model.
### Policy decision ordering
First authenticate the caller and bind tenant identity.
Then resolve task, browser profile, workspace, and secret scope.
Then canonicalize and check the current origin.
Then select the allowed tool set.
Then serialize observation with untrusted-data markers.
Then validate the model action.
Then re-check action policy immediately before effect.
Then execute with timeout and audit.
Then verify the postcondition.
This ordering prevents stale prompt context from serving as authorization.
### Security tests
The upstream security tests cover domain filtering and sensitive-data behaviors.
They test that credentials are not exposed through history or model-facing representations.
They test domain restriction behavior and unsafe wildcard patterns.
They test malformed URLs and URL components.
These are valuable invariants for adapters.
They should be extended with redirects, Unicode confusables, profile reuse, and cross-tenant leakage.
Source: https://github.com/browser-use/browser-use/blob/950eb03617e67548d759c02beac1ad122c6b6458/tests/ci/security/test_sensitive_data.py
### Security policy matrix
For public browsing, use an ephemeral profile, no credentials, read-only tools, and narrow egress.
For authenticated retrieval, use domain-scoped secrets, no evaluate, download limits, and evidence capture.
For form completion, use a dedicated account, domain allowlist, idempotency checks, and human approval for submit.
For purchases or deletion, use a deterministic approval gate and independent verification.
For research extraction, use a separate extraction model and treat all content as untrusted.
For internal admin, use a dedicated profile and least-privilege account with audit retention.
### Security research checkpoints
Checkpoint AI: page content cannot grant capability.
Checkpoint AJ: origin policy must run at effect time.
Checkpoint AK: profile reuse is a credential and privacy decision.
Checkpoint AL: irreversible effects need human or deterministic approval.
Checkpoint AM: evaluate and file operations are privileged tools.
Checkpoint AN: postcondition verification is separate from action completion.
## Testing architecture
### Test layers
The upstream test layout includes focused CI tests for planning, multi-action guards, loop detection, event resilience, security, timeouts, and model fallback.
This indicates a test strategy centered on invariants rather than only end-to-end task success.
An adapter should preserve those unit and integration seams.
End-to-end browser tests remain necessary for protocol, rendering, and cross-origin behavior.
### Model-free loop tests
Planning tests can exercise plan creation, advancement, replanning, rendering, disabled mode, and nudges without a live model.
Loop tests can exercise normalized action hashes and page fingerprints with synthetic state.
Multi-action tests can assert that a target or URL change stops a sequence.
Event-bus tests can simulate warm resume and torn-down infrastructure.
These tests are fast and should run on every change.
Source: https://github.com/browser-use/browser-use/blob/950eb03617e67548d759c02beac1ad122c6b6458/tests/ci/test_agent_planning.py
### Browser fixture tests
Browser fixtures should create deterministic pages with stable labels and controlled mutations.
Include a page with a popup, a page with nested iframes, and a page with a shadow root.
Include virtualized lists and asynchronous overlays.
Include forms that report submitted state through a test endpoint.
Use a local server to avoid external-site nondeterminism.
Record target IDs and page versions in assertions.
### DOM serializer tests
Test visible versus hidden nodes.
Test disabled control exclusion.
Test shadow-root serialization.
Test iframe identity and coordinate offsets.
Test accessibility-name matching when text is absent.
Test compound controls and option previews.
Test session-specific exclusion attributes.
Test deterministic serialization across repeated snapshots.
Test truncation budgets and explicit unavailable-data markers.
### Action schema tests
Generate action unions from a registry with domain filters.
Verify runtime-only parameters cannot be supplied by model JSON.
Verify invalid indices are rejected.
Verify coordinates are scaled from screenshot to viewport correctly.
Verify terminal actions stop subsequent execution.
Verify custom actions inherit timeout and policy wrappers.
Verify upload paths remain inside the allowed file capability.
### Recovery tests
Simulate a provider 429 and verify one-way fallback.
Simulate a provider 400 and verify no inappropriate fallback.
Simulate a browser disconnect before and after a non-idempotent action.
Simulate a stale selector after a navigation.
Simulate a hung handler and assert bounded completion.
Simulate repeated action and page stagnation.
Simulate max failures and truthful forced completion.
### Security regression tests
Use domains with deceptive substrings.
Use userinfo and unusual ports.
Use redirects from allowed to forbidden origins.
Use Unicode and punycode variants.
Use placeholders on permitted and nonpermitted domains.
Assert secrets are absent from serialized history, compaction input, and telemetry payloads.
Assert profile and workspace identity never crosses tenant fixtures.
### Property-based tests
Generate malformed URLs and ensure policy decisions are total and deterministic.
Generate DOM trees with nested frames and shadow roots.
Generate action lists containing terminal and nonterminal actions.
Generate timeout values including NaN, infinity, zero, negative, and very large values.
Generate model outputs with extra fields, missing fields, empty lists, and duplicate actions.
Property tests are valuable where the input space is larger than hand-authored examples.
### Replay tests
Save normalized observation snapshots and model action JSON.
Replay registry validation and policy checks without launching a browser.
Replay browser effects against deterministic fixtures when possible.
Compare final state and audit events rather than raw DOM IDs.
Replay should support redacted traces so production incidents can be investigated safely.
### Evaluation tests
Task success should be scored separately from trace safety.
A task can succeed while violating a policy or leaking a secret.
A task can fail while correctly refusing an unsafe action.
Evaluation should include refusal quality, evidence quality, cost, latency, and recovery.
The optional judge can be a component of evaluation but should not be the only oracle.
### CI orchestration
The upstream workflow installs a browser, discovers focused test files, syncs dependencies, and runs pytest matrices.
It includes evaluation tasks and report generation.
CI configuration disables anonymized telemetry in tests.
An adapter should add deterministic local-browser tests to the same fast path.
Long-running cloud or visual tests should be isolated and labeled.
Source: https://github.com/browser-use/browser-use/blob/950eb03617e67548d759c02beac1ad122c6b6458/.github/workflows/test.yaml
### Test observability
Failed tests should expose action name, target, URL, selector-map generation, and page fingerprint.
Screenshots should be attached only when fixture content is non-sensitive.
Trace assertions should check that forbidden actions were never dispatched.
Timing tests need tolerance for CI variance but should retain upper-bound guarantees.
### Testing research checkpoints
Checkpoint AO: deterministic model-free invariants provide the fastest feedback.
Checkpoint AP: browser fixtures should target mutation races.
Checkpoint AQ: security tests must include policy bypass attempts.
Checkpoint AR: success and safety need independent scores.
Checkpoint AS: replay makes production failures actionable.
Checkpoint AS: replay makes production failures actionable.
## Limitations and failure envelopes
### Partial observability
The agent sees a serializer projection, not the entire application state.
Client-side state can live in memory, workers, canvas pixels, or network calls.
The visible DOM can omit the backend state that determines a business outcome.
The agent can therefore perform a correct UI action without proving the server-side effect.
### Model variance
Different LLM providers vary in tool-calling, vision, JSON validation, context limits, and latency.
The same task can produce different action sequences.
Fallback models can be weaker at grounding even when they are available during an outage.
Structured output reduces syntax errors but does not eliminate semantic errors.
### Dynamic pages
Single-page applications mutate nodes without navigation.
Virtualized lists create and destroy targets while scrolling.
Overlays can alter click routing after the snapshot.
Server-side polling can make a page look unchanged while progress occurs elsewhere.
The loop has useful guards, but no general solution to all mutation races.
### Accessibility quality
Accessibility trees depend on page implementation quality.
Incorrect roles or names can mislead grounding.
Custom controls may expose neither reliable DOM nor accessible semantics.
The system can fall back to coordinates, but coordinate clicks are sensitive to layout and scaling.
### Cross-origin limits
Some frames and browser contexts cannot be inspected uniformly.
Protocol permissions and site isolation affect observation quality.
A visible child frame can still be an inaccessible black box.
The model may need a human or site-specific integration for such surfaces.
### Context compression
Compaction saves cost and prevents context overflow.
It can remove the exact detail needed to recover from a rare failure.
Marking compacted memory as unverified helps, but only fresh observation can restore certainty.
### Side-effect ambiguity
Timeouts and disconnects can occur after the server accepted an action.
Generic browser automation cannot reliably distinguish sent, accepted, processed, and committed.
High-impact tasks require application-specific verification.
### Authentication friction
CAPTCHAs, passkeys, MFA, device checks, and bot defenses can interrupt automation.
Human-in-the-loop and external authentication integrations cover some cases.
There is no universal safe way to automate every authentication challenge.
### Resource use
DOM snapshots, screenshots, event listeners, recordings, and model calls can be expensive.
Large pages can dominate latency before the model reasons.
Cloud profiles and recordings add storage and retention cost.
Budgets are necessary but can cause incomplete tasks.
### Tool extensibility risk
Custom actions are a powerful escape hatch.
An action with a broad browser session parameter can silently bypass the intended abstraction.
Review, registration metadata, and runtime wrappers must be mandatory.
### Service failure
Cloud sessions depend on API availability, browser fleet health, leases, polling, webhooks, and credentials.
Local sessions depend on a process, browser binary, profile directory, and CDP connection.
Recovery can preserve control flow but cannot reconstruct lost external side effects.
### Evaluation limits
Task benchmarks often measure final text or page state, not authorization quality.
A judge model can share the same blind spots as the executor.
Screenshots and DOM traces can make a run look explainable while omitting network-side effects.
### Limitations research checkpoints
Checkpoint AT: a successful UI gesture is not a verified business outcome.
Checkpoint AU: model fallback changes quality, not only availability.
Checkpoint AV: accessibility and DOM quality are properties of the target site.
Checkpoint AW: generic retries cannot solve unknown side effects.
Checkpoint AX: budgets trade liveness against completeness.
## Adaptation playbook
### Adaptation goal
The objective of an adaptation is to preserve the useful control semantics while fitting a different runtime.
Do not begin by copying class names.
Begin by defining observation, action, policy, evidence, and lifecycle contracts.
Then decide which browser-use mechanisms are directly reusable.
### Phase 0: establish constraints
Write the task classes that the system must support.
Classify each task as read-only, reversible write, or irreversible write.
Define allowed origins and authentication modes.
Define whether a persistent profile is permitted.
Define file and download requirements.
Define latency, cost, and step budgets.
Define whether human approval is mandatory for selected effects.
Define evidence required for completion.
### Phase 1: define the run contract
Create a RunSpec containing task, tenant, actor, profile, workspace, policy, model roles, budgets, and output schema.
Create a RunState containing lifecycle state, current target, observation version, plan, counters, and evidence references.
Create an ActionProposal containing model call, action name, validated parameters, and observation version.
Create an EffectRecord containing dispatch, acknowledgement, uncertainty, and postcondition status.
Create a FinalResult containing output, completion state, safety state, and error summary.
Keep these contracts independent of the LLM client.
### Phase 2: isolate browser ownership
Choose one owner for the browser session.
Expose only operations needed by the action registry.
Make target and focus identity explicit.
Add a session lease and shutdown owner.
Return a browser snapshot with target, URL, frame graph, and generation.
Do not let tools create unmanaged pages without registering them.
### Phase 3: build observation
Implement a composite snapshot from DOM, accessibility, layout, screenshots, and browser events.
Put a strict budget on nodes, frames, text, screenshots, and capture time.
Return explicit unavailable markers.
Version the serializer and selector map.
Attach observation provenance to every proposal.
Add deterministic fixture pages before connecting a production model.
### Phase 4: define capabilities
Register only actions needed for the task class.
Give each action a typed schema.
Declare whether it is read-only, mutating, credentialed, file-capable, code-capable, or terminal.
Declare preconditions and postcondition evidence.
Wrap every action with policy, timeout, audit, and error normalization.
Make domain restrictions visible to the model at the capability level.
### Phase 5: add grounding
Prefer semantic and exact selectors over coordinates.
Retain frame, shadow-root, target, and observation-generation identity.
On mismatch, recapture before fallback matching.
Emit the matching level used.
Stop rather than guess when multiple candidates are equally plausible.
Use screenshots for visual confirmation, not as a replacement for policy checks.
### Phase 6: add planning
Start with a short plan list.
Use plan status as context, not as authorization.
Require evidence or a new observation before marking high-impact items done.
Replan after repeated failures or contradictory state.
Use a separate exploration budget.
Keep the plan short and preserve the previous plan in trace metadata.
### Phase 7: add memory
Separate live state, short memory, durable task memory, and external application data.
Label model-generated memory as unverified.
Attach provenance and expiry to durable facts.
Compact only after preserving critical approvals, destinations, amounts, and identifiers.
Redact secrets before memory, telemetry, and replay storage.
Avoid carrying memory across tenants or profiles.
### Phase 8: add recovery
Define retry classes per action.
Never automatically repeat an uncertain non-idempotent action without verification.
Use bounded model fallback with schema and policy parity.
Reobserve after reconnect, navigation, popup, or timeout.
Nudge and replan before hard stop when the browser is healthy.
Force truthful completion on budget exhaustion.
Preserve partial outputs and errors together.
### Phase 9: add policy
Canonicalize origin before every sensitive action.
Apply allowlist, denylist, IP, redirect, and target checks.
Keep secrets in a scoped broker.
Keep file paths inside task capabilities.
Block or isolate evaluate.
Require human approval for irreversible effects.
Verify postconditions independently.
### Phase 10: add evidence
Define success predicates that can be checked from browser state or an external system.
Capture URL, target, action, result, and evidence reference.
Make self-reported success distinct from verified success.
Store evidence under tenant and retention policy.
Expose a concise final result with links to authorized evidence.
### Phase 11: add service surfaces
Wrap the run in an authenticated API.
Expose status polling and idempotent interruption.
Use webhooks for asynchronous updates.
Bind profile and workspace identifiers to tenant policy.
Use signed, replay-protected callbacks.
Treat live-view and MCP surfaces as privileged.
### Phase 12: add observability
Instrument intent, policy, dispatch, browser acknowledgement, observation, and verification.
Measure cost, latency, retry, loop, fallback, and policy-block rates.
Sample sensitive payloads aggressively.
Make recordings opt-in and time-bounded.
Provide redacted replay for incidents.
### Phase 13: validate
Run model-free unit tests.
Run deterministic local-browser tests.
Run security and policy regression tests.
Run replay tests on redacted production traces.
Run task evaluations with independent safety scores.
Test interruption, reconnect, provider failure, page mutation, and cleanup.
### Default adaptation profile
Use one coordinator and one browser session.
Use an ephemeral profile.
Use a narrow domain allowlist.
Expose read-only navigation, click, input, and extract first.
Disable evaluate and uploads initially.
Use one model role for planning and a separately governed extraction role.
Set a small action sequence cap.
Require postcondition verification for writes.
Add human approval before any irreversible effect.
Store redacted traces and no default recordings.
### Enterprise adaptation profile
Use a remote or cloud browser with tenant isolation.
Use managed profiles with explicit persistence approval.
Use a workspace with content scanning and retention.
Use a policy engine outside the model prompt.
Use model fallback with approved provider routing.
Use signed webhooks and session leases.
Use OpenTelemetry-compatible traces and immutable audit events.
Use independent verification for transactional outcomes.
Use a dedicated operator workflow for CAPTCHA and MFA.
### Research adaptation profile
Use deterministic fixtures and replayable snapshots.
Expose raw and serialized DOM only in isolated experiments.
Allow evaluate in a disposable browser.
Capture full traces with synthetic secrets.
Measure grounding, recovery, cost, and false-success rates.
Keep research credentials and domains separate from production.
### Migration checklist
List every existing effect and map it to a typed action.
List every browser handle and define its owner.
List every state field and assign its retention class.
List every secret path and remove prompt interpolation.
List every service boundary and add identity and replay protection.
List every retry and mark idempotency risk.
List every success claim and define verification evidence.
List every log and classify data sensitivity.
List every browser fixture and add mutation cases.
### Anti-patterns
Do not expose raw browser protocol commands as a general model tool.
Do not treat DOM text as trusted instructions.
Do not retry a timed-out purchase blindly.
Do not share a persistent profile by default.
Do not carry compacted memory as authoritative state.
Do not let a final done action erase earlier errors.
Do not use a judge result as permission to continue.
Do not assume a URL match protects a redirect.
Do not log full screenshots by default.
Do not add custom tools without policy and audit wrappers.
### Adaptation decision matrix
If the task is read-only and public, favor local ephemeral execution and low-cost traces.
If the task is authenticated but reversible, use a dedicated profile and scoped secrets.
If the task mutates external state, add verification and idempotency handling.
If the task is irreversible, add human approval and an independent verifier.
If the page is visually complex, enable vision with sensitive-page controls.
If the page is highly dynamic, lower multi-action length and increase recapture frequency.
If the site is hostile, narrow egress and disable privileged tools.
If the run is long, use cloud sessions, lease renewal, polling, and webhooks.
If the evidence is legally significant, retain immutable audit and external confirmation.
### Adaptation checkpoints
Checkpoint AY: contracts precede implementation.
Checkpoint AZ: one browser owner prevents ambiguous focus.
Checkpoint BA: capabilities must declare effect classes.
Checkpoint BB: postconditions define completion.
Checkpoint BC: security policy runs below prompts.
Checkpoint BD: redacted replay is a production feature.
Checkpoint BE: service boundaries require lifecycle and identity.
Checkpoint BF: start with a narrow action surface.
