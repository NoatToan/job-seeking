"""Pseudonyms, display names, the visitor cookie, and the comment/vote request models."""

import pytest
from fastapi import FastAPI, Request, Response
from fastapi.testclient import TestClient
from pydantic import ValidationError

from contributor_box.identity import (
    ADJECTIVES,
    ANIMALS,
    VisitorCookies,
    clean_display_name,
    email_local_part,
    pseudonym,
    public_author,
    visitor_label,
)
from contributor_box.schemas import (
    AdminPatchRequest,
    CommentCreateRequest,
    CommentEditRequest,
    IdentityRequest,
    ReportRequest,
    VoteRequest,
)

# --- pseudonyms ----------------------------------------------------------------------------------


def test_pseudonym_is_deterministic_and_bilingual():
    a, b = pseudonym("key-1"), pseudonym("key-1")
    assert a == b
    adj_en = a.en.split(" ")[0]
    vi_adj = dict(ADJECTIVES)[adj_en]
    animal = next(x for x in ANIMALS if a.en.endswith(f" {x[0]}"))
    assert a.vi == f"{animal[1]} {vi_adj}"
    assert a.emoji == animal[2]
    assert len(a.tag) == 3 and a.tag.isdigit()
    assert 0 <= a.tone < 5


def test_pseudonyms_spread_out():
    names = {pseudonym(f"visitor-{i}").en for i in range(500)}
    tagged = {(p.en, p.tag) for p in (pseudonym(f"visitor-{i}") for i in range(500))}
    assert len(names) > 300  # 48 x 48 combinations
    assert len(tagged) == 500  # the tag tells equal names apart


def test_word_lists_are_well_formed():
    assert len({en for en, _ in ADJECTIVES}) == len(ADJECTIVES)
    assert len({en for en, _, _ in ANIMALS}) == len(ANIMALS)
    assert all(en and vi for en, vi in ADJECTIVES)
    assert all(en and vi and emoji for en, vi, emoji in ANIMALS)


def test_public_author_never_exposes_email_or_key():
    user = public_author(
        user_id=7, email="jane.doe@example.com", user_name=None, visitor_key=None, visitor_name=None
    )
    assert user is not None
    assert user["name"] == "jane.doe" and user["kind"] == "user"
    assert "example.com" not in str(user)
    named = public_author(
        user_id=7, email="jane@example.com", user_name="Jane", visitor_key=None, visitor_name=None
    )
    assert named is not None and named["name"] == "Jane"
    guest = public_author(
        user_id=None, email=None, user_name=None, visitor_key="secret-key", visitor_name=None
    )
    assert guest is not None
    assert guest["kind"] == "guest" and guest["name"] is None
    assert guest["pseudonym"] == {
        "en": pseudonym("secret-key").en,
        "vi": pseudonym("secret-key").vi,
    }
    assert "secret-key" not in str(guest)
    assert (
        public_author(user_id=None, email=None, user_name=None, visitor_key=None, visitor_name=None)
        is None
    )


def test_visitor_label_and_local_part():
    p = pseudonym("k")
    assert visitor_label("k", None) == f"{p.en} #{p.tag}"
    assert visitor_label("k", "Minh") == f"Minh ({p.en} #{p.tag})"
    assert email_local_part("a.b@c.d") == "a.b"
    assert email_local_part(None) == "?"


# --- display names -------------------------------------------------------------------------------


def test_clean_display_name():
    assert clean_display_name("  Minh   Anh ") == "Minh Anh"
    assert clean_display_name("Nguyễn Văn A") == "Nguyễn Văn A"
    for bad in ["", "   ", "x" * 41, "a@b", "Ad​min", "tab\there\x07"]:
        with pytest.raises(ValueError):
            clean_display_name(bad)


@pytest.mark.parametrize(
    "name", ["Admin", "THE TEAM", "Moderator", "Quản trị", "Đội ngũ", "anonymous", "Ẩn danh"]
)
def test_reserved_names(name: str):
    with pytest.raises(ValueError):
        clean_display_name(name)


