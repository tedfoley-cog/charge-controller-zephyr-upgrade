import re

import pytest

import scan
from common import glob_match, load_rules


def write(root, rel, text):
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def rules_by_id():
    return {r["id"]: r for r in load_rules()["rules"]}


def test_rule_pack_is_valid_and_patterns_compile():
    pack = load_rules()
    assert pack["from"] == "v3.2" and pack["to"] == "v4.3"
    for rule in pack["rules"]:
        re.compile(rule["pattern"])
        assert rule["ref"].startswith("https://docs.zephyrproject.org/")


@pytest.mark.parametrize(
    "rule_id, rel, line, expected",
    [
        ("KCFG-001", "app/prj.conf", "CONFIG_CPLUSPLUS=y", True),
        ("KCFG-001", "app/prj.conf", "CONFIG_CPP=y", False),
        ("KCFG-002", "tests/prj.conf", "CONFIG_LIB_CPLUSPLUS=y", True),
        ("API-MAIN-001", "tests/src/main.cpp", "void main()", True),
        ("API-MAIN-001", "tests/src/main.cpp", "int main(void)", False),
        ("API-CAN-001", "app/src/ext/can.cpp", "    .id_type = CAN_EXTENDED_IDENTIFIER,", True),
        ("API-CAN-001", "app/src/ext/can.cpp", "    frame.flags = CAN_FRAME_IDE;", False),
        ("API-ISOTP-001", "app/src/ext/can.cpp", "    .use_fixed_addr = 1,", True),
        ("DT-CAN-001", "boards/arm/x/x.dts", "\tbus-speed = <500000>;", True),
        ("DT-CAN-001", "boards/arm/x/x.dts", "\tbitrate = <500000>;", False),
        ("TEST-001", "tests/CMakeLists.txt", "set(BOARD native_posix)", True),
        ("TEST-001", ".github/workflows/ci.yml", "west build -b native_posix tests", True),
        ("TEST-001", "tests/ui/fixtures/run/inventory.json", '"snippet": "set(BOARD native_posix)"', False),
        ("NUM-001", "app/src/dcdc.cpp", "    ls_voltage_min = 9.0;", True),
        ("NUM-001", "app/src/dcdc.cpp", "    ls_voltage_min = 9.0f;", False),
        ("NUM-001", "app/src/dcdc.cpp", "    // limit is 9.0 V", False),
        ("NUM-001", "app/src/dcdc.cpp", '    LOG_INF("limit 9.0 V");', False),
    ],
)
def test_rule_matches(tmp_path, rule_id, rel, line, expected):
    write(tmp_path, rel, line + "\n")
    pack = {"rules": [rules_by_id()[rule_id]]}
    assert bool(scan.scan(tmp_path, pack)) is expected


def test_findings_carry_location_context_and_fix(tmp_path):
    write(tmp_path, "app/prj.conf", "CONFIG_A=y\nCONFIG_CPLUSPLUS=y\nCONFIG_B=y\n")
    (finding,) = scan.scan(tmp_path, {"rules": [rules_by_id()["KCFG-001"]]})
    assert (finding["file"], finding["line"]) == ("app/prj.conf", 2)
    assert [c["line"] for c in finding["context"]] == [1, 2, 3]
    assert "CONFIG_CPP" in finding["fix"]
    assert finding["id"] == "KCFG-001:app/prj.conf:2"


def test_migrated_board_layout_is_clean(tmp_path):
    write(tmp_path, "boards/acme/x/Kconfig.x", "config BOARD_X\n\tselect SOC_STM32F072XB\n")
    write(tmp_path, "boards/acme/x/x_defconfig", "CONFIG_GPIO=y\n")
    assert scan.scan(tmp_path) == []


def test_summary_counts():
    findings = [
        {"severity": "breaking", "category": "api", "stream": "can", "source": "static", "file": "a"},
        {"severity": "breaking", "category": "api", "stream": "can", "source": "build", "file": "a"},
        {"severity": "advisory", "category": "kconfig", "stream": "foundation", "source": "static", "file": "b"},
    ]
    summary = scan.summarize(findings)
    assert summary["total"] == 3 and summary["files"] == 2
    assert summary["by_severity"] == {"breaking": 2, "advisory": 1}


def test_glob_star_does_not_cross_directories():
    assert glob_match("app/src/dcdc.cpp", "app/src/*.cpp")
    assert not glob_match("app/src/ext/can.cpp", "app/src/*.cpp")
    assert glob_match("boards/arm/x/a/b.dts", "boards/*/x/**")
