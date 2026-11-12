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
    "flat.putty_1st_coat_25",
    "flat.putty_2nd_coat_26",
    "flat.primer_1st_coat_paint_27",
    "common.putty_1st_coat_4",
    "common.putty_2nd_coat_5",
    "common.primer_1st_coat_paint_6",
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
    extra = ar.Dependency("flat.putty_2nd_coat_26", "flat.wall_punning_4", "none", "x")
    monkeypatch.setattr(ar, "DEPENDENCIES", ar.DEPENDENCIES + (extra,))
    assert any("cycle" in p for p in ar.validate_rules())


def _mode(earlier, later):
    return [d.infer for d in ar.DEPENDENCIES if d.earlier == earlier and d.later == later]


def test_putty_primer_punning_chain_full():
    assert _mode("flat.primer_1st_coat_paint_27", "flat.primer_1st_coat_paint_27") == []
    assert _mode("flat.putty_2nd_coat_26", "flat.primer_1st_coat_paint_27") == ["full"]
    assert _mode("flat.putty_1st_coat_25", "flat.putty_2nd_coat_26") == ["full"]
    assert _mode("flat.wall_punning_4", "flat.putty_1st_coat_25") == ["full"]
    assert _mode("flat.floor_screed_1", "flat.vitrified_flooring_16") == ["full"]
    assert _mode("flat.floor_screed_1", "flat.toilet_utility_balcony_flooring_14") == ["full"]
    assert _mode("flat.waterproofing_8", "flat.toilet_utility_balcony_flooring_14") == ["cap"]


def test_no_inference_of_concealed_quality_from_finishes():
    for d in ar.DEPENDENCIES:
        if d.infer != "none" and d.later in FINISHING:
            assert d.earlier not in SERVICE_OR_CONCEALED_QUALITY, d
    # concealed waterproofing is never inferred from paint
    for d in ar.DEPENDENCIES:
        if d.infer != "none" and d.later.endswith(("_25", "_26", "_27")):
            assert not ar.RULES[d.earlier].concealed_when_finished or d.earlier.endswith("_1"), d


def test_helpers():
    pre = ar.prerequisites_of("flat.putty_1st_coat_25")
    assert "flat.wall_punning_4" in pre
    inf = ar.inferable_from("flat.putty_1st_coat_25")
    assert inf and all(d.infer != "none" for d in inf)
    assert ar.inferable_from("flat.electrical_wiring_23") == ()
    assert ar.rule_for("nope") is None


@pytest.mark.parametrize("rid", sorted(ar.RULES))
def test_render_block(rid):
    text = ar.render_rule_block(rid)
    first = text.splitlines()[0]
    assert first == f"- {rid} - {ar.RULES[rid].label}"
    assert len(text) < 1300
    assert "NOT proof" in text and "Scope:" in text


def test_ascii_only():
    for rid, rule in ar.RULES.items():
        blob = repr(rule) + ar.render_rule_block(rid)
        blob.encode("ascii")
    for d in ar.DEPENDENCIES:
        repr(d).encode("ascii")
    with open(ar.__file__, encoding="utf-8") as fh:
        fh.read().encode("ascii")