def test_identity_request():
    assert IdentityRequest.model_validate({"displayName": " Minh "}).display_name == "Minh"
    assert IdentityRequest.model_validate({"displayName": None}).display_name is None
    assert IdentityRequest.model_validate({"displayName": "  "}).display_name is None
    with pytest.raises(ValidationError):
        IdentityRequest.model_validate({})
    with pytest.raises(ValidationError):
        IdentityRequest.model_validate({"displayName": "Admin"})


# --- the visitor cookie --------------------------------------------------------------------------


def cookie_app(secret: str = "s3cret") -> TestClient:
    app = FastAPI()
    cookies = VisitorCookies(secret, secure=False)

    @app.get("/read")
    def read(request: Request) -> dict:
        v = cookies.read(request)
        return {"key": v.key if v else None}

    @app.get("/issue")
    def issue(request: Request, response: Response) -> dict:
        return {"key": cookies.read_or_issue(request, response).key}

    return TestClient(app)


def test_visitor_cookie_round_trip_and_tamper():
    client = cookie_app()
    assert client.get("/read").json() == {"key": None}
    first = client.get("/issue")
    key = first.json()["key"]
    set_cookie = first.headers["set-cookie"].lower()
    assert "httponly" in set_cookie and "samesite=lax" in set_cookie
    raw = client.cookies.get("cb_visitor")
    assert raw and raw.startswith("v1.")
    # The cookie's id is not the stored key (the key is a keyed hash of it).
    assert raw.split(".")[1] not in key
    assert client.get("/read").json() == {"key": key}
    # Same cookie again: no new identity.
    again = client.get("/issue")
    assert again.json()["key"] == key and "set-cookie" not in again.headers
    # Tampered id or signature: ignored.
    v, ident, sig = raw.split(".")
    client.cookies.clear()
    client.cookies.set("cb_visitor", f"{v}.{ident}x.{sig}")
    assert client.get("/read").json() == {"key": None}
    client.cookies.clear()
    client.cookies.set("cb_visitor", f"{v}.{ident}.{'0' * len(sig)}")
    assert client.get("/read").json() == {"key": None}
    client.cookies.clear()
    client.cookies.set("cb_visitor", "garbage")
    assert client.get("/read").json() == {"key": None}


def test_visitor_cookie_depends_on_the_secret():
    a = cookie_app("one")
    a.get("/issue")
    raw = a.cookies.get("cb_visitor")
    b = cookie_app("two")
    b.cookies.set("cb_visitor", raw or "")
    assert b.get("/read").json() == {"key": None}
    with pytest.raises(RuntimeError):
        VisitorCookies("")._mac("x", "y")


# --- request models ------------------------------------------------------------------------------


def test_vote_request():
    assert VoteRequest.model_validate({}).value == 1
    assert VoteRequest.model_validate({"value": -1}).value == -1
    for bad in (0, 2, "up"):
        with pytest.raises(ValidationError):
            VoteRequest.model_validate({"value": bad})


def test_comment_requests():
    req = CommentCreateRequest.model_validate({"body": "  hi\r\nthere  ", "parentId": "12"})
    assert req.body == "hi\nthere" and req.parent_id == "12"
    assert CommentCreateRequest.model_validate({"body": "x" * 2000}).body == "x" * 2000
    for bad in (
        {"body": ""},
        {"body": "   "},
        {"body": "x" * 2001},
        {"body": "a\x00b"},
        {"body": "ok", "parentId": "0"},
        {"body": "ok", "parentId": "1; drop"},
        {"body": "ok", "authorId": "1"},
    ):
        with pytest.raises(ValidationError):
            CommentCreateRequest.model_validate(bad)
    assert CommentCreateRequest.model_validate({"body": "x", "website": "spam"}).website == "spam"
    assert CommentEditRequest.model_validate({"body": " y "}).body == "y"
    with pytest.raises(ValidationError):
        CommentEditRequest.model_validate({"body": " "})


def test_report_request_and_lock_patch():
    assert ReportRequest.model_validate({}).reason is None
    assert ReportRequest.model_validate({"reason": "  spam "}).reason == "spam"
    with pytest.raises(ValidationError):
        ReportRequest.model_validate({"reason": "x" * 501})
    patch = AdminPatchRequest.model_validate({"commentsLocked": True})
    assert patch.model_fields_set == {"comments_locked"} and patch.comments_locked is True
    with pytest.raises(ValidationError):
        AdminPatchRequest.model_validate({"commentsLocked": None})
