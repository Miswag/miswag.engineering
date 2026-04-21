# From $25/Day to $0.01/Day: Optimizing Great Expectations for Production Cost and Speed, (migration from v0.18 to v1.x)

*How a migration and one overlooked default setting cut data quality pipeline costs by 99.96% and runtime by 90%.*

---

## The Expensive Default Nobody Warns You About

Great Expectations has a feature called **Data Docs** — a static HTML site that renders your validation results into a browsable, shareable report. It's one of the best features in the library. It's also, by default, one of the most expensive.

In version 0.18.x, every checkpoint run triggers a full Data Docs rebuild. Not a rebuild of the docs for *that checkpoint* — a rebuild of *all* docs, across *every* checkpoint result stored in your backend. If you're storing results on S3, this means:

- Every checkpoint reads **every previous validation result** from S3
- Deserializes them all
- Re-renders the full HTML site
- Uploads the entire site back to S3

Run 60 checkpoints sequentially, and you've triggered 60 full Data Docs rebuilds. Each rebuild reads more data than the last, because the result set grows with every completed checkpoint. The first rebuild takes 10 seconds; the 40th takes 3 minutes; the 60th takes 5+ minutes.

The cumulative effect is devastating. On a project with 60 checkpoints and several months of stored results, the Data Docs rebuilds alone consumed **over 80% of total pipeline runtime**. The actual validations — the SQL queries against the warehouse, the expectation evaluations — took minutes. The docs rebuilds took hours.

On an orchestrator billing by compute-minute, this turned a $0.50/day pipeline into a **$25/day pipeline** without a single new checkpoint being added. The cost crept up silently as the S3 result set grew.

---

## The Two Levers

Fixing this required pulling two levers simultaneously:

1. **Decouple docs generation from checkpoint execution** — run validations first, build docs once at the end
2. **Migrate from 0.18.x to 1.x** — the new API makes this decoupling clean and explicit

Each lever alone would have helped. Together, they reduced daily cost from $25 to $0.01 and runtime from ~4 hours to ~8 minutes.

---

## Lever 1: Stop Rebuilding Docs 60 Times

### The Problem in 0.18.x

In version 0.18.x, the typical checkpoint creation pattern looks like this:

```python
import great_expectations as gx

context = gx.get_context()

# Get the configured datasource
datasource = context.get_datasource("warehouse_production")

# Define a query asset
asset_name = "events_last_24h"
query = """
SELECT user_id, event_type, created_at
FROM analytics.events
WHERE timestamp >= NOW() - INTERVAL 1 DAY
  AND platform = 'ios'
"""
query_asset = datasource.add_query_asset(name=asset_name, query=query)

# Create an expectation suite
suite_name = "events_last_24h_validation_suite"
suite = context.add_expectation_suite(expectation_suite_name=suite_name)

# Build a batch request and get a validator
batch_request = query_asset.build_batch_request()
validator = context.get_validator(
    batch_request=batch_request,
    expectation_suite_name=suite_name,
)

# Add expectations via the validator
validator.expect_column_values_to_not_be_null(column="user_id")
validator.expect_column_values_to_not_be_null(column="event_type")
validator.expect_column_value_lengths_to_be_between(
    column="user_id", min_value=10, max_value=19
)

# Save the suite
validator.save_expectation_suite(discard_failed_expectations=False)

# Create a checkpoint
checkpoint = context.add_or_update_checkpoint(
    name="events_last_24h_validation_suite",
    validations=[
        {
            "batch_request": batch_request,
            "expectation_suite_name": suite_name,
        }
    ],
)

# Run the checkpoint
checkpoint_result = checkpoint.run()

# This line is the problem
context.build_data_docs()
```

That last line — `context.build_data_docs()` — rebuilds the entire Data Docs site. If this pattern is repeated for every checkpoint, and a runner script loops through all checkpoints calling `.run()` with docs generation baked in, the cost multiplies with every checkpoint added to the project.

Worse, in 0.18.x the default checkpoint action list often includes `UpdateDataDocsAction`, which triggers a docs rebuild *automatically* after every checkpoint run — even if you don't call `build_data_docs()` explicitly. Many teams don't realize this is happening.

