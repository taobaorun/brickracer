# Document Review: brickracer MVP technical solution
Report: ad-document-review/v1
Status: complete
Document / content digest: brickracer-mvp-design/1.0 / sha256:7bb26173ece5b4b864134a743d391eb9c8f329d21d8e695e1019268dcaf728a7
Delivery root: docs/deliveries/brickracer-mvp
Artifact path: docs/deliveries/brickracer-mvp/design-review.md
Target path: docs/deliveries/brickracer-mvp/design.md
Mode: non-interactive
Reviewed: 2026-08-08
Verdict: ready

## Perspectives and coverage

Reviewed requirement trace R1–R11, runtime/module ownership, data and lifecycle boundaries, rejected alternatives, browser compatibility, save and runtime recovery, mobile performance, security/asset trust, verification sufficiency, and fresh-context implementability.

## Findings

- D1 — Resolved: mobile cold-start and asset-loading behavior is explicit.
  - Severity / evidence / section: major / `Responsibility boundaries`, `Application lifecycle`, `Performance and quality policy` / the current design assigns an asset loader, shell-first code splitting, lazy audio, same-origin hashed assets, retry ownership and numeric cold-load thresholds.
  - Rationale: a static 3D app that eagerly loads React, Three.js, Rapier WASM and all audio can technically build yet fail R1 on mobile networks.
  - Proposed action: define shell-first loading, lazy game/runtime chunks, on-demand audio decode, same-origin cacheable assets, visible progress and a cold-load verification scenario.
  - Disposition: apply.
  - Authority: `ad-plan` design authority within R1 and delegated technology/performance defaults.

- D2 — Resolved: mobile orientation behavior has a usable lifecycle.
  - Severity / evidence / section: major / `Builder flow`, `Browser and device matrix` / builder/results/shop support both orientations; portrait pauses racing and preserves rotation, resume, mute/settings and exit controls.
  - Rationale: touch controls can become unusable or silently blocked even when the browser is nominally supported.
  - Proposed action: require responsive builder/results in both orientations, use landscape as the race presentation target, and provide an in-app rotation prompt with pause/exit/settings still usable in portrait.
  - Disposition: apply.
  - Authority: `ad-plan` design authority within the Product Contract's delegated layout/control boundary.

- D3 — Resolved: stale tabs cannot silently overwrite newer local progress.
  - Severity / evidence / section: major / `Persistence and recovery flow`, `Risks and verification approach` / durable transactions compare revisions, `storage` events mark stale state, and stale writes reload rather than overwrite.
  - Rationale: two tabs can both load revision N and later replace points, unlocks or a blueprint with divergent revision N+1 data, violating R9/R10 persistence expectations.
  - Proposed action: make each durable transaction compare the current stored revision, listen for `storage` changes, and reject/reload stale writers instead of overwriting newer progress.
  - Disposition: apply.
  - Authority: `ad-plan` design authority; smallest recovery addition inside R9/R10.

- D4 — Resolved: rendering and loading performance are objectively measurable.
  - Severity / evidence / section: medium / `Performance and quality policy` / the current design defines workload, warm-up, measurement window, p95 desktop/mobile frame budgets, simulation-backlog limit and cold-load budgets.
  - Rationale: the implementation plan cannot classify performance evidence or failure consequence consistently.
  - Proposed action: define a warm-up and measurement interval, one representative full-race workload, frame-time percentile thresholds, and a no-simulation-backlog condition while keeping device selection in the Plan.
  - Disposition: apply.
  - Authority: `ad-plan` design authority within delegated performance thresholds.

- D5 — Resolved: runtime completion and fatal errors use a lossless typed channel.
  - Severity / evidence / section: major / `Runtime contracts`, `Application lifecycle` / `RuntimeEvent` and `subscribeEvents` carry immutable race facts and recovery errors separately from throttled HUD snapshots.
  - Rationale: polling throttled HUD snapshots risks duplicate or missing settlement and leaves the recovery flow unimplementable at the stated boundary.
  - Proposed action: add a typed, lossless `RuntimeEvent` subscription for race completion and fatal errors while keeping high-frequency telemetry in throttled snapshots.
  - Disposition: apply.
  - Authority: `ad-plan` design authority; interface completion required by R6/R9 and the stated recovery invariant.

## Applied edit batch

The design owner applied D1–D5 as one semantic edit batch, recomputed the digest, and this report reviews the resulting current digest. A final trace found R1–R11 covered, responsibility and lifecycle boundaries implementable, recovery paths coherent, and no remaining blocking technical decision. No further semantic edit is proposed by this pass.

## Deferred decisions and residuals

None. Physical-device performance and target-child usability remain planned acceptance evidence, not document defects or design decisions.
