"""Execute a notebook top to bottom in a fresh kernel and save its outputs in place.

Run from backend/:  python -m scripts.run_notebook ../notebooks/01_exploration.ipynb

The kernel starts in the notebook's own directory. Timing metadata is not recorded, so
re-running on the same data produces the same file.
"""

from __future__ import annotations

import sys
from pathlib import Path

import nbformat
from nbclient import NotebookClient


def run(path: Path, timeout_s: int = 600) -> None:
    notebook = nbformat.read(path, as_version=4)
    client = NotebookClient(
        notebook,
        timeout=timeout_s,
        kernel_name="python3",
        record_timing=False,
        resources={"metadata": {"path": str(path.parent)}},
    )
    client.execute()
    nbformat.write(notebook, path)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: python -m scripts.run_notebook <notebook.ipynb>")
    run(Path(sys.argv[1]).resolve())
