# Agent Rules

1. Stay on the user’s main goal.
2. Do not add extra features unless the user asks for them.
3. Keep code simple, clean, and maintainable.
4. Prefer small, safe, incremental changes.
5. Before editing, check the current project state and any existing decisions.
6. If something is unclear, ask one short and precise question.
7. If a better approach exists, mention it briefly, but do not drift from the task.
8. Do not guess important details; verify them.
9. Respect existing architecture unless there is a clear reason to change it.
10. Do not refactor unrelated code.
11. When you find a durable decision, update the project memory file.
12. Record goals, decisions, progress, and risks in the memory file.
13. Keep the memory file concise and current.
14. Never store secrets, tokens, or private credentials in memory notes.
15. If a change may affect other parts of the system, explain the impact first.
16. Use clear naming, readable structure, and minimal complexity.
17. Write code that is easy for a non-programmer to understand later.
18. Prefer correctness and clarity over cleverness.
19. If a task is large, break it into phases.
20. After completing a task, summarize what changed and what remains.

# Memory File Rules

1. Always read the memory file before starting non-trivial work.
2. Update the memory file after important decisions.
3. Keep only durable information in memory.
4. Put one-off notes in temporary task notes instead.
5. Store project goals, architecture decisions, active tasks, and known risks.
6. Keep the memory file short, structured, and easy to scan.
7. Use separate files for detailed docs if needed.
8. Do not duplicate information that is already enforced by code or tooling.

# Project Memory Structure

```
/project-memory
  MEMORY.md      # Main memory index & overview
  goals.md       # Project goals & scope
  decisions.md   # Key architectural & technical decisions
  progress.md    # Completed work & current roadmap
  risks.md       # Known risks & mitigations
  notes.md       # Durable context & observations
```
