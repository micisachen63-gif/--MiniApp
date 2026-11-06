# Exchange actions integration - 2026-11-06

Local-only integration batch on branch `codex/exchange-actions-integration-20261106`.

## Baseline and scope

- Accepted predecessor: `049d3f6e7762a39d412a72bad50415845645f31e`.
- The predecessor already includes F2, `ui-generated-20261030/hud-v2`, viewport fixes, Ledger/wardrobe integration, and exchange read-only browsing.
- This batch adds scoped traveler-exchange sellable candidates plus create/list, buy, cancel/withdraw, receipt lookup, explicit same-ID recovery, and UI/session wiring.
- No production deployment, production DB, secret, migration, character/FX/grok asset, push, PR, or merge is part of this batch.

## Safety and transaction semantics

- New scoped endpoints are `exchange/sellable-scene`, `exchange/receipt`, and `exchange/action-scoped`.
- Pending intents persist the original UUID, economic payload, account/realm/character scope, epoch, and signature.
- Lost responses are resolved with a pure receipt read. A missing receipt remains pending; a second POST is only allowed after explicit recovery confirmation and must reuse the same UUID/body.
- Same-scope cross-window reservation uses native Web Locks and fails closed if the capability is unavailable.
- Definitive business rejection can clear only the matching fresh first attempt. Unknown, generic, recovery, or mismatched outcomes retain the pending intent.
- Original market escrow, fee, revision, listing limit, protected-asset, and ownership rules remain authoritative.

## Focused verification

The current source passed a fresh focused run of the four exchange-action suites: 114/114.

Earlier staged focused evidence recorded:
- backend: 111/111
- UI/session/lifecycle: 220/220
- renderer focused: 116/116
- native Request wire: 9/9
- fixture: 6/6

## Browser acceptance

The one economic browser campaign is preserved at:
`.release-sync/exchange-actions-20261106/qa/runs/acceptance01/`.

It committed exactly nine intended economic operations. All 13 operation/UI checks executed before the tail failure passed. The original run failed only after those operations, while switching from the alternate character back to the main character: the QA harness asserted the character button count before the asynchronously rendered character list appeared.

The nine operations were not replayed.

A read-only tail continuation is preserved at:
`.release-sync/exchange-actions-20261106/qa/runs/acceptance01-tail04/`.

Tail acceptance passed:
- restored/resumed the original main character safely;
- Ledger, wardrobe and five-slot HUD regressions passed;
- no `exchange/action-scoped` request was sent by the tail;
- `blockedWrites`, external requests, page errors, HTTP errors, route errors and request failures are empty;
- browser closed normally and source pin remained stable;
- both permanent and season DB hashes, table counts, total changes, listing counts, operation counts and ledger counts were identical before/after the pure tail interval.

The original campaign provides real browser asset evidence for the exchange client/UI/session; the tail provides real browser asset evidence for Ledger, star-ring wardrobe, session and HUD dependencies.

## Checkpoint and ownership

- Dedicated owner: `exchange-actions-root-5e4abc46a818-20261106`.
- Dedicated worktree: `D:/StarJournal/worktree-snapshots/star-journal-exchange-actions-integration-20261106`.
- `StarJournal-ExchangeActions-Checkpoint-30m` remains enabled; the 15:04:39 Asia/Taipei checkpoint was observed on disk.
- F3 and all character/FX workstreams remain independent and untouched.

## Remaining finalization

After the reviewed whitelist commit, run the official complete Worker and BOT gates exactly once on that exact clean HEAD, with no skips. Record actual test totals and final source hashes in the external handoff/final status. Do not deploy.
