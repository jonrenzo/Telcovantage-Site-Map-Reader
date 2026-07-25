"""Tests for pole-topology span derivation.

Each test is one of the failure modes the rework exists to kill. The first two
are the bugs the field reported: broken linework exploding into many span ids,
and continuous linework collapsing many spans into one.
"""

import math
import random
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app_python.services import span_builder as sb


class Seg:
    """Stand-in for server.Seg — same duck type, no ezdxf needed."""

    def __init__(self, x1, y1, x2, y2, is_hatch=False, color=254):
        self.x1, self.y1, self.x2, self.y2 = x1, y1, x2, y2
        self.is_hatch = is_hatch
        self.color = color

    def length(self):
        return math.hypot(self.x2 - self.x1, self.y2 - self.y1)

    def __repr__(self):
        return f"Seg({self.x1},{self.y1}->{self.x2},{self.y2})"


def line(x1, y1, x2, y2, pieces=4, **kw):
    """A straight run chopped into connected pieces, as a drafter would draw it."""
    out = []
    for i in range(pieces):
        t0, t1 = i / pieces, (i + 1) / pieces
        out.append(
            Seg(
                x1 + t0 * (x2 - x1),
                y1 + t0 * (y2 - y1),
                x1 + t1 * (x2 - x1),
                y1 + t1 * (y2 - y1),
                **kw,
            )
        )
    return out


def pole(pid, name, cx, cy):
    return {"pole_id": pid, "name": name, "cx": cx, "cy": cy}


def keys(result):
    return sorted(s.span_key for s in result.spans)


def codes(notes):
    return {n.code for n in notes}


# ─────────────────────────────────────────────────────────────────────────────
# The two field bugs
# ─────────────────────────────────────────────────────────────────────────────


def test_fragmented_linework_yields_one_span_with_full_length():
    """5 disconnected pieces between 2 poles used to upload as 5 span ids.

    The Planner path suffixed them -2 -3 -4 -5; the AsBuilt path kept one and
    silently dropped 80% of the cable length.
    """
    segments = []
    for i in range(5):
        x0 = i * 20.25
        segments += line(x0, 0, x0 + 19, 0, pieces=4)

    poles = [pole(1, "P1", 0, 2), pole(2, "P2", 100, 2)]
    result = sb.build_node_spans({"cable": segments}, poles)

    assert result.ok, [e.to_dict() for e in result.errors]
    assert len(result.spans) == 1
    span = result.spans[0]
    assert span.span_key == "POLE-0001::POLE-0002"
    # Full pole-to-pole distance, not one fragment's worth.
    assert span.arc_length == pytest.approx(100.0, abs=0.5)


def test_continuous_linework_through_five_poles_yields_four_spans():
    """One polyline through 5 poles used to be a single span id.

    Poles 2, 3 and 4 had no work item, so they could never be cleared.
    """
    segments = line(0, 0, 100, 0, pieces=20)
    poles = [pole(i + 1, f"P{i + 1}", i * 25, 2) for i in range(5)]

    result = sb.build_node_spans({"cable": segments}, poles)

    assert result.ok, [e.to_dict() for e in result.errors]
    assert len(result.spans) == 4
    assert keys(result) == [
        "POLE-0001::POLE-0002",
        "POLE-0002::POLE-0003",
        "POLE-0003::POLE-0004",
        "POLE-0004::POLE-0005",
    ]
    for s in result.spans:
        assert s.arc_length == pytest.approx(25.0, abs=0.5)


# ─────────────────────────────────────────────────────────────────────────────
# Pole handling
# ─────────────────────────────────────────────────────────────────────────────


def test_offset_poles_still_project_in_the_right_order():
    """Poles are drawn beside the cable, never on it."""
    segments = line(0, 0, 100, 0, pieces=20)
    offsets = [0.5, 3.0, 1.2, 2.4, 0.9]
    poles = [pole(i + 1, f"P{i + 1}", i * 25, offsets[i]) for i in range(5)]

    result = sb.build_node_spans({"cable": segments}, poles)

    assert result.ok, [e.to_dict() for e in result.errors]
    assert len(result.spans) == 4
    walk = [p.pole_index for p in sorted(result.poles, key=lambda p: p.t)]
    assert walk == ["POLE-0001", "POLE-0002", "POLE-0003", "POLE-0004", "POLE-0005"]


