import gate
import plan
import trial
from common import REPO

CFG = plan.load_streams()


def finding(file, stream="board", severity="breaking", rule="R"):
    return {"id": f"{rule}:{file}", "rule": rule, "title": "t", "file": file, "stream": stream, "severity": severity}


def test_board_findings_follow_board_ownership():
    streams = CFG["streams"]
    assert plan.owner_of(finding("boards/arm/mppt_2420_lc/Kconfig.board"), streams) == "foundation"
    assert plan.owner_of(finding("boards/arm/mppt_2420_hc/mppt_2420_hc.dts"), streams) == "can"
    assert plan.owner_of(finding("boards/arm/pwm_2420_lus/revision.cmake"), streams) == "pwm"
    assert plan.owner_of(finding("app/src/ext/can.cpp", "can"), streams) == "can"
    assert plan.owner_of(finding("app/src/dcdc.cpp", "numerics"), streams) == "numerics"


def test_parallel_tickets_own_disjoint_files():
    files = plan.tracked_files()
    built = plan.build_plan({"from": "v3.2", "to": "v4.3", "findings": []}, CFG, files)
    assert built["conflicts"] == []
    assert [w["parallel"] for w in built["waves"]] == [1, 4, 1]


def test_overlap_is_detected():
    a = {"id": "a", "wave": 1, "owns": ["app/src/**"]}
    b = {"id": "b", "wave": 1, "owns": ["app/src/ext/*.cpp"]}
    assert plan.overlaps(a, b, ["app/src/ext/can.cpp", "app/src/dcdc.cpp"]) == ["app/src/ext/can.cpp"]


def test_every_finding_lands_in_exactly_one_ticket():
    findings = [finding("west.yml", "foundation"), finding("boards/arm/mppt_2420_rc/x.dts"), finding("unknown/file.c", "other")]
    built = plan.build_plan({"from": "a", "to": "b", "findings": findings}, CFG, [])
    assigned = [f for t in built["tickets"] for f in t["findings"]]
    assert sorted(assigned) == sorted(f["id"] for f in findings)


UNITY_LOG = """
tests_dcdc.cpp:92:no_start_if_dcdc_disabled:PASS
-----------------------
10 Tests 0 Failures 0 Ignored
OK
-----------------------
18 Tests 1 Failures 2 Ignored
FAIL
Memory region         Used Size  Region Size  %age Used
           FLASH:       83696 B       128 KB     63.85%
            SRAM:       13904 B        16 KB     84.86%
"""


def test_parse_unity_and_memory():
    assert gate.parse_tests(UNITY_LOG) == {"suites": 2, "total": 28, "failures": 1, "ignored": 2}
    memory = gate.parse_memory(UNITY_LOG)
    assert memory["flash"] == {"used": 83696, "size": 128 * 1024}
    assert memory["sram"]["used"] == 13904


def test_only_application_warnings_count():
    log = f"{REPO}/app/src/daq.cpp:94:20: warning: implicit conversion [-Wdouble-promotion]\n" \
          "/opt/zephyr/kernel/x.c:1:1: warning: unused [-Wunused]\n"
    (warning,) = gate.parse_warnings(log)
    assert warning["file"] == "app/src/daq.cpp" and warning["flag"] == "-Wdouble-promotion"


def evidence(total=95, failures=0, flash=83696, status="built"):
    board = {"target": "b", "status": status}
    if status == "built":
        board |= {"flash": {"used": flash, "size": 131072}, "sram": {"used": 100, "size": 200}}
    return {"tests": {"total": total, "failures": failures, "exit": 1 if failures else 0}, "warnings": [], "boards": {"b": board}}


def failed(checks):
    return [c["name"] for c in checks if not c["ok"]]


def test_gate_passes_on_identical_evidence():
    assert failed(gate.evaluate(evidence(), evidence())) == []


def test_gate_fails_on_removed_test_failure_and_flash_growth():
    assert failed(gate.evaluate(evidence(total=94), evidence())) == ["no unit test removed"]
    assert "unit tests pass" in failed(gate.evaluate(evidence(failures=1), evidence()))
    assert failed(gate.evaluate(evidence(flash=95000), evidence())) == ["b: flash budget"]
    assert failed(gate.evaluate(evidence(flash=88000), evidence())) == []


def test_pending_board_only_blocks_integration_gate():
    pending = evidence(status="pending")
    assert failed(gate.evaluate(pending, evidence())) == []
    assert failed(gate.evaluate(pending, evidence(), require_all=True)) == ["b: migrated"]


def test_app_changes_need_new_tests():
    same = {"base": 95, "head": 95, "touched": 2}
    more = {"base": 95, "head": 99, "touched": 2}
    assert failed(gate.evaluate(evidence(), evidence(), delta=same)) == ["regression tests added for changed application code"]
    assert failed(gate.evaluate(evidence(), evidence(), delta=more)) == []


def test_trial_classifies_build_diagnostics():
    log = "\n".join([
        f"{REPO}/tests/prj.conf:12: warning: attempt to assign the value 'y' to the undefined symbol CPLUSPLUS",
        f"{REPO}/app/src/ext/can.cpp:49:10: error: ‘struct can_filter’ has no member named ‘id_type’",
        "/opt/zephyr/x.c:1:1: error: not ours",
        "No board named 'mppt_2420_lc' found.",
    ])
    found = trial.harvest(log, "tests")
    assert [(f["category"], f["stream"]) for f in found] == [("kconfig", "foundation"), ("api", "can"), ("board-model", "board")]
    assert found[0]["title"].endswith("CPLUSPLUS") and found[0]["line"] == 12
    assert all(f["source"] == "build" for f in found)
