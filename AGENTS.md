# AGENTS.md

## 1. Purpose

This repository contains the **7 Dice Game** web application.

This file defines the development rules and working conventions for AI coding agents, including Codex.

The authoritative game specification is:

```text
docs/SPEC.md
```

Before making any implementation decision, read this file and `docs/SPEC.md`.

---

## 2. Source of Truth

`docs/SPEC.md` is the **single source of truth for game behavior**.

If any of the following conflict with `docs/SPEC.md`:

- existing implementation
- comments
- tests
- README
- previous commits
- assumptions
- common game conventions
- library behavior
- agent-generated design decisions

then `docs/SPEC.md` takes precedence.

Do not silently reinterpret the specification.

Do not invent missing game rules.

If a genuinely ambiguous requirement affects game behavior and cannot be resolved from the specification, stop and report the ambiguity rather than choosing a rule arbitrarily.

---

## 3. Read Before Editing

Before modifying code:

1. Read `AGENTS.md`.
2. Read the relevant sections of `docs/SPEC.md`.
3. Inspect the existing project structure.
4. Inspect relevant existing tests.
5. Check the current Git diff/status.
6. Understand the existing implementation before replacing or restructuring it.

Do not begin by blindly generating a new application if a working project already exists.

Preserve valid existing work unless there is a concrete reason to change it.

---

## 4. Implementation Priority

Use the following priority order when making implementation decisions:

```text
1. Correct game rules
2. State consistency
3. Prevention of duplicate processing
4. Testability
5. Separation of game logic and presentation
6. Clear player-facing state
7. Responsive usability
8. Animation and visual polish
```

Visual polish must never override game correctness.

---

## 5. Development Phases

Follow the implementation phases defined in `docs/SPEC.md`.

The intended order is:

```text
Phase 1 — Pure Game Engine
Phase 2 — Ranking
Phase 3 — Sudden Death
Phase 4 — Penalty
Phase 5 — UI
Phase 6 — 3D Dice
Phase 7 — Animation / Sound
Phase 8 — Session Recovery
Phase 9 — Responsive / Polish
```

Unless explicitly instructed otherwise, work only on the requested phase.

Do not implement future phases merely because they appear straightforward.

Avoid large speculative implementations.

---

## 6. Game Engine Must Be Pure

Core game rules must not depend on:

- React components
- DOM state
- CSS
- animation timing
- audio
- 3D rendering
- Dice renderer internals
- browser layout
- network requests

Game rules should live in pure TypeScript modules wherever practical.

Given the same state and deterministic random input, the engine should produce the same logical result.

---

## 7. Randomness Must Be Testable

Do not scatter direct `Math.random()` calls throughout the application.

Randomness must be abstracted behind a replaceable source, for example:

```ts
export interface RandomSource {
  next(): number;
}
```

Production code may use `Math.random()` behind that abstraction.

Tests must be able to provide deterministic random values.

This applies to:

- OUT checks
- normal D6 results
- penalty dice

Do not make unit tests depend on luck.

---

## 8. OUT System

The OUT system is a core game rule, not merely an animation.

The game engine determines whether a die is OUT.

The renderer only visualizes that result.

Never infer authoritative OUT state from 3D physics.

The required direction is:

```text
Game Engine
    ↓
Logical Roll Result
    ↓
3D Renderer / Animation
```

Never:

```text
3D Physics
    ↓
Game Rule Decision
```

The renderer must not silently change logical roll results.

---

## 9. Dice State

Keep these concepts distinct:

```text
activeDice
strandedDice
removedDice
```

Where:

```text
activeDice
= dice that can still be rolled

strandedDice
= OUT dice that remain in the player's remaining-dice count but can never be rolled again

removedDice
= dice successfully removed by scoring 1 or 5
```

Maintain the invariant:

```ts
activeDice +
strandedDice +
removedDice === 7;
```

Remaining dice are:

```ts
remainingDice =
  activeDice + strandedDice;
```

