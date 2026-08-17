---
"@trevorrecker/skctl": minor
---

refactor(types): name the structured payloads and drop needless assertions

- `applyData` and `statusData` return named `ApplyData` and `StatusData` contracts instead of `Record<string, unknown>`; the `-o json` shape is unchanged
- action lookup tables validate with `satisfies` rather than a widening annotation
- `initRoot` and `parseBody` return named types
- removed four type assertions that were never needed: `parseOutput` reads the union member straight from `find`, and `parseHostList` narrows through an `isHost` predicate
- replaced the exported `DetachResult` with a shared `ManifestChange`, also used by `removeRemote`
