"""Relocation signals in a job posting, for the relocation filter and the job badges.

`job_relocation(title, description)` returns `(support, required)`:

- `support`  True  = the employer helps you move (relocation package / assistance / budget…),
             False = the posting says it doesn't ("not eligible for relocation", "relocation
                     assistance: no", "we do not offer visa sponsorship or relocation"),
             None  = not mentioned;
- `required` True  = you must live there or move there ("based in Dublin or willing to
                     relocate", "relocation to Tampa is expected"),
             False = the posting says you won't have to ("no relocation required"),
             None  = not mentioned.

Pure regex, no LLM. The text is cut into sentences and bullet lines first; each sentence is read
on its own so a negation ("not eligible for relocation support") never leaks into, or is
cancelled by, a neighbouring sentence. In a sentence, a negative rule wins over a positive one.
Over the whole posting a positive support sentence wins (support exists for someone, e.g. "Stripe
doesn't cover relocating to a remote location" + "you may be eligible for relocation
assistance"); for `required`, any requirement wins over "no relocation required" elsewhere.

Only phrases about the candidate count: a bare "relocation" is ignored, so mobility/HR roles
("deliver relocation programmes", "relocating employees", "office relocations") stay None. Visa
sponsorship alone is not relocation support (a US H-1B transfer isn't a move); it only counts
when the same sentence talks about relocation. Rules were tuned on ~1,350 live postings.
"""

import re

# Nouns that make "relocation <noun>" a benefit, not a topic.
_AID = (
    r"(?:assistance|assist|support|supported|package|packages|benefits?|bonus|allowance|stipend|"
    r"program(?:me)?|budget|reimbursement|expenses?|costs?|help|aid|grant|lump[- ]sum|funding|"
    r"payment|coverage|services|provided|offered|available|options?)"
)
_RELOC = r"(?:relocation|relocating|relocate|re-location|umzug\w*)"
_NOT = (
    r"(?:not|n't|no|never|unable|cannot|can ?not|without|neither|nor|none|isn't|aren't|won't|"
    r"don't|doesn't|didn't|unfortunately)"
)

# --- support -------------------------------------------------------------------------------

_SUPPORT_NO = [
    # "not eligible for relocation (assistance)", "no relocation (support|package|is offered)"
    rf"\bnot\s+(?:be\s+)?eligible\s+for\s+(?:any\s+)?{_RELOC}",
    rf"\bno\s+{_RELOC}\b(?!\s+(?:is\s+)?(?:required|needed|necessary|expected))",
    # "relocation (assistance) is not available / will not be provided / not covered"
    rf"\b{_RELOC}(?:\s+{_AID}){{0,2}}(?:\s+\w+){{0,3}}\s+(?:is|are|will|can|would|may)\s+"
    r"(?:not|n't|unfortunately not)\b",
    rf"\b{_RELOC}(?:\s+{_AID}){{0,2}}\s+(?:isn't|aren't|won't|cannot|can't|not)\b"
    r"(?!\s+(?:required|needed|necessary|expected))",
    # "relocation assistance: no / none / not authorized / not available"
    rf"\b{_RELOC}(?:\s+{_AID}){{0,2}}(?:\s+(?:provided|eligible|statement))?\s*[:\-–—]\s*"
    r"(?:no\b|none\b|n/a\b|not\b)",
    # "we do not (offer|provide|support|cover|sponsor) … relocation", "unable to … relocation"
    rf"\b{_NOT}\b[^.;:\n]{{0,25}}\b(?:offer|offering|provide|providing|support|supporting|cover|"
    rf"covering|sponsor|sponsoring|pay|paying|fund|assist|help|reimburse|include)\w*\b"
    rf"[^.;:\n]{{0,60}}\b{_RELOC}",
    # "relocation and sponsorship are not provided", "relocation and commuting costs are not
    # covered"
    rf"\b{_RELOC}\b[^.;:\n]{{0,50}}\b(?:is|are)\s+not\s+(?:provided|offered|covered|included|"
    r"available|supported|reimbursed|paid)",
    # "(we) can't support relocation", "doesn't cover the cost of relocating"
    r"\b(?:can't|cannot|won't|don't|doesn't|do not|does not|will not|are not able to|"
    rf"is not able to)\b[^.;:\n]{{0,40}}\b{_RELOC}",
    # German: "keine Umzugskosten / Relocation"
    r"\bkeine\s+(?:relocation|umzug\w*)",
]