Do not use `strandedDice` as an additional ranking tiebreaker.

---

## 10. Do Not Duplicate Derived State Without Need

Prefer calculating derived values rather than storing multiple independently mutable copies.

For example:

```ts
function getRemainingDice(player: Player): number {
  return player.activeDice + player.strandedDice;
}
```

is preferable to maintaining an unrelated mutable `remainingDice` value.

If derived state is stored for performance or serialization reasons, ensure it cannot diverge from its source values.

---

## 11. State Transitions

Game state transitions must be explicit.

Avoid hidden transitions caused by UI side effects.

Important transitions include:

```text
ROLL_READY
→ ROLLING
→ RESULT
→ CONTINUE / TURN_END / COMPLETE
```

and round-level transitions:

```text
ROUND_COMPLETE
→ RANKING
→ SUDDEN_DEATH / LOSER_REVEAL
→ PENALTY
→ FINISHED
```

Do not allow UI components to independently mutate game rules.

---

## 12. Prevent Duplicate Processing

ROLL processing must be atomic from the game engine's perspective.

A single player action must never cause:

- duplicate rolls
- duplicate score additions
- duplicate OUT processing
- duplicate dice removal
- duplicate completion increments
- duplicate penalty calculation
- duplicate turn advancement

Use explicit interaction/state locks where appropriate.

Do not rely solely on button visual state to guarantee correctness.

---

## 13. Transactional Roll Handling

Prefer the following conceptual sequence:

```text
1. Validate that ROLL is currently allowed
2. Lock interaction
3. Generate logical roll result
4. Resolve game rules
5. Produce the next authoritative state
6. Persist the committed state when required
7. Run visual/audio presentation
8. Unlock interaction when the next action is valid
```

Animation must not be the source of authoritative state.

---

## 14. Reload Safety

The application uses temporary session recovery.

When session persistence is implemented:

- restore only committed game state
- do not attempt to resume halfway through an animation
- do not repeat already committed score changes
- do not repeat already committed OUT results
- do not increment completion twice
- do not automatically create a second roll after reload

Treat persistence as a state transaction problem, not an animation restoration problem.

---

## 15. Ranking

Ranking logic must be implemented separately from rendering.

Do not determine ranking by reading displayed values from the UI.

Ranking functions should accept player/game state and return deterministic ranking results.

The ranking rules are defined exclusively in `docs/SPEC.md`.

---

## 16. Sudden Death

Sudden death must be handled by game logic, not UI shortcuts.

When starting sudden death:

- include all original players
- preserve original player order
- reset round-specific player state
- reset OUT state
- preserve cumulative completion count
- preserve the selected throw style / OUT probability

Do not carry previous-round ranking data into the new round as authoritative ranking state.

---

## 17. Penalty Phase

Penalty rolling is logically separate from normal gameplay rolling.

Do not reuse normal-roll behavior without explicitly disabling incompatible rules.

Penalty dice:

- do not use OUT checks
- do not score 1 or 5 specially
- are not removed
- are not rerolled

Only the final penalty calculation uses the cumulative multiplier defined in `docs/SPEC.md`.

---

## 18. UI Responsibilities

UI components should primarily:

- display state
- accept valid user input
- trigger game-engine actions
- play animations
- play sounds

UI components should not contain duplicated implementations of core game rules.

For example, avoid implementing scoring separately inside a React component when scoring already exists in the game engine.

---

## 19. 3D Dice Integration

Treat the 3D dice implementation as an adapter/renderer.

Keep library-specific code isolated from game rules.

Preferred architecture:

```text
Game Engine
     ↓
Roll Result
     ↓
Dice Adapter
     ↓
3D Dice Library
```

If the selected 3D library cannot exactly reproduce a desired animation, adapt the presentation rather than changing the game rule.

---

## 20. External Libraries

Before adding a dependency:

1. Check whether the existing stack already solves the problem.
2. Prefer small, actively maintained dependencies.
3. Avoid dependencies for trivial functionality.
4. Avoid introducing multiple libraries that solve the same problem.
5. Do not replace the existing framework/toolchain without a strong reason.

