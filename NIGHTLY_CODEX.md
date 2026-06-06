# Codex Nightly Loop

This repository includes a four-pass unattended Codex loop:

1. Stability and P0/P1 fixes
2. First-use guidance and state visibility
3. Conservative performance improvements
4. Diff review and final verification

## Run

Start from a clean working tree:

```bash
./scripts/run-codex-nightly.sh
```

The script creates a branch named `codex/nightly-YYYYMMDD-HHMMSS`. Each pass
runs Codex with `workspace-write`, approval prompts disabled, and network access
left off. Changes are checkpointed in a separate commit after every pass.

Results are written under `codex-runs/<run-id>/`:

- `SUMMARY.md`: overall verification status
- `pass-*-report.md`: each Codex final report
- `pass-*-codex.log`: full streamed output
- `pass-*-{lint,typecheck,build}.log`: verification output
- `pass-*-diff-stat.txt`: change size after each pass

The run directory is ignored by Git. Review the branch diff and test audio and
interactive behavior manually before merging.

## Safety

The runner stops if the working tree is already dirty. It does not push, merge,
or open a pull request. It grants write access only to the workspace and does
not enable command network access.

To stop a running loop, press `Ctrl-C`. The current branch and completed
checkpoint commits remain available for review.
