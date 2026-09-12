# CLAUDE.md

Read `AGENTS.md` first and follow it literally. Summary of what matters most:

1. **Hackathon clock.** Optimize for the live demo working, not for clean code. No refactors, no reviews, no purism, no scope creep.
2. **Decide, don't ask.** Pick the boring option and keep going. Ask only for credentials/accounts or irreversible choices.
3. **Contract is frozen.** `CONTRACT.md` ↔ `packages/contract/src/index.ts`. Build channels against `npm run mock`.
4. **Backend is the only truth.** The LLM never states task state, counts or progress that did not come from a backend response.
5. **Quality gate = `npm run verify`.** Nothing else.

Context docs: `docs/handoff.md` (product + priorities P0→P4), `docs/submission-kit.md` (demo script, naming), `docs/starter-kit/` (official rules and rubric).
