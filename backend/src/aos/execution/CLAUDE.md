# AOS Execution Boundary

- This module supports `SHADOW` and `PAPER` only. Do not add a live broker adapter here before the documented Shadow acceptance gate and explicit production approval.
- Preserve the precedence `Kill Switch > Hard Risk > Portfolio > Exit > Entry > AI feature`.
- An order requires a version-pinned `SignalDecision`, `RiskDecision`, and unexpired `OrderPlan`.
- Long-term accounts must never fund or auto-replenish the system-trading bucket.
- Proposal, risk, fill, reconciliation run, intervention, and kill-switch event records are append-only. Corrections require a new evidence-bearing record.
- AI modules may supply structured features only and must not import this module or create orders.
- Keep `AOS_CANONICAL_PAPER_LEDGER_ENABLED` default-off until parity and reconciliation evidence is accepted.
