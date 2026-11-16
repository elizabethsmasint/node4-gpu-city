# Tensor dependencies: available evidence and capturing the rest

The dashboard now defaults to **Tensor dependencies**, separate from recorded
CUDA stream order. Its default graph comes from the saved Original RMSNorm
backward compiler wrapper. It contains actual pointer bindings and Triton loads
and stores, not inferred edges between nearby launches.

In that fragment, `triton_red_fused_mul_sum_0` writes `buf0`, which
`triton_red_fused_mul_sum_1` reads to produce `buf1`. The later
`triton_per_fused_add_div_expand_mul_pow_sum_2` reads `tangents_1`, `primals_2`,
`primals_1` and `rsqrt`, and writes `buf3`. It does **not** read `buf0` or `buf1`.
The two branches share read-only inputs. There is no tensor-data edge from either
reduction to the `buf3` computation. This makes concurrent execution worth
investigating; it does not establish resource availability, a safe rewritten
schedule or a measured speedup. Buffer lifetimes and synchronization still matter.

Other scopes include the exact GDN chunk function (71 source operations/inputs),
the residual block, the dense FFN, and the saved RMSNorm forward wrapper. Source
SSA edges identify values an expression consumes, including views, branches and
merges. They are mathematical/operator relationships. A source operation can
launch zero, one or multiple CUDA kernels. Source/compiler scopes have no
per-launch duration or measured critical path; the dashboard explicitly leaves
these unavailable. The source expressions, line numbers, complete saved source
and SHA-256 hashes are included in `data/tensor-dependencies.json`.

Gold marks the selected computation's prerequisite cone; cyan outlines mark
computations with no dependency path to that selection **within this scope**.
The UI lists producers, consumers, named tensor values and overlap candidates.
Absence of a path in a partial graph does not establish whole-program independence.
Metadata-only shape/device/dtype access is excluded from tensor-readiness edges.
Opaque module calls remain opaque. Source functions do not depict the entire
training step, backward, optimizer, or every checkpoint replay instance.

## Capture actual tensors and associate kernel timing

A full measured tensor graph requires a new diagnostic run. This session's host
Python has no PyTorch, and the Docker daemon denies access, so **no new instrumented
GPU run has been performed here**. The capture tool's pure dependency bookkeeping
and trace joins are tested with fixtures; its PyTorch/CUDA integration remains
unverified on this host.

Use the existing Spark PyTorch environment. Start with a unique smoke output
folder; this changes workload size and must not be reported as the 16K benchmark:

```bash
cd /home/elizabeth/node4_spark_v2
python3 gpu_city/tools/capture_tensor_graph.py \
  --out results/tensor_smoke_01 -- \
  node4_fidelity_v2_trace.py --smoke --device cuda \
  --out-dir results/tensor_smoke_model_01
```

For the existing Docker environment, the equivalent command is:

```bash
docker run --rm --gpus all --ipc=host --shm-size=8g \
  -v /home/elizabeth/node4_spark_v2:/workspace/node4_spark_v2 \
  -w /workspace/node4_spark_v2 \
  nvcr.io/nvidia/pytorch:25.11-py3 \
  python3 gpu_city/tools/capture_tensor_graph.py \
    --out results/tensor_smoke_01 -- \
    node4_fidelity_v2_trace.py --smoke --device cuda \
    --out-dir results/tensor_smoke_model_01
```

Do not add the target's `--profile` flag; this tool owns the outer profiler. It
refuses to overwrite its own capture artifacts. Inspect the smoke capture and
attribution coverage before selecting a full-size diagnostic run. Instrumentation
can add substantial time and memory overhead. The outer capture covers setup,
warmup and target execution; its scope is not automatically one measured step.
Backward work dispatched on threads outside the instrumented mode may be missing;
check coverage before interpreting a graph. Compiled/custom opaque calls need their
own buffer instrumentation. The tool does
not disable compilation or alter CUDA stream scheduling implicitly.

Output:

- `tensor-graph.json`: load with **Tensor dependencies → Load tensor capture**.
- `trace.json`: same-run profiler output.
- `capture.json`: run identity, PyTorch version, command and attribution coverage.

The tool uses tensor object identities, schema-tracked mutation versions, storage identities,
shapes, strides and offsets. It preserves producer/consumer edges and conservative
whole-storage read/write/anti-dependency hazards for aliases and in-place writes.
Equal shapes never establish tensor identity. Weak lifetime tracking avoids
retaining GPU buffers; ambiguous/recreated lifetimes can leave producers unknown.
Hazards are conservative and can include disjoint views. These are displayed
separately from value edges, and missing paths do not prove safe overlap.

Explicit per-operator marker ranges join CPU operator External IDs and CUDA
correlation IDs from the same run. Ambiguous joins are omitted. Joined kernel
durations are summed and labeled as such; they do not become independent wall
benchmarks or predicted savings. Uninstrumented/opaque calls and unresolved
external inputs prevent a claim of a complete critical path.

Large imported graphs use a bounded dependency neighborhood (up to 400 nodes).
All node identities remain reachable by node-ID lookup and producer/consumer
navigation. The complete graph is retained for reachability checks; time and
stream identity never determine node layout. The existing recorded-execution
view retains whole-capture sequence collapsing, memory lanes and gap analysis.

## Validate and rebuild

```bash
python3 tools/build_tensor_sources.py \
  --source-root /home/elizabeth/node4_spark_v2 \
  --output data/tensor-dependencies.json
python3 -m unittest discover -s tests -p 'test_tensor_tools.py' -v
python3 tests/run_checks.py
```

The generator uses Python AST parsing only. It never imports or executes model
or compiler files. Relevant PyTorch references:
[profiler](https://docs.pytorch.org/docs/stable/profiler.html) and
[dispatcher extensions](https://docs.pytorch.org/docs/stable/notes/extending.html).