_SUPPORT_YES = [
    # "relocation assistance / package / support is available | provided | offered | eligible"
    rf"\b{_RELOC}(?:\s+{_AID}){{1,2}}\b(?:\s+\w+){{0,4}}?\s+(?:is|are|will be|may be|can be|"
    r"could be)\s+(?:available|provided|offered|included|supported|covered|considered|"
    r"authori[sz]ed|possible|granted)",
    # "relocation support available", "relocation provided", "relocation supported"
    rf"\b{_RELOC}(?:\s+{_AID}){{0,2}}\s+(?:available|provided|offered|included|supported|covered)\b",
    # "relocation assistance provided: yes", "relocation assistance: provided | may be authorized"
    rf"\b{_RELOC}(?:\s+{_AID}){{0,2}}(?:\s+(?:provided|eligible))?\s*[:\-–—]\s*(?:yes\b|provided|"
    r"available|offered|included|eligible|may be|possible|supported|for eligible)",
    # "we offer / provide / cover / include … relocation", "eligible for relocation assistance"
    rf"\b(?:offer|offers|offering|offered|provide|provides|providing|cover|covers|covering|"
    rf"include|includes|including|incl\.?|plus|reimburse|reimburses|pay for|pays for|fund|funds|"
    rf"assist|assists|assisting|help|helps|support|supports|supporting|sponsor|sponsors|"
    rf"eligible for|qualify for|receive|get|enjoy|benefit from|entitled to)\b"
    rf"[^.;:\n]{{0,80}}\b{_RELOC}(?:\s+{_AID})?\b",
    # benefit bullets: "- relocation package (flight ticket, …)", "- $20k relocation assistance"
    rf"^\s*(?:[-•*·▪●]|\d+[.)])?\s*(?:[$€£]\s?[\d.,]+k?\s+|\w+\s+)?{_RELOC}"
    rf"(?:(?:\s+(?:and|&|/)\s+[\w-]+)?(?:\s+{_AID})+\b|\s+(?:and|&|/)\s+[\w-]*(?:allowance|stipend|"
    r"bonus|package|support|assistance)\b)",
    # "sign on bonus, relocation benefits, …": a benefit noun only a candidate receives
    rf"\b{_RELOC}\s+(?:packages?|bonus(?:es)?|allowances?|stipends?|benefits?|reimbursements?|"
    r"lump[- ]sums?|grants?)\b",
    # "open to support with relocation", "we can assist with your relocation"
    rf"\b(?:support|assist|help)\w*\s+(?:you\s+)?(?:with|in|on)\s+(?:your\s+|the\s+)?{_RELOC}",
    # "relocation (package|support) for candidates moving from …", "relocation support to our hubs"
    rf"\b{_RELOC}(?:\s+{_AID})+\s+(?:for|to)\s+(?:eligible|qualified|candidates|people|our|the|"
    r"international|those|anyone|employees|new hires)",
    # "make your relocation as smooth as …", "relocation program"
    rf"\b(?:smooth|seamless|easy)\b[^.;:\n]{{0,30}}\b{_RELOC}|\b{_RELOC}\b[^.;:\n]{{0,30}}\bsmooth",
    # "japan relocation supported", "visa and relocation support"
    rf"\b(?:visa|immigration)\s+(?:and|&|/)\s+{_RELOC}(?:\s+{_AID})",
    rf"\b{_RELOC}\s+(?:and|&|/)\s+(?:visa|immigration)\s+{_AID}",
    # German: "übernehmen wir … Relocation- oder Reisekosten", "Umzugskostenzuschuss"
    r"\b(?:übernehm\w*|erstatt\w*|unterstütz\w*|zuschuss)\b[^.;\n]{0,80}\b(?:relocation|umzug\w*)",
    r"\b(?:relocation|umzug\w*)[^.;\n]{0,60}\b(?:übernehm\w*|erstatt\w*|unterstütz\w*|zuschuss)",
    r"\bumzugs(?:kosten|pauschale|hilfe|unterstützung)\w*",
]

