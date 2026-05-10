"""Regression test for OpenAI strict-schema compatibility.

OpenAI's function-calling API rejects array parameters that omit `items`:

    Invalid schema for function 'task_create': In context=('properties',
    'command'), array schema missing items.

A real chat turn against OpenAI fails on this for the user's first
write-class tool call. This test walks every tool's `parameters` block
(including nested objects) and asserts that array types declare `items`,
so a future tool author can't reintroduce the bug.
"""

from __future__ import annotations

from typing import Any


def _all_array_blocks(node: Any, path: str = "") -> list[tuple[str, dict]]:
    """Yield (path, dict) for every JSON-schema-shaped dict where type=array.

    Walks nested objects and items recursively.
    """
    out: list[tuple[str, dict]] = []
    if isinstance(node, dict):
        if node.get("type") == "array":
            out.append((path, node))
        # Recurse into 'properties', 'items', and any nested schema-ish dicts.
        for k, v in node.items():
            out.extend(_all_array_blocks(v, f"{path}.{k}" if path else k))
    elif isinstance(node, list):
        for i, item in enumerate(node):
            out.extend(_all_array_blocks(item, f"{path}[{i}]"))
    return out


def test_every_tool_array_param_has_items() -> None:
    """Walk every registered tool and assert array params declare items."""
    import importlib
    import pkgutil

    from clawagents import tools as _tools_pkg

    offenders: list[str] = []

    # Use the package's __path__ rather than __file__ — namespace-package-safe.
    for module_info in pkgutil.iter_modules(_tools_pkg.__path__):
        if module_info.name.startswith("_"):
            continue
        try:
            module = importlib.import_module(f"clawagents.tools.{module_info.name}")
        except Exception:
            # Skip modules with optional/missing deps.
            continue

        for attr_name in dir(module):
            attr = getattr(module, attr_name)
            params = getattr(attr, "parameters", None)
            if not isinstance(params, dict):
                continue
            tool_name = getattr(attr, "name", attr_name)
            for path, block in _all_array_blocks(params, tool_name):
                if "items" not in block:
                    offenders.append(f"{path} (block keys: {sorted(block.keys())})")

    assert not offenders, (
        "Tools with array params missing `items` will fail under OpenAI strict mode:\n  "
        + "\n  ".join(offenders)
    )
