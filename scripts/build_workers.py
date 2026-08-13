"""Build the worker assets consumed by the packaged Electron app on Windows."""
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VENV = ROOT / ".venv" / "Scripts"
PYTHON = VENV / "python.exe"
PYINSTALLER = VENV / "pyinstaller.exe"
OUTPUT = ROOT / "build-workers"
WORK = ROOT / ".worker-build"

def run(command: list[str]) -> None:
    subprocess.run(command, cwd=ROOT, check=True)

def main() -> None:
    python = str(PYTHON if PYTHON.exists() else shutil.which("python") or "python")
    run([python, "-m", "pip", "install", "-r", "workers/requirements.txt"])
    OUTPUT.mkdir(exist_ok=True)
    WORK.mkdir(exist_ok=True)
    pyinstaller = str(PYINSTALLER if PYINSTALLER.exists() else "pyinstaller")
    run([pyinstaller, "--noconfirm", "--clean", "--onefile", "--name", "arena-youtube-sync", "--distpath", str(OUTPUT), "--workpath", str(WORK / "youtube"), "--specpath", str(WORK), "workers/youtube_catalog.py"])
    npx = "npx.cmd" if os.name == "nt" else "npx"
    for source, target in [("scripts/riot-ingest.ts", "riot-sync.cjs"), ("scripts/sync-data.ts", "data-sync.cjs")]:
        run([npx, "esbuild", source, "--bundle", "--platform=node", "--format=cjs", "--target=node24", f"--outfile={OUTPUT / target}"])

if __name__ == "__main__":
    main()