# --- required -------------------------------------------------------------------------------

_REQUIRED_NO = [
    rf"\bno\s+(?:need\s+(?:for|to)\s+)?{_RELOC}\s+(?:is\s+)?(?:required|needed|necessary|expected)",
    rf"\b{_RELOC}\s+(?:is\s+)?not\s+(?:required|needed|necessary|expected|mandatory)",
    rf"\b(?:no|without|don't|do not|won't|will not)\s+(?:need|have)\s+to\s+{_RELOC}",
    rf"\bwithout\s+(?:the\s+need\s+(?:for|to)\s+)?(?:any\s+)?{_RELOC}\b",
]

_REQUIRED_YES = [
    # "willing / open / able / prepared to relocate", "open to relocating to India"
    r"\b(?:willing|willingness|open|able|prepared|ready|available|happy|want|wants|keen|eager|"
    r"plan(?:ning)?|motivated|motivation)\s+(?:and\s+\w+\s+)?to\s+(?:be\s+)?"
    r"(?:relocate|relocating|relocation|move)\b(?:\s+to\b|\s+(?:for|within|in)\b|"
    r"(?=[^.;\n]{0,40}\b(?:relocat|based|located|resid|live|onsite|on-site|office|city)))",
    r"\b(?:willing|willingness|open|able|prepared|ready|available|motivation|motivated)\s+"
    r"(?:and\s+\w+\s+)?to\s+(?:relocate|relocating)\b",
    # "must / will need to / required to / expected to (be willing to) relocate"
    r"\b(?:must|will need to|would need to|need to|needs to|have to|has to|required to|"
    r"expected to|asked to|requirement to|obligated to|should)\s+"
    r"(?:be\s+(?:willing|able|open)\s+to\s+)?(?:relocate|relocation)\b",
    # "relocation (to X) is required / expected / mandatory", "relocation requirements"
    rf"\b{_RELOC}\b(?:\s+to\s+[^.;:\n]{{1,40}}?)?\s+(?:is|will be|would be)\s+(?:required|"
    r"expected|mandatory|necessary|a must|needed|preferred|acceptable|accepted|welcome)",
    rf"\b{_RELOC}\s+within\s+[^.;:\n]{{1,30}}\s+(?:is|are)\s+(?:acceptable|accepted|required|expected)",
    rf"\b{_RELOC}\s+(?:required|requirement|requirements|mandatory|expected|is a must)\b",
    # "(currently residing, or) willing to relocate" covered above; "requires relocation"
    rf"\brequir\w*\s+(?:a\s+|the\s+|candidates?\s+to\s+)?{_RELOC}\b",
    # "we're open to (people|candidates) relocating (from …)", "consider applicants relocating"
    r"\b(?:open to|consider\w*|welcome\w*|accept\w*)\s+(?:people|candidates|applicants|talent|"
    r"those|anyone|engineers|you)\s+(?:who\s+(?:are|would be)\s+)?"
    r"(?:relocating|willing to relocate|who\s+(?:can|will|would)\s+relocate)",
    # "role is open to relocation", "relocation may be considered for qualified applicants"
    rf"\b(?:open to|consider\w*)\s+{_RELOC}\b",
    rf"\b{_RELOC}\s+(?:\w+\s+){{0,2}}(?:is|may be|can be|will be)\s+considered",
    # "upon relocation", "relocate to Singapore", "relocating to the Bay Area"
    r"\b(?i:relocate|relocating)\s+to\s+(?:the\s+)?[A-Z][\w.'-]+",
]