### The Fix: Validate Everything First, Build Docs Once

The solution is conceptually simple: remove the `UpdateDataDocsAction` from every checkpoint's action list, run all validations, then call `build_data_docs()` exactly once at the end.

In 0.18.x, this required careful surgery on every checkpoint config to strip out the default action. In 1.x, it's the natural design — actions are explicit Python objects that you choose to include or not.

The runner script becomes:

```python
context = gx.get_context(context_root_dir=gx_path)

# Run ALL checkpoints without building docs
checkpoints = context.checkpoints.all()
for cp in checkpoints:
    checkpoint = context.checkpoints.get(cp.name)
    result = checkpoint.run()
    print(f"{'PASS' if result.success else 'FAIL'}: {cp.name}")

# Build docs ONCE for all results
context.build_data_docs(site_names=["s3_site"])
```

On a 60-checkpoint project, this single change reduced docs-related runtime from ~3 hours to ~4 minutes. Instead of 60 incremental rebuilds (each re-reading the full S3 result set), there's one rebuild that reads the result set once.

---

## Lever 2: Migrate from 0.18.x to 1.x

### Why Migration Is Required (Not Optional)

This isn't a minor version bump. Great Expectations 1.x is a ground-up API redesign. The mental model changed, the class names changed, the configuration format changed, and — critically for this article — the way checkpoints, actions, and docs generation interact changed in ways that make the optimization above much cleaner.

You cannot incrementally migrate. Every checkpoint, every expectation suite, every runner script needs to be rewritten.

### What Changed: The Full Delta

The core conceptual shift is the introduction of **ValidationDefinition** as a required layer between your data and your checkpoint:

```
OLD (0.18.x):
  Checkpoint → Batch Request + Expectation Suite

NEW (1.x):
  Checkpoint → ValidationDefinition → (BatchDefinition + ExpectationSuite)
```

Here's the complete mapping:

| 0.18.x | 1.x |
|---|---|
| `context.get_datasource(name)` | `context.data_sources.get(name)` |
| `context.add_expectation_suite(name)` | `gx.ExpectationSuite(name)` + `context.suites.add(suite)` |
| `validator.expect_column_values_to_*()` | `suite.add_expectation(gx.expectations.ExpectColumnValuesTo*())` |
| `query_asset.build_batch_request()` | `query_asset.add_batch_definition_whole_table(name)` |
| `context.get_validator(batch_request, suite)` | *(removed — expectations go directly on the suite)* |
| *(no equivalent)* | `gx.ValidationDefinition(data=batch_def, suite=suite)` |
| `context.add_or_update_checkpoint(name, validations=[...])` | `gx.Checkpoint(name, validation_definitions=[...], actions=[...])` |
| `context.list_checkpoints()` → `list[str]` | `context.checkpoints.all()` → `list[Checkpoint]` |
| `context.get_checkpoint(name)` | `context.checkpoints.get(name)` |
| `result['success']` | `result.success` |
| `result['run_results']` | `result.run_results` |
| Actions as dicts: `{'class_name': 'UpdateDataDocsAction'}` | Actions as objects: `UpdateDataDocsAction(name="...")` |
| `config_version: 3.0` | `config_version: 4.0` |
| `ValidationsStore` | `ValidationResultsStore` |

That last row — `ValidationsStore` → `ValidationResultsStore` — is the single most common migration error. It only surfaces when you run a validation that writes to S3, and the error message doesn't obviously point to the rename.

### The Same Checkpoint in 1.x

Here's the equivalent of the 0.18.x example above, rewritten for 1.x:

