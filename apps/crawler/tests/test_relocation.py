"""Relocation signals (job_crawler.relocation). Sentences are taken from live postings."""

import pytest

from job_crawler.relocation import job_relocation, sentence_signals, sentences

Y, N = True, False


@pytest.mark.parametrize(
    "text",
    [
        "Relocation assistance provided: yes",
        "Relocation support is offered for eligible candidates.",
        "Relocation assistance may be available based on business needs and/or eligibility.",
        "- relocation package (flight ticket, taxi from airport, hotel upon arrival 4 weeks).",
        "- $20k relocation assistance and visa sponsorship",
        "- Relocation assistance",
        "- relocation and living-out-allowance (as applicable)",
        "Benefits package, including health insurance, and a relocation program.",
        "Relocation support is available to our hubs in Armenia, Georgia, Serbia and Spain.",
        "- 🇯🇵 Japan relocation supported (visa sponsorship available for qualified candidates)",
        "We are open to support with relocation efforts.",
        "Relocation assistance: may be authorized",
        "Compensation may be in the form of sign on bonus, relocation benefits, or payments.",
        "Falls du umziehen musst, übernehmen wir deine Relocation- oder Reisekosten.",
    ],
)
def test_support_offered(text):
    assert sentence_signals(text)[0] is Y


@pytest.mark.parametrize(
    "text",
    [
        "This role is not eligible for relocation support.",
        "Relocation assistance: none",
        "Relocation assistance provided: no",
        "Relocation assistance: not authorized",
        "No relocation",
        "-No relocation is offered.",
        "We do not offer visa sponsorship or relocation assistance at this time.",
        "We are unable to sponsor employment visas or provide relocation assistance for this role.",
        "Unfortunately, we can't support relocation packages or visa sponsorship.",
        "MariaDB does not sponsor work visas or relocation.",
        "Relocation and sponsorship are not provided.",
        "Please note that relocation and commuting costs are not covered.",
        "Relocation assistance will not be provided for this role.",
        "Relocation expenses are not included.",
        "You can be based anywhere in the European Union (we don't offer any relocation support)",
    ],
)
def test_support_refused(text):
    assert sentence_signals(text)[0] is N


@pytest.mark.parametrize(
    "text",
    [
        "- Must be based in Dublin or be willing to relocate",
        "You should be based in Bangalore or willing to relocate there.",
        "Candidates who are open to relocating to India for this opportunity.",
        "However, relocation to Tampa, FL is expected once the operation is established.",
        "Singapore (currently residing, or willing to relocate).",
        "We are open to candidates relocating from other countries.",
        "Role is open to relocation.",
        "Residency in or relocation to Louisiana is preferred for all positions.",
        "Sr/Staff Infrastructure Engineer - Perm - Relocate to SF",
        "The candidate will be required to relocate, or already reside in the approved city.",
        "Travel / Relocation Requirements",
    ],
)
def test_relocation_required(text):
    assert sentence_signals(text)[1] is Y


def test_no_relocation_required():
    assert sentence_signals("No relocation required — Albuquerque candidates welcome.") == (None, N)


@pytest.mark.parametrize(
    "text",
    [
        # Mobility / moving-industry roles talk about relocation as their work, not as a benefit.
        "Oversee the full spectrum of relocation management services, incl. destination services.",
        "Provide tailored consultation to relocating employees based on their circumstances.",
        "The consultant delivers designated EVIP relocation programmes for clients.",
        "Lead security for new offices, expansions, relocations, and major workplace upgrades.",
        "Strong knowledge of transmission lines, substations and utility relocations.",
        "Moving, van-line or relocation experience is a plus.",
        "The organization is relocating to a new office.",
        "Open to expatriates who have relocated abroad and are working remotely.",
        # Visa sponsorship alone isn't relocation.
        "We will not provide visa sponsorship.",
        "Visa sponsorship is available for qualified candidates.",
    ],
)
def test_not_about_the_candidate_moving(text):
    assert sentence_signals(text) == (None, None)


def test_form_label_reads_the_value_on_the_next_line():
    text = "Work Shift:\nDay\n\nRelocation Assistance Eligible:\n\nNo\n\nTravel:\n10%"
    assert job_relocation("Analyst", text) == (N, None)
    form = "Employee Status:\nRegular\nRelocation:\nNo relocation"
    assert job_relocation("Analyst", form) == (N, None)


def test_sentences_glued_by_flattened_html_are_split():
    text = "Timeline provided at offer.Relocation benefits are available for those who qualify."
    assert sentences(text)[-1].startswith("Relocation benefits")


def test_posting_level_rules():
    # A positive sentence wins over a refusal elsewhere (support exists for some candidates).
    text = (
        "Stripe does not cover the cost of relocating to a remote location. "
        "You may be eligible for relocation assistance from Stripe, depending on the distance."
    )
    assert job_relocation("Engineer", text)[0] is Y
    # Both signals at once: must move, and the employer helps.
    both = "Must be based in Berlin or willing to relocate. Relocation package provided."
    assert job_relocation("Engineer", both) == (Y, Y)
    assert job_relocation("Engineer", "We build great software.") == (None, None)
    assert job_relocation(None, None) == (None, None)
