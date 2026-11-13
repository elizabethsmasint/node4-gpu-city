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
JavaScript, styles, and tests synchronized. Current asset version: `big-picture-3`.

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
