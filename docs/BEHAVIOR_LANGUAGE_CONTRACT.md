# Visual Nerve Script language contract

Version 1 records the behavior of the staging language. Version 2 evolves the language in controlled test hosts. A Behavior is a named script definition that can be bound to a diagram node. This internal contract covers compilation, action proposals and the boundaries of the two staging hosts. [CAR-179](https://linear.app/caripson/issue/CAR-179/sprak-1-versionssatt-grammatik-och-vardgranssnitt)

## Version and identity

`compileBehavior(source, version)` defaults to version 1 when the caller omits the version. A stored definition or captured simulation run supplies its recorded version. The staging hosts use `compilePreviewBehavior(source, version)`, which accepts version 1. An unsupported version yields a `version` diagnostic at line 1, column 1 before the source is parsed. A definition in the current storage envelope can retain its original source and unsupported version for inspection. Versions describe language semantics independently of the graph and simulator storage formats.

The diagram library stores a stable definition ID, name, language version, active source and optional draft source. Each binding has its own ID, node and definition references, enabled state and parameter values. Binding array order is execution order. A saved draft may contain invalid code. The previously activated source remains the executable version. Changing one binding's values leaves the other bindings independent. The staging graph envelope allows 50 definitions, 500 bindings, 120 UTF-16 code units per display name, 32,768 per active or draft source and 32 parameter entries per binding. Graph storage limits and rules for trust, migration and ID remapping belong to the hosts. [Behavior document model](../frontend/src/behaviors/document.ts) · [CAR-186](https://linear.app/caripson/issue/CAR-186/behaviors-kanonisk-lagring-dokumentversioner-och-id-remappning) · [CAR-187](https://linear.app/caripson/issue/CAR-187/behaviors-fortroende-import-och-samarbete)

## Syntax and types

Source is case-sensitive and line-based. LF, CRLF and CR delimit lines. The parser ignores blank lines and `#` comments. Parameter names start with a Unicode letter or underscore and continue with letters, numbers or underscores. Reserved names and dots are excluded from parameter names. Double-quoted strings use JSON escapes. `number` is a signed safe integer, and `boolean` uses `true` or `false`.

- Declare parameters with `parameter NAME as TYPE` and an optional `= LITERAL` before the handlers. A definition needs at least one handler. Names within the parameter declarations and event handlers must be unique in their respective scopes.
- The types are `text`, `number`, `boolean`, `node` and `resource`. The host resolves node and resource parameters from stable IDs supplied per binding. Only text, number and boolean have source defaults. Missing, unavailable or wrongly typed values yield binding diagnostics at the declaration. Undeclared entries in a binding do not become variables.
- Handlers use `on EVENT` and `end`. Conditions use `if CONDITION then` and `end if`. A condition is a boolean value or a comparison. Equality and inequality require matching types and compare without coercion. `<`, `<=`, `>` and `>=` require numbers. A comparison binds before `and`. The interpreter evaluates conjuncts left to right and skips the rest after a false result. Statements and their conditions read declared parameters, literals and the current handler's fields.

## Version 1 events and actions

| Handler | Readable fields | Action proposals |
| --- | --- | --- |
| Editor `on connectionAdded` | `event.edgeId` (text), `event.source` and `event.target` (node) | `rename NODE to TEXT`. The editor only accepts the new connection's target. |
| Simulation `on queueChanged` | `queue.previousLength` and `queue.length` (number, waiting items) | `send "MESSAGE" to node NODE` and `open reserve slot using resource RESOURCE`. |
| Simulation `on "MESSAGE"` | `event.source` and `event.target` (node) | The same simulation proposals. A reserve request applies to the receiving Work node. |

Each fixed event and each exact message name has at most one handler per definition. A definition can declare handlers for both hosts. Messages use an exact, case-sensitive string literal with non-whitespace content and no control characters. Queue handlers run against a snapshot of the change. A reserve request in a queue handler applies to that Work node.

`behaviorLanguageContract(version)` exposes the versioned language registry. The interpreter evaluates only a matching handler and returns proposals in source order with source locations. The hosts supply typed event snapshots and own authorization, graph validation, resource allocation and application of effects. [Language registry](../frontend/src/behaviors/language-contract.ts) · [Interpreter](../frontend/src/behaviors/language.ts)

- **Editor.** The ordinary manual connection command evaluates enabled bindings on the source node in stored order. The edge and any accepted rename are one undoable edit. A bad script or an invalid proposal leaves a valid new edge in place. Conflicting valid names leave the old title in place. The existing name is a no-op. Opening, importing, undoing, redoing and applying collaboration updates do not start a handler in the staging editor. Its trace links the binding and connection to the source position, proposed name and result. [Editor host](../frontend/src/behaviors/editor.ts)
- **Simulation.** The engine validates enabled bindings against Work nodes and resources before running. It captures active source and version, binding order, values, model and seed for a run and its replay. Committed queue changes and directed messages enqueue phase 5 events at the current simulated time, after phase 4 dispatch, with engine sequence breaking equal-time, equal-phase ties. A missing active recipient handler is recorded. The reserve action asks the engine to open one extra slot and start the next waiting item using ordinary resource checks and allocation. The staging host requires a single one-unit staffing requirement, excludes Work autoscaling and infrastructure-specific Work or staffing, and checks schedules, the waiting queue and available staff. A successful opening lasts for the run. [Simulation host](../frontend/src/simulation/behaviors.ts) · [Scheduling and resource allocation](../frontend/src/simulation/engine.ts)

## Staging limits and diagnostics

| Scope | Version 1 ceiling |
| --- | --- |
| Source | 16,384 UTF-16 code units and 256 lines |
| Declarations | 16 parameters and 200 UTF-16 code units per parameter name |
| Blocks | 8 nested `if` blocks |
| Handler | 128 executed instructions and 32 proposed actions |
| Bound strings | 16,384 UTF-16 code units in the interpreter. Diagram storage applies a separate 4,096-unit bound. |
| Message name | 80 UTF-16 code units |
| Simulation sends | 16 delivery hops per cause, 128 sends per simulated timestamp, and 4,096 sends per run |

Each executed statement and each evaluated conjunct consumes one instruction. Root events start at depth 0. A handler at depth 16 can still run but cannot send. The budget charges all sends proposed by a handler together and takes no partial charge when the batch exceeds a limit. Compile, binding and interpreter failures return no partial proposals for that handler. A host rejection is reported as a host outcome.

A failed compilation, binding check or interpreter call returns one diagnostic with `code`, `line`, `column` and `message`. Codes are `version`, `syntax`, `type`, `context`, `binding` and `limit`. Source positions are 1-based, with UTF-16 columns. Parse and type failures point to the offending token, binding failures to the parameter declaration, and interpreter limits to the instruction or send exceeding the budget. A source length failure points to 1:1 and a line limit failure to 257:1. The editor records script failure while retaining a valid user edit. Invalid active simulation configuration prevents run start with a source position. Interpreter failure during a run leaves that handler's effects unapplied and adds a trace row.

## Version 2 control flow and instruction costs

Compile test scripts with `compileBehavior(source, 2)`. The staging UI and simulator still execute version 1 through `compilePreviewBehavior`. The version 2 design and behavior below are exercised in controlled hosts. [CAR-184](https://linear.app/caripson/issue/CAR-184/sprak-6-verifiera-komplett-sprak-och-las-forsta-produktionskontraktet)

- **Branches.** `if CONDITION then` can have one `else` block before `end if`. Only the selected block executes. The compiler checks both branches for syntax, types and allowed actions.
- **Locals.** `local NAME as TYPE = EXPRESSION` declares a typed local in a handler, branch or repeat body. All five parameter types are available. The name is case-sensitive and becomes visible after its initializer, through the rest of that block and inside nested blocks. Disjoint blocks can reuse a name. A declaration cannot shadow a visible local, parameter or property. `set NAME to EXPRESSION` assigns a value of the declared type to a mutable name. Parameters and event fields are read-only. Locals start fresh on each handler invocation.
- **Addition.** `+` binds before comparisons, which bind before `and`. Operands and intermediate sums must be safe integers. The interpreter adds terms left to right and charges one instruction for each addend after the first. It reports overflow or an exhausted budget at that addend. `and` short-circuits, so only evaluated conjuncts and their arithmetic incur a cost.
- **Repeat.** `repeat COUNT` runs its body through `end repeat`. The count is a number expression evaluated once before the loop and must be an integer from 0 through 32. An out-of-range literal fails at compile time. An out-of-range computed count fails before any iteration. Zero skips the body. The loop body has block scope, and declarations in it initialize on every iteration. The compiler checks the body even with a literal zero count. Each iteration adds one instruction, even for an empty body. Nested `if` and `repeat` share the depth limit of eight blocks.

Version 2 allows up to 128 executed instructions and 32 proposals per handler. Each statement and each evaluated conjunct costs one instruction. Additions and loop iterations share the same budget. Interpreter failures discard the handler's staged proposals. [Control flow and repeat tests](../frontend/tests/behavior-language-v2.test.ts)

## Version 2 instance properties

Declare a property before the handlers with `property NAME as TYPE = LITERAL`. A definition can declare up to 16 properties with initializers of their declared scalar type, which can be `text`, `number` or `boolean`. Property names follow the same identifier rules as parameters. A property name is distinct from every parameter and local variable name. A simulation handler reads a property by name and assigns to it with `set NAME to EXPRESSION`. Assignments preserve the declared type. A definition may include an editor handler alongside its property declarations. The compiler rejects property reads and writes in that handler.

A new simulation run calls `createBehaviorInstanceState(program)` for each binding and holds the resulting snapshot under that binding's ID. The snapshot starts with the values declared in the captured source. The host passes its current snapshot to `runBehavior` as `{ state }` and replaces it with the successful result's state before applying the returned actions. Omitting the input starts execution from fresh defaults. A supplied snapshot must contain every declared property with the declared type, with safe integers and strings of up to 16,384 UTF-16 code units. Missing or invalid values produce a diagnostic at the property declaration. Undeclared keys are ignored. The input record stays immutable, and an event without a matching handler returns the same declared values. Each run owns its binding snapshots, so reusing a definition or starting a new run gives independent state.

A handler stages property assignments alongside its action proposals. Interpreter diagnostics, including numeric overflow and budget exhaustion, discard both. A normal host denial after successful execution, such as a reserve request finding staff busy, still leaves the state committed. The next event observes that committed snapshot. [CAR-182](https://linear.app/caripson/issue/CAR-182/sprak-3-tillstand-med-property-per-instans-och-korning)

This test recipe sends once on each binding's second queue change.

```text
property count as number = 0
parameter receiver as node

on queueChanged
  set count to count + 1
  if count == 2 then
    send "second change" to node receiver
  end if
end
```

The controlled host interleaves two bindings and checks that each counts separately. It saves the source, version, bindings and event sequence, then verifies replay after editing the live initializer. [Instance property tests](../frontend/tests/behavior-language-state.test.ts)

## Version 2 status proposal

Inside `on connectionAdded`, `set status of NODE to TEXT` proposes an editor status change. For example, `set status of event.target to nextStatus` targets the newly connected node and takes its status from a text parameter. The resulting action carries `kind: 'setStatus'`, `nodeId`, `status`, `line` and `column`. The language checks context and operand types. The host owns target eligibility and validation against its allowed statuses. The controlled host exercises this proposal. Production editor integration belongs to the editor work. [CAR-189](https://linear.app/caripson/issue/CAR-189/behaviors-auktoritativa-redigeringskommandon-och-gemensam-undo)

## Version 2 delayed messages

Simulation handlers can use `send "MESSAGE" to node NODE after SECONDS`. The optional delay is a number expression in simulated seconds. It must be a safe integer from 0 through 86,400 inclusive. The compiler checks literal bounds and the interpreter checks computed bounds at the delay expression. Positive delays add `delaySeconds` to the send proposal. Omitting the delay and supplying zero both yield the immediate send shape, with the field omitted. A zero delay still queues delivery after the current handler returns.

The controlled message host queues sends from successful handlers. Its clock uses integer milliseconds. It calculates due time as the current simulated time plus the delay, then orders the queue by due time and the message ID assigned in enqueue order across senders. Each delivery carries the same message ID, source and target IDs, origin and due timestamps, and source location as its send. A delivery retains its root cause ID and current depth. Follow-up sends record the parent message ID and increment the depth. A recipient without an active matching handler produces a trace outcome.

| Budget | Controlled host behavior |
| --- | --- |
| Origin time | The interpreter charges up to 128 sends per originating simulated timestamp, even when their due times differ. |
| Due time | The controlled host attempts up to 128 deliveries per due timestamp, even when their origin times differ. It traces the excess as `due-time-limit` without invoking the handler. |
| Pending and per run | The controlled host defaults to 4,096 pending messages and 4,096 accepted enqueues per run. Removing a queued entry releases its pending capacity. The run-wide total persists through delivery. Excess proposals give `pending-limit` or `run-limit` outcomes. The interpreter independently caps send proposals per run at 4,096. |
| Causal depth | Root events start at depth 0. Delivery is allowed through depth 16. A handler at depth 16 can run, and an attempt to send from it exceeds the chain budget. A positive delay does not reset depth. |

Advancing the controlled clock delivers messages through the inclusive horizon and keeps later messages pending. Finishing with drain enabled continues through queued work and its bounded follow-up messages. Finishing without drain discards later messages with a `beyond-horizon` outcome. Cancellation discards pending messages with a `cancelled` outcome. Reset clears the clock, queue, trace, IDs and run budgets and restores initial property values from the captured programs. The same seeded input sequence after reset reproduces the ordered trace. The product simulator's scheduling integration is separate work. [Controlled scheduler](../frontend/tests/helpers/behavior-message-host.ts) · [Delayed-message tests](../frontend/tests/behavior-language-delay.test.ts) · [CAR-190](https://linear.app/caripson/issue/CAR-190/behaviors-integrera-runtime-med-simulator-scenarier-och-replay)

## Document transfer and identity

Native imports, stored templates and full workspace backups preserve source, language version and ordered bindings. A whole-diagram copy remaps known node parameters with the graph. Resource IDs remain scoped to the copied simulation model. A backup merge uses a shared diagram identity map for history, captured runs and checkpoints, including nodes that are absent from the current graph. The same restored node ID appears in known binding parameters and simulator traces. The stored source and values of unsupported versions remain available for inspection.

Copying within a diagram keeps shared resource pools and reuses matching Behavior definitions. Each cloned binding has its own ID. Copying into another diagram gives transferred definitions independent IDs and maps known node and resource parameters through the same maps as the copied objects. A typed reference to an object outside the transfer is cleared and its cloned binding is disabled. A paste, its copied bindings and its simulation data are one undoable edit. [Storage tests](../frontend/tests/behavior-storage.test.ts) · [Clipboard tests](../frontend/tests/behavior-clipboard.test.ts) · [Archive identity test](../frontend/tests/behavior-history-identity.test.ts)

## Compatibility proof

The saved rename and checkout recipes serve as fixtures. Check their parsed declarations and contexts, action payloads and source positions, deterministic diagnostics, and the following outcomes.

- A valid manual edge renames its target to the bound text. Independent bindings use their own values. Undo and redo restore the edge and name together.
- At 15 waiting items there is no send. A change from 15 to 16 sends once. A change from 16 to 17 produces no additional send. In the fixed checkout fixture, two staff and an enabled Behavior allow two completions within the 75-second run. The busy or disabled variants complete one. Play, MAX and replay give the same ordered Behavior trace for identical captured input.

The version 2 conformance suite checks ordered rename and status proposals in the same editor test-host commit. Its simulation recipe replays two delayed requests reaching one shared staffing resource at the same due time. The first opens its reserve and the second records busy staff. Both retain their own request count. Run it alongside the focused tests and the staging compatibility fixtures from the repository root. [Conformance suite](../frontend/tests/behavior-language-conformance.test.ts) · [Staging compatibility fixtures](../frontend/tests/behavior-language-compatibility.test.ts) · [Version-boundary tests](../frontend/tests/behavior-version-boundaries.test.tsx)

```sh
cd frontend
npm test -- tests/behavior-language-compatibility.test.ts tests/behavior-version-boundaries.test.tsx \
  tests/behavior-language.test.ts tests/behavior-editor.test.ts tests/simulation-behaviors.test.ts
npm test -- tests/behavior-language-conformance.test.ts tests/behavior-language-v2.test.ts \
  tests/behavior-language-state.test.ts tests/behavior-language-delay.test.ts
```

The production language reference follows conformance. [CAR-185](https://linear.app/caripson/issue/CAR-185/visual-nerve-script-versionssatt-language-reference)

## Extension seam

The registry identifies each action by stable name and describes its syntax, supported events and typed arguments in a language version. Host adapters enforce target eligibility. Future product actions should declare which target kinds they accept, required permissions and scope, how they are undone or cancelled, trace metadata and applicable budgets. Use that schema for validation, editor assistance and documentation. Parameter labels, descriptions and editor ranges can be offered as library metadata. Define their validation effect before using them as language constraints. Trusted adapters send proposals to the existing model commands or job system. The interpreter has no arbitrary host calls, filesystem, network, wall clock or random source. Any future stochastic host data must come from the captured seeded simulation.

Keep budgets deterministic and charge the work before effects are applied. Preserve version 1 behavior when adding a later contract. Node, drawing, diagram settings and video can use the registry seam in later product work. Asynchronous media jobs need their existing permissions, cancellation and separate lifetime. [Complete-language conformance](https://linear.app/caripson/issue/CAR-184/sprak-6-verifiera-komplett-sprak-och-las-forsta-produktionskontraktet) · [Scripted diagrams and video](https://linear.app/caripson/issue/CAR-198/visual-nerve-script-skriptstyrda-diagram-och-video)