def test_pole_far_from_the_cable_is_excluded_and_reported():
    segments = line(0, 0, 100, 0, pieces=20)
    poles = [pole(i + 1, f"P{i + 1}", i * 25, 1.0) for i in range(5)]
    poles.append(pole(99, "STRAY", 50, 500))

    result = sb.build_node_spans({"cable": segments}, poles)

    assert result.ok, [e.to_dict() for e in result.errors]
    assert len(result.spans) == 4  # the stray pole adds no span
    assert "poles_off_path" in codes(result.warnings)
    stray = next(p for p in result.poles if p.pole_id == 99)
    assert not stray.snapped


def test_two_poles_at_the_same_spot_are_flagged_not_silently_accepted():
    segments = line(0, 0, 100, 0, pieces=20)
    poles = [pole(i + 1, f"P{i + 1}", i * 25, 1.0) for i in range(5)]
    poles.append(pole(6, "P3-DUPLICATE", 50.1, 1.0))

    result = sb.build_node_spans({"cable": segments}, poles)

    assert "duplicate_pole_suspected" in codes(result.warnings)
    # A zero-length span would be a real work item in the backend, so it blocks.
    assert "degenerate_span" in codes(result.errors)


# ─────────────────────────────────────────────────────────────────────────────
# Determinism — this is what makes span_key a durable identity
# ─────────────────────────────────────────────────────────────────────────────


def test_reversing_and_shuffling_the_input_changes_nothing():
    """Direction instability used to create a second span for the same cable.

    twinbackend keys on the ordered pole pair, so a flipped from/to made
    firstOrCreate miss and insert a duplicate. Its $isReversed workaround exists
    because of exactly this.
    """
    segments = line(0, 0, 100, 0, pieces=20)
    poles = [pole(i + 1, f"P{i + 1}", i * 25, 2) for i in range(5)]
    baseline = sb.build_node_spans({"cable": segments}, poles)

    flipped = [Seg(s.x2, s.y2, s.x1, s.y1, color=s.color) for s in segments]
    rng = random.Random(1234)
    rng.shuffle(flipped)
    other = sb.build_node_spans({"cable": flipped}, list(reversed(poles)))

    assert other.ok
    assert keys(other) == keys(baseline)
    # Same physical pole must land on the same walk position both times.
    base_index = {p.pole_id: p.pole_index for p in baseline.poles}
    other_index = {p.pole_id: p.pole_index for p in other.poles}
    assert other_index == base_index


def test_span_key_is_direction_free():
    assert sb.make_span_key("POLE-0002", "POLE-0001") == sb.make_span_key(
        "POLE-0001", "POLE-0002"
    )


def test_pole_index_sorts_lexicographically_in_walk_order():
    labels = [sb.pole_index(i) for i in (1, 2, 9, 10, 11, 100)]
    assert labels == sorted(labels)


# ─────────────────────────────────────────────────────────────────────────────
# Out-of-domain drawings must fail loudly
# ─────────────────────────────────────────────────────────────────────────────


def test_two_separate_cable_runs_are_rejected_not_fused():
    segments = line(0, 0, 100, 0, pieces=8) + line(200, 0, 300, 0, pieces=8)
    poles = [pole(i + 1, f"P{i + 1}", i * 25, 2) for i in range(5)]

    result = sb.build_node_spans({"cable": segments}, poles)

    assert not result.ok
    assert "not_chainable" in codes(result.errors)


def test_near_miss_separation_is_still_rejected():
    """The gap that a self-calibrating bridge limit would have swallowed.

    Two clean runs 100 apart is only ~5% of the combined length, so the
    aggregate bridged-ratio check never fires. The limit has to be anchored to
    pole spacing, which is independent of the gap being judged.
    """
    segments = line(0, 0, 1000, 0, pieces=8) + line(1100, 0, 2100, 0, pieces=8)
    poles = [pole(i + 1, f"P{i + 1}", i * 250, 3) for i in range(5)]

    result = sb.build_node_spans({"cable": segments}, poles)

    assert not result.ok
    assert "not_chainable" in codes(result.errors)


def test_closed_loop_is_rejected():
    segments = (
        line(0, 0, 100, 0, pieces=4)
        + line(100, 0, 100, 100, pieces=4)
        + line(100, 100, 0, 100, pieces=4)
        + line(0, 100, 0, 0, pieces=4)
    )
    poles = [
        pole(1, "P1", 25, 3),
        pole(2, "P2", 75, 3),
        pole(3, "P3", 97, 50),
        pole(4, "P4", 50, 97),
    ]

    result = sb.build_node_spans({"cable": segments}, poles)

    assert not result.ok
    assert "closed_loop" in codes(result.errors)


