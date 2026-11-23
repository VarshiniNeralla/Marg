from __future__ import annotations

import pytest

from app.services.construction_progress_providers import activity_rules as ar

_FIELDS = (
    "objects_to_find",
    "started_indicators",
    "partial_indicators",
    "complete_indicators",
    "insufficient_evidence",
    "unable_to_determine_when",
)

SERVICE_OR_CONCEALED_QUALITY = {
    "flat.mep_ceiling_services_plumbing_fire_gas_3",
    "flat.plumbing_pvc_waterline_7",
    "flat.electrical_wiring_23",
    "common.mep_works_fire_fighting_electrical_0",
}
FINISHING = {
    "flat.putty_39",
    "flat.paint_40",
    "common.putty_10",
    "common.paint_11",
    "flat.toilet_utility_balcony_flooring_14",
    "flat.toilet_utility_dado_15",
    "flat.vitrified_flooring_16",
}


@pytest.mark.parametrize("rid", ar.REQUIRED_IDS)
def test_required_rules_complete(rid):
    rule = ar.rule_for(rid)
    assert rule is not None
    assert rule.activity_id == rid
    for f in _FIELDS:
        assert getattr(rule, f), f"{rid}.{f} empty"
    assert rule.label and rule.scope_note


def test_validate_rules_clean():
    assert ar.validate_rules() == []


def test_graph_references_exist_and_acyclic():
    for d in ar.DEPENDENCIES:
        assert d.earlier in ar.RULES and d.later in ar.RULES
        assert d.infer in ("full", "cap", "none")
    assert ar._find_cycle() is None


def test_cycle_detection_works(monkeypatch):
    extra = ar.Dependency("flat.putty_39", "flat.wall_punning_4", "none", "x")
    monkeypatch.setattr(ar, "DEPENDENCIES", ar.DEPENDENCIES + (extra,))
    assert any("cycle" in p for p in ar.validate_rules())


def _mode(earlier, later):
    return [d.infer for d in ar.DEPENDENCIES if d.earlier == earlier and d.later == later]


def test_putty_paint_punning_chain_full():
    assert _mode("flat.paint_40", "flat.paint_40") == []
    assert _mode("flat.putty_39", "flat.paint_40") == ["full"]
    assert _mode("flat.wall_punning_4", "flat.putty_39") == ["full"]
    assert _mode("flat.ceiling_punning_2", "flat.putty_39") == ["cap"]
    assert _mode("common.putty_10", "common.paint_11") == ["full"]
    assert _mode("common.wall_punning_works_1", "common.putty_10") == ["full"]
    assert _mode("flat.floor_screed_1", "flat.vitrified_flooring_16") == ["full"]
    assert _mode("flat.floor_screed_1", "flat.toilet_utility_balcony_flooring_14") == ["full"]
    assert _mode("flat.waterproofing_8", "flat.toilet_utility_balcony_flooring_14") == ["cap"]


def test_old_coat_ids_have_no_rules_or_edges():
    gone = {
        "flat.putty_1st_coat_25", "flat.putty_2nd_coat_26", "flat.primer_1st_coat_paint_27",
        "common.putty_1st_coat_4", "common.putty_2nd_coat_5", "common.primer_1st_coat_paint_6",
    }
    assert not gone & set(ar.RULES)
    for d in ar.DEPENDENCIES:
        assert d.earlier not in gone and d.later not in gone


def test_every_rule_has_lowercase_proof_indicators():
    for rid, rule in ar.RULES.items():
        assert rule.proof_indicators, rid
        assert all(p == p.lower() and p.strip() for p in rule.proof_indicators), rid


def test_look_alike_prone_activities_have_strict_proof_lists():
    for rid in ("flat.false_ceiling_boxing_24", "common.false_ceiling_works_2"):
        proof = ar.RULES[rid].proof_indicators
        for needed in ("board joint", "grid", "channel", "access panel", "cove", "cut-out", "gypsum board"):
            assert needed in proof, (rid, needed)
        for lookalike in ("smooth", "white", "flat", "plain", "painted"):
            assert not any(lookalike in p for p in proof), (rid, lookalike)
    for rid in ("flat.putty_39", "common.putty_10"):
        assert "putty" in ar.RULES[rid].proof_indicators
    for rid in ("flat.paint_40", "common.paint_11"):
        assert {"paint", "primer", "roller"} <= set(ar.RULES[rid].proof_indicators)


def test_new_core_rules_exist_for_gypsum_railing_windows():
    for rid in ("flat.gypsum_41", "flat.railing_42", "flat.windows_43"):
        assert rid in ar.RULES and rid in ar.REQUIRED_IDS


def test_no_inference_of_concealed_quality_from_finishes():
    for d in ar.DEPENDENCIES:
        if d.infer != "none" and d.later in FINISHING:
            assert d.earlier not in SERVICE_OR_CONCEALED_QUALITY, d
    # concealed waterproofing is never inferred from paint
    for d in ar.DEPENDENCIES:
        if d.infer != "none" and d.later.endswith(("_39", "_40", "_10", "_11")):
            assert not ar.RULES[d.earlier].concealed_when_finished or d.earlier.endswith("_1"), d


def test_helpers():
    pre = ar.prerequisites_of("flat.putty_39")
    assert "flat.wall_punning_4" in pre
    inf = ar.inferable_from("flat.putty_39")
    assert inf and all(d.infer != "none" for d in inf)
    assert ar.inferable_from("flat.electrical_wiring_23") == ()
    assert ar.rule_for("nope") is None


@pytest.mark.parametrize("rid", sorted(ar.RULES))
def test_render_block(rid):
    text = ar.render_rule_block(rid)
    first = text.splitlines()[0]
    assert first == f"- {rid} - {ar.RULES[rid].label}"
    assert len(text) < 1300
    assert "NOT proof" in text and "Scope:" in text and "Proof needed" in text


def test_ascii_only():
    for rid, rule in ar.RULES.items():
        blob = repr(rule) + ar.render_rule_block(rid)
        blob.encode("ascii")
    for d in ar.DEPENDENCIES:
        repr(d).encode("ascii")
    with open(ar.__file__, encoding="utf-8") as fh:
        fh.read().encode("ascii")
