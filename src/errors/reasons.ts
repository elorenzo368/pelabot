/**
 * Home for every typed reason union the design introduces (design-part6 §D,
 * D-9). Rule 5 puts every user-facing string in `discord/ui/messages.es.ts`
 * alone; the corresponding typed reasons — `RejectionReason`,
 * `FailureReason`, `ImportFailureReason`, `SuspensionReason`, and any
 * others later phases add — belong here instead, so the domain never
 * returns a bare string where a closed union is checkable.
 *
 * Empty at Phase 0 by design: each union is introduced by the phase that
 * first needs it (Phase 3 for rejections and failures, Phase 4 for import
 * failures, Phase 7 for suspension reasons), not invented ahead of the
 * behavior it classifies.
 */
export {};