def test_single_pole_cannot_form_a_span():
    segments = line(0, 0, 100, 0, pieces=8)
    result = sb.build_node_spans({"cable": segments}, [pole(1, "P1", 50, 2)])

    assert not result.ok
    assert "insufficient_poles" in codes(result.errors)


# ─────────────────────────────────────────────────────────────────────────────
# Parallel runs — the replacement for the deleted manual pairing tool
# ─────────────────────────────────────────────────────────────────────────────


def test_parallel_cable_becomes_extra_runs_not_a_separate_span():
    segments = line(0, 0, 100, 0, pieces=20) + line(0, 1.5, 100, 1.5, pieces=20)
    poles = [pole(i + 1, f"P{i + 1}", i * 25, 4) for i in range(5)]

    result = sb.build_node_spans({"cable": segments}, poles)

    assert result.ok, [e.to_dict() for e in result.errors]
    assert len(result.spans) == 4
    assert "parallel_runs" in codes(result.warnings)
    assert all(s.cable_runs == 2 for s in result.spans), [
        s.cable_runs for s in result.spans
    ]


def test_single_run_reports_one_run():
    segments = line(0, 0, 100, 0, pieces=20)
    poles = [pole(i + 1, f"P{i + 1}", i * 25, 2) for i in range(5)]

    result = sb.build_node_spans({"cable": segments}, poles)

    assert all(s.cable_runs == 1 for s in result.spans)


# ─────────────────────────────────────────────────────────────────────────────
# Strand lengths
# ─────────────────────────────────────────────────────────────────────────────


def test_ocr_values_match_the_span_they_label():
    segments = line(0, 0, 100, 0, pieces=20)
    poles = [pole(i + 1, f"P{i + 1}", i * 25, 2) for i in range(5)]
    ocr = [
        {"center_x": 12.5, "center_y": -3, "value": "40"},
        {"center_x": 37.5, "center_y": -3, "value": "41"},
        {"center_x": 62.5, "center_y": -3, "value": "42"},
        {"center_x": 87.5, "center_y": -3, "value": "43"},
    ]

    result = sb.build_node_spans({"cable": segments}, poles, ocr)

    assert result.ok
    assert [s.strand_length for s in result.spans] == [40.0, 41.0, 42.0, 43.0]
    assert all(s.length_source == "ocr" for s in result.spans)


def test_span_without_a_nearby_value_falls_back_to_arc_length_and_says_so():
    segments = line(0, 0, 100, 0, pieces=20)
    poles = [pole(i + 1, f"P{i + 1}", i * 25, 2) for i in range(5)]
    ocr = [{"center_x": 12.5, "center_y": -3, "value": "40"}]

    result = sb.build_node_spans({"cable": segments}, poles, ocr)

    assert result.spans[0].length_source == "ocr"
    assert [s.length_source for s in result.spans[1:]] == ["arc_length"] * 3
    assert "span_without_meter_value" in codes(result.warnings)


def test_corrected_value_wins_over_raw_ocr():
    segments = line(0, 0, 100, 0, pieces=8)
    poles = [pole(1, "P1", 0, 2), pole(2, "P2", 100, 2)]
    ocr = [{"center_x": 50, "center_y": -3, "value": "88", "corrected_value": "55"}]

    result = sb.build_node_spans({"cable": segments}, poles, ocr)

    assert result.spans[0].strand_length == 55.0


def test_one_value_cannot_claim_two_spans():
    segments = line(0, 0, 100, 0, pieces=20)
    poles = [pole(i + 1, f"P{i + 1}", i * 25, 2) for i in range(5)]
    ocr = [{"center_x": 50, "center_y": -3, "value": "77"}]

    result = sb.build_node_spans({"cable": segments}, poles, ocr)

    assert sum(1 for s in result.spans if s.length_source == "ocr") == 1


# ─────────────────────────────────────────────────────────────────────────────
# Serialisation — existing consumers read the legacy field names
# ─────────────────────────────────────────────────────────────────────────────


