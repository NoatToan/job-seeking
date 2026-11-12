## Your task: fix the bug

1. Find the cause in the code, not only the symptom.
2. Fix it with the smallest correct change, and add or update a test that fails without the fix.
3. Run the checks for what you touched (web: `pnpm --filter web typecheck`, `pnpm --filter web lint`,
   `pnpm --filter web test`; API: in `apps/api`, `uv run ruff check .`, `uv run ruff format --check .`,
   `uv run pytest -q`) and fix what fails.
4. If you cannot find or fix the bug with confidence, change nothing and say why.

Your final message becomes the pull request description (or the issue comment when you changed
nothing). Markdown, no headings above `###`: the cause, the fix, how it was tested, and anything a
reviewer should check by hand.