_FLAGS = re.I | re.M
_SUPPORT_NO_RE = [re.compile(p, _FLAGS) for p in _SUPPORT_NO]
_SUPPORT_YES_RE = [re.compile(p, _FLAGS) for p in _SUPPORT_YES]
_REQUIRED_NO_RE = [re.compile(p, _FLAGS) for p in _REQUIRED_NO]
# The last rule needs the original case (a capitalised place name after "relocate to").
_REQUIRED_YES_RE = [re.compile(p, _FLAGS) for p in _REQUIRED_YES[:-1]] + [
    re.compile(_REQUIRED_YES[-1], re.M)
]

# Topic words that mark the sentence as being about moving offices / clients, not the candidate.
_NOISE = re.compile(
    r"\b(?:relocation\s+(?:management|services?\s+(?:company|provider|industry)|consultant|"
    r"specialist|coordinator|counsel\w*|policy|policies|programmes?\s+for\s+clients|matters|"
    r"industry|experience|agreements?|counselling|cases?)|relocating\s+employees|"
    r"(?:office|utility|site|data ?center|equipment|facility|store|plant|network|customer|"
    r"client)\s+relocations?|relocations?,|relocating\s+to\s+a\s+new\s+(?:office|building|facility|"
    r"headquarters)|mobility\s+programs?|global\s+mobility|household\s+goods|moving\s+and\s+"
    r"storage|van[- ]line|assignees?)",
    re.I,
)

# Sentence ends ("…offer. The…", "…offer.The…" from flattened HTML), line breaks and semicolons.
_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z\"'(\[-])|(?<=[a-z]\.)(?=[A-Z][a-z])|[\n;]+", re.M)
# A form label on its own line ("Relocation Assistance Eligible:" then "No" on the next line).
_LABEL = re.compile(r"^\W*(?:relocation|relocate)[\w /]{0,40}[:\-–—]\s*$", re.I)
_HINT = re.compile(r"relocat|re-location|umzug|relocate", re.I)


def sentences(text: str) -> list[str]:
    """Sentences and bullet lines that mention relocation (others can't match any rule)."""
    parts = [p.strip() for p in _SPLIT.split(text) if p and p.strip()]
    out: list[str] = []
    for i, part in enumerate(parts):
        if _LABEL.match(part) and i + 1 < len(parts):
            part = f"{part} {parts[i + 1]}"
        if _HINT.search(part):
            out.append(part)
    return out


def _any(patterns: list[re.Pattern[str]], text: str) -> bool:
    return any(p.search(text) for p in patterns)


def sentence_signals(sentence: str) -> tuple[bool | None, bool | None]:
    """`(support, required)` for one sentence; None = the sentence says nothing about it."""
    noisy = bool(_NOISE.search(sentence))
    support: bool | None = None
    if _any(_SUPPORT_NO_RE, sentence):
        support = False
    elif not noisy and _any(_SUPPORT_YES_RE, sentence):
        support = True
    required: bool | None = None
    if _any(_REQUIRED_NO_RE, sentence):
        required = False
    elif not noisy and _any(_REQUIRED_YES_RE, sentence):
        required = True
    return support, required


def job_relocation(title: str | None, description: str | None) -> tuple[bool | None, bool | None]:
    """`(support, required)` for a posting; see the module docstring."""
    support: bool | None = None
    required: bool | None = None
    for sentence in sentences(f"{title or ''}\n{description or ''}"):
        s, r = sentence_signals(sentence)
        if s is not None:
            support = bool(s or support)
        if r is not None:
            required = bool(r or required)
    return support, required
