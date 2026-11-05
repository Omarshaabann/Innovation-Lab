#!/usr/bin/env python3
"""Creative Workload Router: sends heavy creative drafting to OpenCode (free models)
and keeps precision/tool/security work on Claude Code, to conserve Claude usage limits.

Usage:
  route.py classify "<task>"                 -> prints decision + score (no execution)
  route.py run "<task>" [--force opencode|claude] [--file F ...] [--out PATH]
"""
import argparse, json, subprocess, sys, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
CFG = json.loads((HERE / "router.config.json").read_text(encoding="utf-8"))
OPENCODE = Path.home() / ".opencode/bin/opencode"


def classify(task: str):
    t = task.lower()
    blockers = [k for k in CFG["claude_only"] if k in t]
    creative = [k for k in CFG["creative_heavy"] if k in t]
    volume = [k for k in CFG["volume_hints"] if k in t]
    score = len(creative) + (1 if volume else 0) + (1 if len(task) > 200 else 0)
    if blockers:
        return "claude", score, f"claude_only match: {blockers[:3]}"
    if score >= CFG["threshold"]:
        return "opencode", score, f"creative signals: {creative[:4]} volume: {volume[:2]}"
    return "claude", score, "below threshold (default: Claude)"


def run_opencode(task, files, out):
    models = [CFG["opencode_model"], *CFG["fallback_models"]]
    last = ""
    for m in models:
        cmd = [str(OPENCODE), "run", "--model", m, "--title", task[:50]]
        for f in files:
            cmd += ["--file", f]
        cmd.append(task)
        try:
            p = subprocess.run(cmd, capture_output=True, text=True,
                               timeout=CFG["timeout_seconds"], cwd=ROOT)
        except subprocess.TimeoutExpired:
            last = f"{m}: timeout"; continue
        if p.returncode == 0 and p.stdout.strip():
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(p.stdout, encoding="utf-8")
            return m, p.stdout
        last = f"{m}: rc={p.returncode} {p.stderr.strip()[:200]}"
    raise RuntimeError(last)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["classify", "run"])
    ap.add_argument("task")
    ap.add_argument("--force", choices=["opencode", "claude"])
    ap.add_argument("--file", action="append", default=[])
    ap.add_argument("--out")
    a = ap.parse_args()

    target, score, why = classify(a.task)
    if a.force:
        target, why = a.force, f"forced ({why})"
    print(f"[router] target={target} score={score} reason={why}", file=sys.stderr)

    if a.mode == "classify" or target == "claude":
        print(json.dumps({"target": target, "score": score, "reason": why}, ensure_ascii=False))
        return 0
    if not OPENCODE.exists():
        print(json.dumps({"target": "claude", "reason": "opencode not installed"}))
        return 3
    out = Path(a.out) if a.out else ROOT / CFG["output_dir"] / f"opencode-{int(time.time())}.md"
    try:
        model, _ = run_opencode(a.task, a.file, out)
    except RuntimeError as e:
        print(json.dumps({"target": "claude", "reason": f"opencode failed: {e}"}, ensure_ascii=False))
        return 2
    print(json.dumps({"target": "opencode", "model": model, "output": str(out)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
