# Node4 GPU City

The full-capture overview includes every recorded kernel on one shared time axis,
across all device/stream pairs and operation types. Bright marks are executed
work; dim marks are upcoming. At full scale multiple launches can share a pixel.
Click a row or use the capture slider to inspect any part of the run.

The connected sequence shows 18 individual kernels at once, in stream order.
Each card names its prerequisite, shows execution state, and displays DRAM input,
a GPU tile, and DRAM output. Every card follows the recorded clock. Completed
fills stay full until you explicitly rewind; selecting another card cannot reset
them. **Watch this sequence** replays the visible sequence over 18 seconds, then
stops with its completed output retained. Previous/next sequence controls let you
inspect the rest of the capture without moving the clock.

Read/compute/write phases illustrate a representative tile over kernel progress;
they are not measured memory timing, bytes, or capacity. Fill kernels do not
read an input tensor. Unknown transfer patterns remain unknown. Stream-order
links do not claim tensor handoffs or cross-stream waits. Overlapping records
have no invented dependency arrow. The optional computation detail has its own
non-repeating tile preview and explicit replay control.

The original timeline, comparisons, source evidence, operation details, and
factory view remain available. Inspector filters never remove launches from the
full-capture overview or connected sequence.

## Run and publish

Serve this directory with `python3 -m http.server 8765`. This is the GitHub Pages
publishing repository; pushing to `main` triggers `pages build and deployment`.
Live site: https://elizabethsmasint.github.io/node4-gpu-city/

The editable application copy is also in `../../../gpu_city/web`. Keep the HTML,
JavaScript, styles, and tests synchronized. Current asset version: `dependency-5`.

## Verification

Run `python3 tests/run_checks.py` for 237 JavaScript logic, renderer, shared-clock,
and application-handler checks. This uses the installed GJS runtime and a
temporary copy without browser-only cache query strings; it needs no network.

Run `python3 tests/browser_check.py` for Firefox desktop and 390px mobile checks,
or add `--url https://elizabethsmasint.github.io/node4-gpu-city/` after deployment.
Screenshots and browser reports go to `/tmp/gpu-city-ui-qa`.

For the November 13 update, logic checks passed. Browser QA and publication are
blocked in the current session: socket creation is prohibited, sandbox escalation
was rejected. The final GitHub push failed because authentication was unavailable
(`could not read Username`). The live site has not yet been updated with this release.

## Recorded execution graph

The graph uses the existing visual style, shared playhead and timeline zoom.
Drag to pan, scroll to zoom, or use the buttons. Click a group to expand it.
Every individual launch is available through the paged activity list and the
one-based Launch ID field. Fit capture, Go to selected kernel and Focus
highlighted path change the shared time window. The full-capture overview stays
visible and marks that window.

Original has one observed kernel/memory lane. Gold outlines and edges therefore
show **Recorded serial execution chain**, not a proven CPU/GPU critical path.
Stream-order edges are emitted only for known, non-overlapping adjacent records;
recorded overlaps are preserved. No tensor dependencies are asserted. With
multiple lanes the selected lane is highlighted, without choosing a supposed
critical path by aggregate duration or stream length. Group envelopes can
contain gaps; expand them for exact execution bars. Operation colors are retained.

The raw Nsight source now supplies kernel context/process/grid identities,
118,552 relevant Original host calls, 2,353 memory activities, seven overlapping
GPU synchronization records and the exported CUDA event records. An API's start
is an observed lower bound on submission; return is not the submission instant.
Dashed links show this distinction. Cross-stream event-wait links require an
exact device/context/process/eventId/eventSyncId join and a measured device event
completion. This cohort supplies no resolvable links: CUDA event timestamps are
zero and stream waits have invalid event identity sentinels. Missing links are
not reconstructed from nearby timestamps.

