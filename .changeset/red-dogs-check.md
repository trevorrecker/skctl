---
"@trevorrecker/skctl": patch
---

chore(release): publish from ci with npm provenance

- github actions builds, tests and pack-checks every push and pull request on node 18, 20, 22 and 24
- merging a changeset opens a release pull request; merging that publishes to npm and cuts the github release
- the published package no longer ships compiled test files
