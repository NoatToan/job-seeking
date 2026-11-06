import pytest

from job_crawler.salary import Salary, parse_salary


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("$120,000 - $150,000 per year", (120_000, 150_000, "USD", "year")),
        ("Salary: $120k – $150k a year", (120_000, 150_000, "USD", "year")),
        ("100K—130K USD", (100_000, 130_000, "USD", "year")),
        ("USD 100,000 - 150,000 / annual", (100_000, 150_000, "USD", "year")),
        ("USD 120k", (120_000, 120_000, "USD", "year")),
        ("120k USD", (120_000, 120_000, "USD", "year")),
        ("€60/hour", (60, 60, "EUR", "hour")),
        ("Compensation: 60.000 EUR gross per year", (60_000, 60_000, "EUR", "year")),
        ("£45,000 - £55,000 per annum", (45_000, 55_000, "GBP", "year")),
        ("£50k pa + bonus", (50_000, 50_000, "GBP", "year")),
        ("€65k p.a. plus equity", (65_000, 65_000, "EUR", "year")),
        ("AU$120k-140k", (120_000, 140_000, "AUD", "year")),
        ("A$ 100,000 + super", (100_000, 100_000, "AUD", "year")),
        ("C$90k to C$110k", (90_000, 110_000, "CAD", "year")),
        ("CA$95,000", (95_000, 95_000, "CAD", "year")),
        ("S$6,000/month", (6_000, 6_000, "SGD", "month")),
        ("NZ$80,000 - 95,000", (80_000, 95_000, "NZD", "year")),
        ("R$ 8.000 - 12.000", (8_000, 12_000, "BRL", "month")),
        ("AUD $130k", (130_000, 130_000, "AUD", "year")),
        ("$130k AUD + super", (130_000, 130_000, "AUD", "year")),
        ("$45.50/hr", (45.5, 45.5, "USD", "hour")),
        ("$50/h", (50, 50, "USD", "hour")),
        ("Hourly rate: $60", (60, 60, "USD", "hour")),
        ("We pay $35 - $55 per hour", (35, 55, "USD", "hour")),
        ("$500/day outside IR35", (500, 500, "USD", "day")),
        ("£400 per day", (400, 400, "GBP", "day")),
        ("$2,000 weekly", (2_000, 2_000, "USD", "week")),
        ("€4,500 monthly", (4_500, 4_500, "EUR", "month")),
        ("Annual salary: 85,000 GBP", (85_000, 85_000, "GBP", "year")),
        ("up to $150k", (None, 150_000, "USD", "year")),
        ("Salary up to USD 6,000/month", (None, 6_000, "USD", "month")),
        ("from $100k", (100_000, None, "USD", "year")),
        ("$100k+ base", (100_000, None, "USD", "year")),
        ("between $80k and $100k", (80_000, 100_000, "USD", "year")),
        ("150,000-120,000 USD", (120_000, 150_000, "USD", "year")),
        ("$1.2M total package", (1_200_000, 1_200_000, "USD", "year")),
        ("120k - 150k", (120_000, 150_000, None, "year")),
        ("45/hr", (45, 45, None, "hour")),
        ("Lương 20-30 triệu", (20_000_000, 30_000_000, "VND", "month")),
        ("15tr - 20tr", (15_000_000, 20_000_000, "VND", "month")),
        (
            "Lương: 15.000.000 - 25.000.000 VND/tháng",
            (15_000_000, 25_000_000, "VND", "month"),
        ),
        ("1 200 000 000 VND", (1_200_000_000, 1_200_000_000, "VND", "year")),
        ("30,000,000₫", (30_000_000, 30_000_000, "VND", "month")),
        ("₹12,00,000 per annum", (1_200_000, 1_200_000, "INR", "year")),
        ("15 LPA", (1_500_000, 1_500_000, "INR", "year")),
        ("INR 50,000 per month", (50_000, 50_000, "INR", "month")),
        ("¥5,000,000", (5_000_000, 5_000_000, "JPY", "year")),
        ("JPY 300,000/month", (300_000, 300_000, "JPY", "month")),
        ("CHF 120'000", (120_000, 120_000, "CHF", "year")),
        ("PLN 15 000 - 20 000 brutto", (15_000, 20_000, "PLN", "month")),
        ("€ 60 000", (60_000, 60_000, "EUR", "year")),
        ("$140,000", (140_000, 140_000, "USD", "year")),
        ("We raised $50M. Salary: $150k", (150_000, 150_000, "USD", "year")),
        ("Founded in 2015, we pay $130k-$160k", (130_000, 160_000, "USD", "year")),
        ("Senior Engineer (Remote) - $160-200K", (160_000, 200_000, "USD", "year")),
        ("401k matching, salary $110,000", (110_000, 110_000, "USD", "year")),
    ],
)
def test_parse_salary(text, expected):
    salary = parse_salary(text)
    assert salary is not None, text
    assert (salary.min, salary.max, salary.currency, salary.period) == expected


@pytest.mark.parametrize(
    "text",
    [
        None,
        "",
        "Competitive salary and great benefits",
        "Founded in 2024",
        "We raised $50M in our Series B",
        "$50M Series B led by top investors",
        "ARR of $10M and growing",
        "Valuation of $1B",
        "Our app has 10M users",
        "Trusted by 10k customers",
        "401k matching",
        "Generous 401(k)",
        "Up to 20% bonus",
        "Equity: 0.5% - 1%",
        "Call +1 555 123 4567",
        "Python 3.12 and Django 5",
        "Release v2.3.1",
        "5+ years of experience",
        "40 hours per week",
        "20 days of PTO",
        "PHP 8 developer",
        "Team of 25 engineers",
        "Earn $5 per referral",
        "2023 - 2025 roadmap",
        "Budget 2025",
        "$3/year",
        "$10M per year",
    ],
)
def test_false_positives(text):
    assert parse_salary(text) is None


@pytest.mark.parametrize(
    ("salary", "display"),
    [
        (Salary(120_000, 150_000, "USD", "year"), "USD 120,000 - 150,000 / year"),
        (Salary(60, 60, "EUR", "hour"), "EUR 60 / hour"),
        (Salary(30_000_000, 45_000_000, "VND", "month"), "VND 30,000,000 - 45,000,000 / month"),
        (Salary(45.5, 45.5, "USD", "hour"), "USD 45.50 / hour"),
        (Salary(100_000, None, "USD", "year"), "USD 100,000+ / year"),
        (Salary(None, 150_000, "USD", "year"), "Up to USD 150,000 / year"),
        (Salary(120_000, 150_000, None, "year"), "120,000 - 150,000 / year"),
        (Salary(5_000, 5_000, "GBP", None), "GBP 5,000"),
    ],
)
def test_display(salary, display):
    assert salary.display() == display


def test_display_round_trip():
    assert parse_salary("20-30 triệu").display() == "VND 20,000,000 - 30,000,000 / month"
    assert parse_salary("EUR 60/hour").display() == "EUR 60 / hour"


@pytest.mark.parametrize(
    ("salary", "yearly"),
    [
        (Salary(50, 60, "USD", "hour"), (104_000, 124_800)),
        (Salary(400, 500, "GBP", "day"), (104_000, 130_000)),
        (Salary(2_000, 2_000, "USD", "week"), (104_000, 104_000)),
        (Salary(5_000, None, "EUR", "month"), (60_000, None)),
        (Salary(None, 150_000, "USD", "year"), (None, 150_000)),
        (Salary(None, None, None, None), (None, None)),
    ],
)
def test_yearly(salary, yearly):
    assert salary.yearly() == yearly
