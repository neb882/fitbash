# The queue

What the orchestrator and the GPU worker are finding out, and where each goal stands. `docs/PIPELINE.md` says
how they work. Read this first after any restart. Only the orchestrator edits this file.

A goal is **open** until the worker has confirmed the outcome on real hardware, then **closed**, or **with the
owner** when three rounds did not settle it.

| goal | decides | orders | status |
|---|---|---|---|
| G1 The memory step | Which line Setup shows for a graphics card smaller than the model, and for which cards | WO-01 | open: WO-01 running |
| G2 Knowing the step is done | Which field of the app's model list shows the saved options, so Setup can put the step away | WO-01 | open: WO-01 running |
| G3 The download readout | Whether Setup's size, speed and time left match the app's own window | WO-01 | open: WO-01 running |
| G4 What a local model keeps | How many pieces it keeps faithfully, and what Setup and the README should promise | WO-01 | open: WO-01 running |
| G5 The larger model | Whether `Flux-2-Klein-9B-GGUF` is worth suggesting, and for which cards | WO-01 | open: WO-01 running |

## Log

- 2026-11-26. Queue opened. WO-01 is the baseline the worker had already begun from `test/real/README.md`; the
  order gives it a report to fill in. Seen in the worker's chat so far, not yet in a report: with both memory
  options a one-piece outfit failed three times out of four while two to four pieces worked; with
  `--diffusion-fa` alone one, three and four pieces all worked; with neither, three pieces failed.