When integrating a dependency, isolate library-specific behavior where practical.

---

## 21. TypeScript

Prefer strict TypeScript.

Avoid unnecessary `any`.

Prefer:

- discriminated unions
- explicit domain types
- exhaustive switches
- pure functions
- readonly data where appropriate

Represent impossible states so they are difficult to construct.

For dice results, prefer a discriminated union such as:

```ts
type SafeDieResult = {
  status: "safe";
  value: 1 | 2 | 3 | 4 | 5 | 6;
};

type OutDieResult = {
  status: "out";
  value: null;
};

type DieResult =
  | SafeDieResult
  | OutDieResult;
```

Do not represent OUT as a magic numeric value such as `0`, `7`, or `-1`.

---

## 22. Testing Policy

Core game behavior requires automated tests.

At minimum, tests must cover the cases listed in the testing section of `docs/SPEC.md`.

Tests should emphasize:

```text
state before
+
deterministic input
→
expected state after
```

Prefer focused unit tests for the game engine.

UI tests should not replace engine tests.

---

## 23. Regression Tests

When fixing a game-logic bug:

1. reproduce the bug
2. add a test that fails because of the bug
3. fix the implementation
4. confirm the new test passes
5. run the existing test suite

Do not fix important rule bugs without regression coverage when reasonably possible.

---

## 24. Tests Before Completion

Before reporting a task as complete, run the relevant available checks.

Depending on the project scripts, this may include:

```bash
npm test
npm run test
npm run typecheck
npm run lint
npm run build
```

Use the scripts actually defined by the repository.

Do not invent commands and claim they passed.

Report any check that could not be run and why.

---

## 25. Build Integrity

Do not knowingly leave:

- TypeScript errors
- broken imports
- failing tests
- lint failures introduced by the change
- broken production builds
- placeholder implementations presented as complete

If an unrelated pre-existing failure exists, identify it separately.

---

## 26. Scope Control

Keep changes focused on the requested task.

Avoid unrelated:

- refactors
- formatting rewrites
- dependency upgrades
- renaming
- folder restructuring
- visual redesigns

unless required for the requested implementation.

A task should produce a reviewable diff.

---

## 27. Existing Code

Do not delete or rewrite working code merely because another architecture is personally preferable.

Refactor when there is a concrete benefit such as:

- correctness
- testability
- eliminating duplicated game logic
- resolving a specification conflict
- enabling the requested feature

Prefer incremental changes over unnecessary rewrites.

---

## 28. Comments

Use comments to explain:

- non-obvious rules
- invariants
- architectural constraints
- reasons for unusual implementation decisions

Do not add comments that merely restate obvious code.

Important game-rule comments should reference the relevant concept from `docs/SPEC.md` where useful.

---

## 29. User-Facing Language

The primary user-facing language is Japanese.

Code identifiers should normally remain English.

Examples:

```text
UI:
残り
ROLL可能
OUT
完走
ペナルティ

Code:
remainingDice
activeDice
strandedDice
completed
penaltyMultiplier
```

Avoid mixing Japanese identifiers into TypeScript unless there is a strong reason.

---

## 30. Responsive Design

The primary target is smartphone play.

However, desktop and tablet layouts must remain usable.

Do not implement mobile support as a separate game implementation.

Use one responsive application.

Prioritize visibility of:

- current player
- dice field
- ROLL button
- score
- remaining dice
- OUT count
- penalty multiplier

---

## 31. Accessibility

Where practical:

- buttons must have meaningful accessible labels
- disabled states must be programmatically represented
- important game information must not depend only on color
- dialogs should manage focus correctly
- keyboard interaction should remain usable on desktop
- respect reduced-motion preferences for nonessential animation

Accessibility changes must not alter game rules.

---

## 32. Sound

Sound is optional presentation state.

Game behavior must remain identical whether sound is ON or OFF.

