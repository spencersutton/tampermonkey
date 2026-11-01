# Project workflow

After implementing a task that changes repository files, commit and push the task's changes before testing by default. This is a single-user application; the Git remote is used for distribution. Include only changes belonging to the task; leave unrelated work untouched. Do not commit or push when the user asks otherwise or when no files were changed.

Write and run only high-value tests covering meaningful failure modes or behavior changes. Avoid trivial helper/UI-shape tests, redundant coverage, repeated checks, and broad suites when a focused regression test or build suffices. If testing reveals a problem, fix it and publish a follow-up commit; prefer that over rewriting history unless the user requests a rewrite.
