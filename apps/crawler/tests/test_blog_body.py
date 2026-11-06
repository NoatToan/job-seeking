"""Republished-body sanitiser: third-party HTML -> safe JSON blocks."""

import pytest

from job_crawler.blog.body import MAX_BLOCKS, body_text, html_to_blocks, safe_href

BASE = "https://pub.example.com/articles/1"


def blocks(html: str):
    return html_to_blocks(html, BASE)[0]


def test_paragraphs_marks_and_links():
    assert blocks('<p>A <strong>bold</strong> <em><a href="/x">link</a></em></p>') == [
        {
            "type": "p",
            "inline": [
                {"text": "A "},
                {"text": "bold", "bold": True},
                {"text": " "},
                {"text": "link", "italic": True, "href": "https://pub.example.com/x"},
            ],
        }
    ]


@pytest.mark.parametrize(
    "href",
    [
        "javascript:alert(1)",
        "JaVaScRiPt:alert(1)",
        "data:text/html,<script>x</script>",
        "mailto:a@b.c",
        "https://user:pw@evil.test/",
        "vbscript:x",
    ],
)
def test_unsafe_hrefs_are_dropped(href):
    assert safe_href(href, BASE) is None
    [block] = blocks(f'<p><a href="{href}">x</a></p>')
    assert block["inline"] == [{"text": "x"}]


def test_dangerous_and_media_elements_are_removed_with_their_text():
    html = (
        "<p>keep</p><script>evil()</script><style>p{}</style><iframe src=x>frame</iframe>"
        "<form><input value=x><button>Click</button></form><svg><text>svg</text></svg>"
        "<figure><img src=x onerror=alert(1)><figcaption>caption</figcaption></figure>"
        "<noscript>ns</noscript><object>obj</object>"
    )
    assert blocks(html) == [{"type": "p", "inline": [{"text": "keep"}]}]


def test_attributes_never_survive():
    out = blocks('<p onclick="x()" style="color:red" class="c" id="i">t</p>')
    assert out == [{"type": "p", "inline": [{"text": "t"}]}]


def test_headings_lists_quotes_pre_hr_br():
    html = (
        "<h1>Title</h1><h3>Sub</h3><h6>Tiny</h6>"
        "<ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul>"
        "<ol><li>first</li></ol>"
        "<blockquote><p>quoted</p></blockquote>"
        "<pre>  code\n  block</pre><hr><p>a<br>b</p>"
    )
    assert blocks(html) == [
        {"type": "h", "level": 2, "inline": [{"text": "Title"}]},
        {"type": "h", "level": 3, "inline": [{"text": "Sub"}]},
        {"type": "h", "level": 4, "inline": [{"text": "Tiny"}]},
        {"type": "ul", "items": [[{"text": "one"}], [{"text": "two"}], [{"text": "nested"}]]},
        {"type": "ol", "items": [[{"text": "first"}]]},
        {"type": "quote", "inline": [{"text": "quoted"}]},
        {"type": "pre", "text": "  code\n  block"},
        {"type": "hr"},
        {"type": "p", "inline": [{"text": "a"}, {"text": "\n"}, {"text": "b"}]},
    ]


def test_whitespace_collapsed_and_entities_decoded():
    assert blocks("<p>  a \n\t b&nbsp;&amp; c </p>") == [
        {"type": "p", "inline": [{"text": "a b & c"}]}
    ]


def test_pixel_is_captured_only_when_it_matches():
    pattern = r"^https://counter\.example\.com/\d+\.gif$"
    html = '<p>x</p><img src="https://counter.example.com/7.gif"><img src="https://x.test/a.gif">'
    _, pixel = html_to_blocks(html, BASE, pixel_pattern=pattern)
    assert pixel == "https://counter.example.com/7.gif"
    _, none = html_to_blocks(
        '<p>x</p><img src="https://x.test/7.gif">', BASE, pixel_pattern=pattern
    )
    assert none is None


def test_empty_and_oversized_bodies_raise():
    with pytest.raises(ValueError):
        html_to_blocks("<script>x</script>", BASE)
    with pytest.raises(ValueError):
        html_to_blocks("<p>x</p>" * (MAX_BLOCKS + 1), BASE)


def test_body_text():
    out = blocks("<h2>H</h2><p>para</p><ul><li>i</li></ul><pre>p</pre>")
    assert body_text(out) == "H\npara\ni\np"
