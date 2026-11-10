from app.services.upload_reconcile import (
    MAX_FINGERPRINTS,
    dedup_key,
    hash_of_key,
    is_safely_held,
    normalise_fingerprints,
    reconcile,
)

A = "a" * 64
B = "b" * 64
C = "c" * 64


def test_normalise_drops_junk_and_duplicates_and_keeps_order():
    raw = [A.upper(), A, "not-a-hash", 12, None, B, " " + B + " ", "z" * 64, "a" * 63]
    assert normalise_fingerprints(raw) == [A, B]


def test_dedup_key_and_hash_round_trip():
    assert hash_of_key(dedup_key("org1", A)) == A
    assert hash_of_key(None) == ""


def test_held_when_upload_record_exists():
    assert is_safely_held(True, [])


def test_held_when_a_stitch_job_received_the_bytes():
    for status in ("pending", "processing", "completed"):
        assert is_safely_held(False, [{"status": status}])


def test_failed_job_counts_only_while_raw_is_retained():
    assert is_safely_held(False, [{"status": "failed", "rawRetained": True}])
    assert not is_safely_held(False, [{"status": "failed", "rawRetained": False}])
    assert not is_safely_held(False, [{"status": "failed"}])


def test_cancelled_job_does_not_count():
    assert not is_safely_held(False, [{"status": "cancelled"}])


def test_nothing_known_means_not_held():
    assert not is_safely_held(False, [])


def test_reconcile_splits_present_and_missing():
    result = reconcile(
        [A, B, C],
        dedup_hashes_present={A},
        jobs_by_hash={B: [{"status": "processing"}], C: [{"status": "cancelled"}]},
    )
    assert result == {"present": [A, B], "missing": [C]}


def test_reconcile_never_loses_a_fingerprint():
    hashes = [A, B, C]
    result = reconcile(hashes, set(), {})
    assert sorted(result["present"] + result["missing"]) == sorted(hashes)


def test_limit_is_sane():
    assert MAX_FINGERPRINTS >= 500
