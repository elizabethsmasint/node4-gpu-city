# Normalized trace v1

The converter emits UTF-8 JSON and a `.json.gz` equivalent. The local server negotiates gzip for browser fetches. The browser file loader accepts the plain `.json`.

Time is integer **nanoseconds**, relative to `origin_ns`, which is stored as a string to preserve a potentially large absolute clock. No rescaling or gap compression changes event timestamps. Chrome trace timestamps are parsed with Decimal before conversion from microseconds.

Top-level fields:

- `schema_version`: 1.
- `id`, `label`, `format`, `source`, `source_sha256`: identity and provenance.
- `cohort`: matched experiment identifier, or null for imports. Only the predefined fresh cohort enters the benchmark comparison.
- `origin_ns`, `duration_ns`, `boundary`: selected interval and how it was chosen.
- `event_fields`: names for the columns in `events`.
- `events`: sorted compact arrays, one per recorded CUDA kernel launch.
- `groups`: exact GPU implementation/configuration groups, indexed by `id`.
- `operators`: compact CPU operator records used only for same-trace correlations.
- `memory`: separately typed memcpy/memset activities; not included in CUDA kernel launch totals.
- `hardware`: exported device metadata, with null for unavailable fields.
- `phases`, `phase_note`: available CPU annotation intervals and their interpretation limits. Fresh Nsight captures have no model phase annotations.
- `stats`: counts, sums, interval unions and gaps derived from events.
- `gaps`: the largest 150 intervals without any captured kernel/copy/set activity.
- `issues`: evidence-ranked diagnostic entries, labeled measured or hypothesis.
- `benchmark`: independent CSV-based benchmark metadata, or null.

## Event array

| Index | Field | Meaning |
|---:|---|---|
| 0 | `start_ns` | GPU start relative to origin |
| 1 | `duration_ns` | GPU end minus start |
| 2 | `group` | Index in groups |
| 3 | `stream` | CUDA stream, or null |
| 4 | `correlation` | CUDA correlation ID, or null |
| 5 | `api_start_ns` | Correlated host API start relative to origin, or null |
| 6 | `api_duration_ns` | Inclusive host launch API duration, or null |
| 7 | `operator` | Index in operators, or null |
| 8 | `device` | Device ID, or null |

An event is active on `[start_ns, start_ns + duration_ns)`. Overlaps are preserved, including across streams. `api_start_ns` can precede origin for a PyTorch capture whose selected interval begins at the first GPU kernel. The signed difference between GPU start and host API end is shown as queue timing, never as isolated overhead.

## Group

`name` preserves the full demangled GPU name. `mangled` is null if unavailable. The Nsight grouping identity includes mangled/name, grid XYZ, block XYZ, static/dynamic shared allocation and registers per thread. PyTorch grouping uses its exported implementation/configuration fields. `fingerprint` hashes this identity for display.

`category`, `label`, `dtype` describe conservative signature classification. A dtype label from a mixed signature is not a claim about every intermediate arithmetic operation. A `nocast` implementation is not classified as a copy merely because the name contains “cast.” Compiler-generated Triton kernels and custom `_assemble_*` kernels remain distinguishable by exact names.

`count`, `total_ns`, `min_ns`, `max_ns`, `avg_ns`, `pct`, `first_event` are computed from the selected event interval. Percentages use summed kernel duration, not step wall time. Missing hardware values stay null.

`semantics` includes the formula, explanation, evidence scope, optional source anchor, optional source-derived shape context, optional logical-byte estimate and dependency limits. `shapes` remains null for Nsight rather than being replaced by historical attribution. Actual PyTorch shapes are in the event-correlated operator.

`counter_sample`, when present, is a separately measured NCU representative sample. Exact implementation/grid/block/shared allocation must match. Its L2 bytes and replay duration are not silently applied to every launch.

## Statistics and comparison

- `kernel_sum_ns`: sum of event durations, counting overlapping work more than once.
- `kernel_union_ns`: union of kernel intervals, counting overlapping wall-clock time once.
- `kernel_span_ns`: last kernel end minus first kernel start.
- `capture_ns`: full selected interval, including leading/trailing gaps.
- `no_activity_ns`: complement of the union of kernels, copies and memsets within that interval.
- `launch_api_sum_ns`: inclusive sum of captured host launch calls, potentially overlapping GPU execution and other host calls. Null means unavailable, zero means no qualifying calls were captured.
- `memory_activity_bytes`: sum of bytes attached to recorded memcpy/memset activities only. It excludes global-memory traffic from kernels.

Improvements use `(before - after) / before`. A zero or unavailable denominator gives null; speedup is unavailable if after is zero. Benchmark wall means use three independent per-process means of three non-warmup steps. No historical capture enters the fresh comparison.


## Execution evidence extension (compatible with v1)

Nsight event arrays append optional columns 9–11: CUDA context ID, serialized
process ID, and source grid ID. Older/PyTorch arrays may omit these columns.
Memory records now also retain context, process and CUDA correlation IDs.
`execution_evidence` retains compact host API intervals, a host-name dictionary,
full overlapping GPU synchronization records, CUDA event records and resolved
cross-stream event-wait links. `host_fields` documents each compact host column.
Host intervals may straddle capture boundaries and are rendered clipped; their
original timestamps/durations are retained. CUDA event timestamp zero means
completion was not measured. Invalid event identity sentinels never join.
Cross-stream links require matching device/context/process/eventId/eventSyncId
and measured event completion. They are execution constraints, not tensor edges.
The browser reconstructs all gaps from the complete activity union; the legacy
largest-150 list remains for backward compatibility and is not the graph input.