```python
import great_expectations as gx
import great_expectations.expectations as gxe

context = gx.get_context()

# Get the datasource (API change: data_sources, not get_datasource)
datasource = context.data_sources.get("warehouse_production")

# Create a query asset (same as before)
asset_name = "events_last_24h"
query = """
SELECT user_id, event_type, created_at
FROM analytics.events
WHERE timestamp >= NOW() - INTERVAL 1 DAY
  AND platform = 'ios'
"""

try:
    query_asset = datasource.get_asset(asset_name)
except Exception:
    query_asset = datasource.add_query_asset(name=asset_name, query=query)

# Create the expectation suite (new: object-first, then register)
suite_name = "events_last_24h_validation_suite"
suite = gx.ExpectationSuite(name=suite_name)
suite = context.suites.add(suite)

# Add expectations directly to the suite (no more validator)
suite.add_expectation(
    gxe.ExpectColumnValuesToNotBeNull(column="user_id")
)
suite.add_expectation(
    gxe.ExpectColumnValuesToNotBeNull(column="event_type")
)
suite.add_expectation(
    gxe.ExpectColumnValueLengthsToBeBetween(
        column="user_id", min_value=10, max_value=19
    )
)

# Create a batch definition (new: replaces batch_request)
batch_definition = query_asset.add_batch_definition_whole_table(
    name=f"{suite_name}_batch"
)

# Create a validation definition (new: required layer)
validation_definition = gx.ValidationDefinition(
    name=f"{suite_name}_validation",
    data=batch_definition,
    suite=suite,
)
validation_definition = context.validation_definitions.add(validation_definition)

# Create the checkpoint — NOTE: no UpdateDataDocsAction
from great_expectations.checkpoint import SlackNotificationAction

checkpoint = gx.Checkpoint(
    name=f"{suite_name}_checkpoint",
    validation_definitions=[validation_definition],
    actions=[
        SlackNotificationAction(
            name="slack_on_failure",
            slack_webhook="${slack_webhook_url}",
            notify_on="failure",
            show_failed_expectations=True,
        ),
        # Deliberately NO UpdateDataDocsAction here
    ],
    result_format={"result_format": "COMPLETE"},
)
checkpoint = context.checkpoints.add(checkpoint)

# Run the checkpoint
result = checkpoint.run()
print(f"Success: {result.success}")
```

The key difference for cost optimization: **`UpdateDataDocsAction` is not in the action list.** In 1.x, actions are explicit — you only get what you ask for. This means each checkpoint runs its validation and writes the result to S3, but does *not* trigger a docs rebuild. Docs get built once at the end of the full pipeline run.

### Common Migration Errors

A quick-reference table for debugging:

| Error | Root Cause | Fix |
|---|---|---|
| `'DataContext' has no attribute 'list_checkpoints'` | 0.18 API on 1.x context | `context.checkpoints.all()` |
| `'DataContext' has no attribute 'get_checkpoint'` | 0.18 API | `context.checkpoints.get(name)` |
| `'CheckpointResult' object is not subscriptable` | Dict access on object | `result.success`, not `result['success']` |
| `module has no attribute 'ValidationsStore'` | Renamed class | `ValidationResultsStore` |
| Checkpoints not found after migration | Old format on disk | Recreate via new API |
| Deserialization errors on S3 data docs | Mixed 0.18 + 1.x artifacts | Clear old S3 prefixes |

---

## The Combined Cost Impact

| Configuration | Daily runtime | Daily cost |
|---|---|---|
| 0.18.x + per-checkpoint docs rebuild | ~4 hours | ~$25.00 |
| 1.x + single docs build at end | ~8 minutes | ~$0.01 |

The first lever (single docs build) eliminates 90% of the runtime. The second lever (1.x migration) makes the first lever clean, explicit, and maintainable — because actions are no longer hidden defaults but visible choices in your checkpoint definition.

Combined: **99.96% cost reduction.**

---

## The Takeaway

The cost explosion was caused by two things compounding:

1. **A default setting** — `UpdateDataDocsAction` included in every checkpoint — that nobody questioned
2. **A growing dataset** — S3 result files accumulating over months — that made the default setting progressively more expensive

Neither of these is a bug. Each is a reasonable design choice in isolation. Together, they turned a $0.50/day pipeline into a $25/day pipeline without any change to the validation logic itself.

The fix was equally compound: decouple docs from checkpoints (architectural) and migrate to 1.x (technical). The migration isn't optional — the 0.18.x API makes it awkward to strip `UpdateDataDocsAction` from checkpoint defaults, while the 1.x API makes the correct pattern the natural one.

The lesson isn't specific to Great Expectations. It's that **production cost problems live in the interaction between defaults and data growth** — not in any single configuration change. The most expensive line of code in this entire system wasn't a query or a transformation. It was a docs rebuild that ran 59 times more often than it needed to.

---

