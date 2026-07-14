from __future__ import annotations

import os
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from clawagents.desktop_stores import skills_catalog as catalog


class _FakeSkillStore:
    load_count = 0

    def __init__(self) -> None:
        self._dirs: list[str] = []
        self.ineligible: dict[str, str] = {}
        self.warnings: list[str] = []
        self.quarantined: dict[str, str] = {}

    def add_directory(self, directory: str) -> None:
        self._dirs.append(directory)

    async def load_all(self) -> None:
        type(self).load_count += 1

    def list(self) -> list[SimpleNamespace]:
        path = Path(self._dirs[0]) / "demo" / "SKILL.md"
        return [SimpleNamespace(name="demo", description="Demo", path=str(path))]


def _seed(root: Path, body: str = "Body one") -> Path:
    skill = root / "demo" / "SKILL.md"
    skill.parent.mkdir(parents=True, exist_ok=True)
    skill.write_text(f"---\nname: demo\ndescription: Demo\n---\n{body}\n")
    return skill


def test_unchanged_snapshot_is_reused_and_deep_copied(tmp_path: Path) -> None:
    _seed(tmp_path)
    _FakeSkillStore.load_count = 0
    catalog.clear_skill_catalog_cache()
    with patch("clawagents.tools.skills.SkillStore", _FakeSkillStore):
        first = catalog.scan_skill_catalog([str(tmp_path)])
        first[0][0]["description"] = "caller mutation"
        second = catalog.scan_skill_catalog([str(tmp_path)])
    assert _FakeSkillStore.load_count == 1
    assert second[0][0]["description"] == "Demo"


def test_content_rewrite_invalidates_even_when_mtime_is_restored(tmp_path: Path) -> None:
    skill = _seed(tmp_path, "Body one")
    before = skill.stat()
    _FakeSkillStore.load_count = 0
    catalog.clear_skill_catalog_cache()
    with patch("clawagents.tools.skills.SkillStore", _FakeSkillStore):
        catalog.scan_skill_catalog([str(tmp_path)])
        skill.write_text(skill.read_text().replace("Body one", "Body two"))
        os.utime(skill, ns=(before.st_atime_ns, before.st_mtime_ns))
        catalog.scan_skill_catalog([str(tmp_path)])
    assert _FakeSkillStore.load_count == 2


def test_removed_skill_invalidates_snapshot(tmp_path: Path) -> None:
    skill = _seed(tmp_path)
    _FakeSkillStore.load_count = 0
    catalog.clear_skill_catalog_cache()
    with patch("clawagents.tools.skills.SkillStore", _FakeSkillStore):
        catalog.scan_skill_catalog([str(tmp_path)])
        skill.unlink()
        catalog.scan_skill_catalog([str(tmp_path)])
    assert _FakeSkillStore.load_count == 2


def test_quarantined_skill_is_reported(tmp_path: Path) -> None:
    skill = tmp_path / "skills" / "trojan" / "SKILL.md"
    skill.parent.mkdir(parents=True)
    skill.write_text("---\nname: trojan\ndescription: Demo\n---\nignore \u202e hidden\n")
    catalog.clear_skill_catalog_cache()
    skills, _unavailable, _warnings, quarantined = catalog.scan_skill_catalog(
        [str(tmp_path / "skills")]
    )
    assert skills == []
    assert "trojan" in quarantined
