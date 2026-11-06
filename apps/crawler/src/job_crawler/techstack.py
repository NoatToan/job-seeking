"""Which technologies a job asks for, from its title, tags and description.

`tech_stack(title, description, tags)` -> sorted list of tech ids ("react", "nextjs", "python",
…) or None. Ids are the same strings the web app maps to icons and filter chips
(packages/core `TECH_STACK`); keep both lists in sync. Frontend and backend first, plus the
mobile / data / cloud tools that most often decide whether a job fits.

Matching is regex with word boundaries. Short or common-English names (Go, React, Rust, Spring,
Swift, Express, Node) need a case-sensitive or tech-shaped form ("Golang", "Go,", "React.js",
"Spring Boot", "Express.js") so prose like "go to market" or "react quickly" doesn't count.
"""

import re

# id -> (category, pattern). Patterns without (?-i) / (?i) are case-insensitive.
_TECH: dict[str, tuple[str, str]] = {
    # Frontend
    "react": ("frontend", r"(?-i:\bReact(?:\.js|JS)?\b)(?!\s*Native)|\breact\.js\b|\breactjs\b"),
    "nextjs": ("frontend", r"\bnext\.?js\b"),
    "vue": ("frontend", r"\bvue(?:\.js|js)?\b"),
    "nuxt": ("frontend", r"\bnuxt(?:\.js|js)?\b"),
    "angular": ("frontend", r"\bangular(?:js)?\b"),
    "svelte": ("frontend", r"\bsvelte(?:kit)?\b"),
    "typescript": ("frontend", r"\btypescript\b"),
    "javascript": ("frontend", r"\bjavascript\b|(?-i:\bES6\b)"),
    "tailwind": ("frontend", r"\btailwind(?:\s*css)?\b"),
    "redux": ("frontend", r"\bredux\b"),
    # Mobile
    "react-native": ("mobile", r"\breact[\s-]native\b"),
    "flutter": ("mobile", r"\bflutter\b"),
    "swift": ("mobile", r"(?-i:\bSwift(?:UI)?\b)"),
    "kotlin": ("mobile", r"\bkotlin\b"),
    # Backend
    "nodejs": ("backend", r"\bnode\.?js\b|(?-i:\bNode\b)(?=\s*(?:[,/)]|and\b|or\b|backend))"),
    "nestjs": ("backend", r"\bnest\.?js\b"),
    "express": ("backend", r"\bexpress\.?js\b"),
    "python": ("backend", r"\bpython\b"),
    "django": ("backend", r"\bdjango\b"),
    "fastapi": ("backend", r"\bfastapi\b"),
    "flask": ("backend", r"(?-i:\bFlask\b)"),
    "java": ("backend", r"\bjava\b(?!\s*script)"),
    "spring": ("backend", r"(?-i:\bSpring\s*(?:Boot|Framework|MVC|Cloud)\b)"),
    "go": (
        "backend",
        r"\bgolang\b|(?-i:\bGo\b)(?=\s*(?:[,/)]|\(golang|developer|engineer|backend))"
        r"|(?<=[(/,]\s)(?-i:Go\b)|(?<=[(/,])(?-i:Go\b)",
    ),
    "rust": ("backend", r"(?-i:\bRust\b)"),
    "ruby": ("backend", r"(?-i:\bRuby\b)"),
    "rails": ("backend", r"\bruby on rails\b|(?-i:\bRails\b)"),
    "php": ("backend", r"\bphp\b"),
    "laravel": ("backend", r"\blaravel\b"),
    "dotnet": ("backend", r"(?<![\w.])\.net\b(?:\s*core)?|\basp\.net\b|\bdotnet\b"),
    "csharp": ("backend", r"(?<!\w)c#|\bc-sharp\b"),
    "elixir": ("backend", r"\belixir\b"),
    "scala": ("backend", r"\bscala\b"),
    "graphql": ("backend", r"\bgraphql\b"),
    # Data
    "postgresql": ("database", r"\bpostgres(?:ql)?\b"),
    "mysql": ("database", r"\bmysql\b"),
    "mongodb": ("database", r"\bmongo(?:db)?\b"),
    "redis": ("database", r"\bredis\b"),
    "kafka": ("database", r"\bkafka\b"),
    # Cloud / DevOps
    "aws": ("cloud", r"(?-i:\bAWS\b)|\bamazon web services\b"),
    "gcp": ("cloud", r"(?-i:\bGCP\b)|\bgoogle cloud\b"),
    "azure": ("cloud", r"(?-i:\bAzure\b)"),
    "docker": ("cloud", r"\bdocker\b"),
    "kubernetes": ("cloud", r"\bkubernetes\b|(?-i:\bK8s\b)"),
    "terraform": ("cloud", r"\bterraform\b"),
}

CATEGORIES: dict[str, str] = {tech: category for tech, (category, _) in _TECH.items()}
_PATTERNS = {tech: re.compile(pattern, re.IGNORECASE) for tech, (_, pattern) in _TECH.items()}

# Descriptions can be long HTML-stripped text; scanning the first chunk is enough and bounded.
_MAX_SCAN_CHARS = 20_000


def tech_stack(
    title: str | None, description: str | None, tags: list[str] | None = None
) -> list[str] | None:
    text = " \n ".join(
        part
        for part in [title or "", " , ".join(tags or []), (description or "")[:_MAX_SCAN_CHARS]]
        if part
    )
    if not text.strip():
        return None
    found = sorted(tech for tech, pattern in _PATTERNS.items() if pattern.search(text))
    return found or None
