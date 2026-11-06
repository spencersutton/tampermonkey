---
name: scoped-symbol-edit
description: "Use for incremental, scoped refactoring of a specified symbol or code region, without inspecting or changing other project code, even if the change may break callers."
---

# Scoped symbol edit

Invoking this skill means the user wants an isolated edit and accepts that dependent code may need follow-up work. The user only needs to identify the target and requested change; do not require them to repeat the scope restrictions or acceptance of temporary breakage.

1. Treat the specified symbol or region as the edit boundary, along with any additional files the user explicitly authorizes. If the target or requested behavior is unclear, ask before proceeding.
2. Read only the smallest portion needed to understand and modify the target. Do not search for callers, related implementations, configuration, or other project files unless the user authorizes it.
3. Implement the requested change within the agreed boundary. Do not widen the edit to repair callers, update dependencies, or make unrelated improvements. Follow higher-priority instructions and stop to ask if they require work outside the boundary.
4. Validate only within the authorized scope, without inspecting other project code or running checks that would do so. Do not add tests unless requested and permitted. If meaningful validation requires crossing the boundary, explain the limitation or ask for permission.
5. Summarize the change and explicitly note any unverified compatibility or potential downstream breakage; do not claim that dependent behavior was verified.
