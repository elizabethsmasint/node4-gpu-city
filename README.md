# Node4 GPU City

The main data flow workbench shows three neighboring kernels on one recorded
device/stream. Each row contains DRAM input, a GPU working tile, and DRAM output.
Click a kernel or its memory boxes to preview its transfers. Arrows between rows
describe recorded stream order; amber marks a submitted kernel whose preceding
kernel has not finished.

Transfer percentages illustrate a representative tile. They are not measured
memory traffic or capacity. Unknown computations keep their transfer pattern
unknown. The trace clock and tile preview have separate play/pause controls.

The timeline, comparisons, source evidence, operation math, and optional factory
view remain available. Follow playhead automatically selects kernels during trace
playback; selecting a kernel manually pins the preview.

## Run and publish

This is the GitHub Pages publishing repository. Serve its root with
`python3 -m http.server 8765`. Publishing happens when changes are pushed to
`main`; the `pages build and deployment` workflow must succeed.

Live site: https://elizabethsmasint.github.io/node4-gpu-city/

The editable application copy also lives in `../../../gpu_city/web`. Keep HTML,
JavaScript, and styles synchronized when changing either copy. The HTML loads the entry script and styles using the release version
`dataflow-2`, and the new data flow renderer has its own module. Keep asset
versioning current when publishing future changes.

## Browser verification

`python3 tests/browser_check.py` starts a temporary local server, runs Firefox
checks, and shuts down the browser and server. It uses the installed Firefox
launcher and geckodriver. Use `--url https://elizabethsmasint.github.io/node4-gpu-city/`
to check the published site. Reports and screenshots go to `/tmp/gpu-city-ui-qa`.

The checks cover transfer phases and pause, main-view dependency states, kernel
selection, trace playback, comparison/evidence navigation, and a real 390-pixel
mobile viewport.
