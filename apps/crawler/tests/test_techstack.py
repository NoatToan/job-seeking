import pytest

from job_crawler.techstack import CATEGORIES, tech_stack


@pytest.mark.parametrize(
    ("title", "description", "expected"),
    [
        (
            "Senior React Developer",
            "We use React, Next.js, TypeScript and Node.js with PostgreSQL on AWS.",
            ["aws", "nextjs", "nodejs", "postgresql", "react", "typescript"],
        ),
        (
            "Backend Engineer (Go)",
            "Experience with Kubernetes, Docker",
            ["docker", "go", "kubernetes"],
        ),
        ("Golang Engineer", None, ["go"]),
        ("Mobile", "React Native and Swift, Kotlin", ["kotlin", "react-native", "swift"]),
        (".NET dev", "C#, ASP.NET Core, Azure", ["azure", "csharp", "dotnet"]),
        ("Rails dev", "Ruby on Rails, Redis", ["rails", "redis", "ruby"]),
        ("Java dev", "Java 17, Spring Boot, Kafka", ["java", "kafka", "spring"]),
        (
            "Fullstack",
            "Python / Django / FastAPI, Vue.js, MongoDB",
            ["django", "fastapi", "mongodb", "python", "vue"],
        ),
        ("Frontend", "JavaScript and Tailwind CSS", ["javascript", "tailwind"]),
    ],
)
def test_tech_stack(title, description, expected):
    assert tech_stack(title, description) == expected


@pytest.mark.parametrize(
    "prose",
    [
        "Go to market fast and react quickly to feedback.",
        "Express yourself; Spring is our busiest season.",
        "Every node of the network, rust-proof coatings, a ruby anniversary.",
        "",
    ],
)
def test_prose_is_not_tech(prose):
    assert tech_stack("Marketing Manager", prose) is None


def test_tags_count_too():
    assert tech_stack("Engineer", None, ["Vue", "PHP"]) == ["php", "vue"]


def test_every_tech_has_a_category():
    assert {"frontend", "backend"} <= set(CATEGORIES.values())
