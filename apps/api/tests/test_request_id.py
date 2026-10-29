import logging
import uuid

from ujc_api.logging import JsonFormatter


def test_request_id_header_is_generated_when_absent(client):
    resp = client.get("/api/health")
    request_id = resp.headers.get("X-Request-ID")
    assert request_id
    uuid.UUID(request_id)  # generated ids are uuid4 strings


def test_request_id_header_is_echoed_when_provided(client):
    resp = client.get("/api/health", headers={"X-Request-ID": "caller-supplied-id"})
    assert resp.headers["X-Request-ID"] == "caller-supplied-id"


def test_access_log_record_carries_request_fields(client, caplog):
    with caplog.at_level(logging.INFO, logger="ujc_api.access"):
        client.get("/api/health?token=should-never-be-logged")

    records = [r for r in caplog.records if r.name == "ujc_api.access"]
    assert records, "expected an access-log record for the request"
    record = records[-1]
    assert record.method == "GET"
    assert record.path == "/api/health"  # query string is never attached
    assert record.status == 200
    assert isinstance(record.duration_ms, float)
    assert uuid.UUID(record.request_id)


def test_json_formatter_outputs_one_json_object_with_the_expected_fields():
    record = logging.LogRecord(
        name="ujc_api.access",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="request",
        args=(),
        exc_info=None,
    )
    record.request_id = "abc-123"
    record.method = "GET"
    record.path = "/api/health"
    record.status = 200
    record.duration_ms = 1.23

    import json

    line = JsonFormatter().format(record)
    payload = json.loads(line)
    assert payload["message"] == "request"
    assert payload["level"] == "INFO"
    assert payload["request_id"] == "abc-123"
    assert payload["method"] == "GET"
    assert payload["path"] == "/api/health"
    assert payload["status"] == 200
    assert payload["duration_ms"] == 1.23
