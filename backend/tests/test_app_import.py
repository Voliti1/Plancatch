"""Regression test for application import order."""

import subprocess
import sys


def test_app_imports_in_a_fresh_process() -> None:
    """Ensure model registration does not introduce circular imports."""
    result = subprocess.run(
        [sys.executable, "-c", "from app.main import app; assert app is not None"],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
