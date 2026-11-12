## Your task: implement the approved plan

The issue below contains the plan (the latest comment marked "AI plan") and the maintainers'
comments after it. The maintainers' answers and corrections override the plan.

1. Implement the plan completely, following the repository's conventions, with tests.
2. Run the checks for what you touched (web: `pnpm --filter web typecheck`, `pnpm --filter web lint`,
   `pnpm --filter web test`; API: in `apps/api`, `uv run ruff check .`, `uv run ruff format --check .`,
   `uv run pytest -q`) and fix what fails.
3. If the plan turns out to be wrong or too big, implement the first step that is safe on its own
   and say what remains.

Your final message becomes the pull request description. Markdown, no headings above `###`: what
changed, how it was tested, what remains (as a checklist) and anything a reviewer should check by
hand.