Never use sound completion callbacks as authoritative game-state triggers if avoidable.

---

## 33. Performance

Avoid premature optimization.

However:

- do not recreate the 3D renderer unnecessarily
- clean up event listeners
- clean up animation loops
- clean up audio resources
- avoid React render loops
- avoid accumulating stale dice objects

Mobile performance is important.

---

## 34. Security

Do not commit:

- API keys
- tokens
- passwords
- credentials
- private keys
- machine-specific secrets

Use environment variables where external credentials are ever required.

This game should not require secrets for core gameplay.

---

## 35. Git Safety

Before making changes, inspect:

```bash
git status
```

Do not overwrite unrelated uncommitted user changes.

Never run destructive Git commands merely to obtain a clean working tree.

Avoid commands such as:

```bash
git reset --hard
git clean -fd
```

unless the user explicitly requests and understands the destructive action.

Do not force-push unless explicitly requested.

---

## 36. Branches

Work on the currently assigned branch unless explicitly instructed otherwise.

Do not silently switch branches.

Do not create unnecessary branches.

If the user requests a feature branch, use a descriptive name such as:

```text
feature/game-engine
feature/out-system
feature/3d-dice
fix/ranking-tie
```

---

## 37. Commits

When explicitly asked to commit, create focused commits.

Use clear commit messages.

Examples:

```text
feat: implement core dice scoring engine

feat: add OUT dice resolution

feat: implement ranking and tie handling

feat: add sudden death state reset

feat: implement penalty calculation

test: add OUT system edge cases

fix: prevent duplicate roll resolution
```

Do not claim a commit was created unless it actually exists.

---

## 38. Push Policy

Do not push automatically unless the user explicitly requests pushing or the current task explicitly authorizes it.

Before pushing:

1. confirm relevant tests/checks have run
2. inspect `git status`
3. inspect the intended commit(s)
4. confirm the target branch
5. push without force unless explicitly authorized otherwise

If authentication or network access prevents push, report that clearly.

Do not repeatedly retry authentication failures.

---

## 39. Do Not Commit Generated Noise

Do not commit unnecessary generated files.

Follow `.gitignore`.

Typical files that should normally remain untracked include:

```text
node_modules/
dist/
coverage/
.env
.env.local
OS/editor temporary files
```

Exceptions are allowed only when the repository intentionally tracks them.

---

## 40. Documentation

When implementation changes an architectural detail, update relevant technical documentation if needed.

Do not modify the game specification merely to match an implementation mistake.

`docs/SPEC.md` represents intended behavior.

Implementation must conform to the specification, not the reverse.

---

## 41. Specification Changes

If the user requests a game-rule change:

1. identify the affected specification sections
2. update `docs/SPEC.md`
3. update implementation
4. update tests
5. verify affected behavior

Do not leave specification, code, and tests contradicting each other.

---

## 42. Task Completion Report

At the end of a development task, provide a concise summary containing:

```text
Implemented:
- ...

Tests/checks:
- ...

Files changed:
- ...

Remaining issues:
- ...
```

If everything requested is complete, say so.

If something is incomplete, state exactly what remains.

Do not hide failed tests or unresolved problems.

---

## 43. Definition of Agent Success

A task is successful when:

```text
✓ requested scope is implemented
✓ behavior matches docs/SPEC.md
✓ game invariants remain valid
✓ relevant tests pass
✓ type/build checks pass where available
✓ unrelated code is not unnecessarily changed
✓ no duplicate game-rule implementations are introduced
✓ no secrets are committed
✓ Git state is understood
✓ remaining limitations are clearly reported
```

---

## 44. Final Rule

When there is tension between:

```text
"this animation would look cooler"
```

and:

```text
"this is what the game rules require"
```

the game rules win.

When there is tension between:

```text
"the library naturally behaves this way"
```

and:

```text
"docs/SPEC.md requires different behavior"
```

adapt the library.

Do not adapt the rules.

`docs/SPEC.md` is authoritative.
