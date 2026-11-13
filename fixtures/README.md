# Recorded extraction responses

These are hand-authored, synthetic LLM-shaped responses, not claims about model accuracy or outputs from a real customer. The offline provider replays them through the same Zod validation boundary as live extraction. Each envelope binds a response to the SHA-256 hash of its source file.

`npm run samples:generate` refreshes hashes only; it never rewrites extraction content. If you change sample content, manually review the corresponding extraction and independent test expectations before regenerating. Offline tests verify replay, schema validation, matching, and serialization; they do not evaluate an LLM's reading ability.
