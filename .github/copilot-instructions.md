# Project workflow

After implementing a task that changes repository files, commit and push the task's changes before testing by default. This is a single-user application; the Git remote is used for distribution. Include only changes belonging to the task; leave unrelated work untouched. Do not commit or push when the user asks otherwise or when no files were changed.

Do not write tests. Run existing tests only when necessary and high-value; prefer a build for simple changes. Keep implementations small and direct. Avoid UI redesigns, extra abstractions, redundant checks, and broad suites. If validation reveals a problem, fix it and publish a follow-up commit; prefer that over rewriting history unless the user requests a rewrite.
