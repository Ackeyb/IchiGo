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

If an unrelated pre-existing failure exists, identify