The no-captured-activity band uses the complete union of kernels, memcpy and
memset, including capture boundaries and overlaps counted once. Original has
118,202 gaps totaling **344.803921 ms**, largest **91.923200 ms**, unchanged from
the prior dataset. Its elapsed capture is **6799.414352 ms**; summed kernel time
is **6413.593919 ms** and kernel union is **6413.519903 ms**. These differ from
the independently measured step wall mean. The source includes 338 adjacent
kernel overlaps; no finish-to-start edges are invented for those pairs.

Click gaps for neighbors, timestamps, duration, overlapping host calls and
synchronization, and the next activity's correlated API timing. Empty category
rows, memory-only intervals and intervals without captured GPU activity have
distinct explanations. Missing activity establishes no CPU cause, removable
latency or guaranteed step-time saving. Internal kernel stalls occur within
execution bars. Ranked signature and individual-launch contributions are
investigation priorities, not guaranteed optimization savings.

Full critical-path attribution would additionally need CPU scheduling and call
stacks, model NVTX ranges, usable CUDA event/wait identities with device completion
timing, and buffer producer/consumer evidence. Other GPU processes and untraced
engines are outside the capture.

`tools/normalize.py convert capture.sqlite --output replay.json` retains the
new evidence for future imports (Python standard library only). The canonical
Node4 pipeline is also updated in `gpu_city/normalize.py` in the local Node4
workspace. This repository's build command expects its source results under
`results/` and writes derived datasets into `data/`.

Validation: `python3 tests/run_checks.py` checks graph math, full-record gap
accounting, concurrency, shared graph controls, launch lookup, inspector linking
and existing UI behavior. `python3 tests/verify_source_execution.py --source-root
/path/to/node4_spark_v2 --output data/execution-validation.json` independently
compares every kernel and memory record, relevant host call, synchronization
record, CUDA event record, source hash and union/gap totals against SQLite. The
saved report is linked from Evidence & data. Browser QA is blocked in this
session by socket restrictions; live layout and interaction are not verified.


## Discrete dependency graph view

The default **Dependency graph** tab uses fixed-size cards connected by directed
arrows. Coordinates follow dependency depth, with long chains folded into rows;
stream identity and time are labels, not lanes or geometric scales. Gold borders
and arrowheads highlight the selected stream's recorded execution constraints.
Original retains the **Recorded serial execution chain** scope and the same
caveats about missing CPU/GPU critical-path evidence and overlapping records.
No branches are added to the current source capture. Resolved event/wait anchors
can produce forks and joins when the trace actually supplies the required evidence.

Select a card to inspect its duration, timestamps, stream, recorded predecessors,
successors and edge evidence. Neighbor buttons navigate the real dependency
edges; **Open existing kernel details** reveals the existing detailed inspector.
Launch ID lookup expands and centers any individual launch. Graph selection
shares the existing inspector and playhead, while graph pan/zoom leaves the
timeline's time scale independent. Drag to pan, scroll to zoom, or use keyboard
arrows and plus/minus. The whole-graph overview navigates the camera. Fit capture,
Go to selected kernel and Focus highlighted constraints provide spatial views.

Only non-branching sequences collapse, with repeated signature patterns labeled
as repetitions and generic serial blocks labeled separately. Branch and merge
nodes stay explicit. Double-click a block or use **Expand selected sequence**;
**Collapse sequences** restores the compact view. All source activities remain
addressable. Original initially reduces 118,539 source activities to about 2,950
cards/blocks, including 1,057 repeated-sequence groups, before local expansion.

The **Execution timeline** tab preserves the previous measured-time view, host
CUDA calls, GPU waits, memory activities and inspectable gaps. The whole-capture
category/memory overview and gap band remain available above both views.

`tests/test_dag.js` verifies every source activity survives collapsing, real
forks/joins remain explicit, Original gains no invented branches, unresolved
cross-stream relationships stay missing, and timestamps cannot change layout or
node dimensions. Handler tests verify separate views, independent camera zoom,
lookup/expansion and predecessor/successor inspection. A Cairo replay of the actual
Canvas renderer was visually inspected; this is not browser layout verification.