def test_serialised_span_keeps_the_fields_excel_and_chat_read():
    segments = line(0, 0, 100, 0, pieces=8)
    poles = [pole(1, "P1", 0, 2), pole(2, "P2", 100, 2)]
    ocr = [{"center_x": 50, "center_y": -3, "value": "60"}]

    payload = sb.serialize_spans_for_export(
        sb.build_node_spans({"cable": segments}, poles, ocr)
    )

    assert len(payload) == 1
    row = payload[0]
    # export_all_excel writes these straight into cells; the chat tool calls
    # .toLowerCase() on from_pole. Both break if they become objects.
    assert isinstance(row["from_pole"], str) and row["from_pole"] == "P1"
    assert isinstance(row["to_pole"], str) and row["to_pole"] == "P2"
    assert isinstance(row["total_length"], (int, float))
    assert row["meter_value"] == 60.0
    # New fields sit alongside, they do not replace.
    assert row["span_key"] == "POLE-0001::POLE-0002"
    assert row["from_pole_index"] == "POLE-0001"
    assert row["from_pole_ref"]["name"] == "P1"
    assert row["length_source"] == "ocr"
    assert row["segments"] and "x1" in row["segments"][0]


def test_meter_value_is_null_when_the_length_came_off_the_drawing():
    segments = line(0, 0, 100, 0, pieces=8)
    poles = [pole(1, "P1", 0, 2), pole(2, "P2", 100, 2)]

    row = sb.serialize_spans_for_export(sb.build_node_spans({"cable": segments}, poles))[0]

    assert row["meter_value"] is None
    assert row["length_source"] == "arc_length"
    assert row["total_length"] == pytest.approx(100.0, abs=0.5)


# ─────────────────────────────────────────────────────────────────────────────
# Input hygiene
# ─────────────────────────────────────────────────────────────────────────────


def test_hatch_boundaries_are_not_treated_as_cable():
    segments = line(0, 0, 100, 0, pieces=8)
    segments += [Seg(40, 40, 60, 40, is_hatch=True), Seg(60, 40, 60, 60, is_hatch=True)]
    poles = [pole(1, "P1", 0, 2), pole(2, "P2", 100, 2)]

    result = sb.build_node_spans({"cable": segments}, poles)

    assert result.ok, [e.to_dict() for e in result.errors]
    assert len(result.spans) == 1


def test_all_cable_layers_are_merged_into_one_run():
    poles = [pole(i + 1, f"P{i + 1}", i * 25, 2) for i in range(5)]
    result = sb.build_node_spans(
        {"cable": line(0, 0, 50, 0, pieces=8), "tx56": line(50, 0, 100, 0, pieces=8)},
        poles,
    )

    assert result.ok, [e.to_dict() for e in result.errors]
    assert len(result.spans) == 4


def test_empty_drawing_reports_an_error_rather_than_an_empty_span_list():
    result = sb.build_node_spans({}, [pole(1, "P1", 0, 0)])

    assert not result.ok
    assert "no_segments" in codes(result.errors)


def test_digit_strokes_on_the_cable_layer_are_filtered_out():
    """Text lives on the cable layers and would otherwise shatter the chain.

    Real drawings carry far more digit strokes than cable strokes, so the
    median stroke is a digit and the cable stands out as the over-long minority
    colour — which is what the filter keys on.
    """
    segments = line(0, 0, 100, 0, pieces=4)  # 25-unit cable strokes, colour 254
    for i in range(4):
        cx = 12.5 + i * 25
        for k in range(12):  # a two-digit label is a dozen short strokes
            segments.append(Seg(cx + k * 0.1, -3, cx + k * 0.1 + 0.2, -2.8, color=7))
    poles = [pole(i + 1, f"P{i + 1}", i * 25, 2) for i in range(5)]

    result = sb.build_node_spans({"cable": segments}, poles)

    assert result.ok, [e.to_dict() for e in result.errors]
    assert len(result.spans) == 4
    assert "segments_filtered" in codes(result.warnings)


def test_stray_marks_are_ignored_rather_than_reported_as_a_second_run():
    """When cable and text share a colour the filter cannot separate them.

    The leftovers must not be mistaken for a second cable run — that error would
    block the upload and point the operator at the wrong problem.
    """
    segments = line(0, 0, 100, 0, pieces=20)
    segments += [Seg(40, -8, 40.2, -8), Seg(40.2, -8, 40.2, -7.8)]
    poles = [pole(i + 1, f"P{i + 1}", i * 25, 2) for i in range(5)]

    result = sb.build_node_spans({"cable": segments}, poles)

    assert result.ok, [e.to_dict() for e in result.errors]
    assert len(result.spans) == 4
    assert "ignored_linework" in codes(result.warnings)
