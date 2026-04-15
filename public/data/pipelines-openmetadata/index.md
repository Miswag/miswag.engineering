# Automating Custom Data Pipeline Service Ingestion to OpenMetadata Using Python SDK

As data platforms grow in complexity, maintaining a centralized metadata catalog becomes non-negotiable. OpenMetadata has emerged as a strong open-source option for data discovery, governance, and lineage tracking — but what happens when your pipeline orchestrator isn't natively supported?

In this guide, I'll walk through how to programmatically ingest pipeline metadata from a custom service (using MageAI as an example) into OpenMetadata via its Python SDK. The same pattern applies to any orchestrator with a REST API — Prefect, Dagster, a homegrown scheduler, or anything else in your stack.

---

## The Problem

Most organizations run at least one pipeline tool that doesn't ship with an out-of-the-box OpenMetadata connector. Without automation, the catalog drifts from reality: pipelines are created or retired, tasks change, schedules shift — and none of it is reflected in the metadata layer. Manual syncing doesn't scale.

What we need is a lightweight bridge that can:

- Pull pipeline metadata from the orchestrator's API
- Map it to OpenMetadata's entity model (services, pipelines, tasks)
- Create or update records idempotently
- Run on a schedule to keep the catalog fresh

---

## Prerequisites

- A running OpenMetadata instance (v1.x+)
- Python 3.9+ with `pip`
- API credentials for both OpenMetadata and your pipeline service
- Familiarity with REST APIs and basic Python

---

## Environment Setup

Install the required packages:

```bash
pip install openmetadata-ingestion python-dotenv slack_sdk requests
```

Store credentials in a `.env` file — never hard-code tokens:

```env
OPENMETADATA_JWT_TOKEN=<your_openmetadata_jwt_token>
OPENMETADATA_HOST=https://<your-openmetadata-host>/api
SERVICE_API_BASE_URL=https://<your-pipeline-service-host>
SERVICE_API_KEY=<api_key>
SERVICE_API_TOKEN=<oauth_token>
SLACK_WEBHOOK_URL=<optional_slack_webhook>
```

---

## Connecting to OpenMetadata

The Python SDK wraps the OpenMetadata REST API and handles authentication, pagination, and entity serialization. Here's how to initialize the client:

```python
from metadata.generated.schema.entity.services.connections.metadata.openMetadataConnection import (
    OpenMetadataConnection,
)
from metadata.generated.schema.security.client.openMetadataJWTClientConfig import (
    OpenMetadataJWTClientConfig,
)
from metadata.ingestion.ometa.ometa_api import OpenMetadata
from dotenv import load_dotenv
import os

load_dotenv()

server_config = OpenMetadataConnection(
    hostPort=os.environ["OPENMETADATA_HOST"],
    authProvider="openmetadata",
    securityConfig=OpenMetadataJWTClientConfig(
        jwtToken=os.environ["OPENMETADATA_JWT_TOKEN"]
    ),
)

metadata = OpenMetadata(server_config)

if not metadata.health_check():
    raise ConnectionError("Failed to connect to OpenMetadata")
```

---

## Registering the Pipeline Service

Before ingesting individual pipelines, the parent service entity must exist. Create a "Custom Pipeline" service from the OpenMetadata UI (without connection details), then reference it in code:

```python
from metadata.generated.schema.entity.services.pipelineService import PipelineService

PIPELINE_SERVICE_NAME = "custom-pipeline-service"

def ensure_pipeline_service():
    service = metadata.get_by_name(PipelineService, PIPELINE_SERVICE_NAME)
    if not service:
        raise RuntimeError(
            f"Pipeline service '{PIPELINE_SERVICE_NAME}' not found. "
            "Create it from the OpenMetadata UI first."
        )
    return service
```

---

## Fetching Pipelines from the Orchestrator

Abstract the orchestrator's API behind two functions — one for the list, one for the detail. This example uses MageAI's REST API, but the pattern works for any service:

```python
import requests

def _get_headers():
    headers = {}
    token = os.environ.get("SERVICE_API_TOKEN")
    if token:
        headers["OAUTH-TOKEN"] = token
    return headers

def _get_params():
    params = {}
    key = os.environ.get("SERVICE_API_KEY")
    if key:
        params["api_key"] = key
    return params

def get_pipelines():
    """Return the list of pipelines from the orchestrator."""
    resp = requests.get(
        f"{os.environ['SERVICE_API_BASE_URL']}/pipelines",
        headers=_get_headers(),
        params=_get_params(),
    )
    resp.raise_for_status()
    return resp.json().get("pipelines", [])

def get_pipeline_detail(pipeline_id: str):
    """Return block/task-level detail for a single pipeline."""
    resp = requests.get(
        f"{os.environ['SERVICE_API_BASE_URL']}/pipelines/{pipeline_id}",
        headers=_get_headers(),
        params=_get_params(),
    )
    resp.raise_for_status()
    return resp.json().get("pipeline", {})
```

---

## Syncing Pipelines to OpenMetadata

The core logic: iterate over pipelines, build `Task` objects from blocks, resolve schedule metadata, and call `create_or_update` only when something has changed.

```python
from metadata.generated.schema.api.data.createPipeline import CreatePipelineRequest
from metadata.generated.schema.entity.data.pipeline import Task, Pipeline
from metadata.generated.schema.type.tagLabel import (
    TagLabel, TagSource, State, LabelType,
)

def _resolve_schedule(pipeline_data: dict):
    """Extract schedule interval and status from pipeline metadata."""
    schedules = pipeline_data.get("schedules", [])
    active = next((s for s in schedules if s.get("status") == "active"), None)
    schedule = active or next(
        (s for s in schedules if s.get("status") == "inactive"), None
    )
    if not schedule:
        return "no_schedule", None, "no_schedule"
    return (
        schedule.get("schedule_interval", "no_schedule"),
        schedule.get("start_time"),
        schedule.get("status", "no_schedule"),
    )

def _needs_update(existing: Pipeline, pipeline_data: dict) -> bool:
    """Return True if the OpenMetadata record differs from the source."""
    return not (
        existing.description == pipeline_data.get("description")
        and existing.name.root == pipeline_data.get("id")
    )

def sync_pipelines():
    service = ensure_pipeline_service()
    created, updated = 0, 0

    for p in get_pipelines():
        pid = p["uuid"]
        description = p.get("description", "")
        source_url = f"{os.environ['SERVICE_API_BASE_URL']}/pipelines/{pid}"
        interval, start_date, status_tag = _resolve_schedule(p)

        # Build task list from blocks
        detail = get_pipeline_detail(pid)
        tasks = [
            Task(
                name=block["uuid"],
                displayName=block["uuid"],
                taskType=block.get("type", ""),
                fullyQualifiedName=f"{service.name}.{pid}.{block['uuid']}",
                downstreamTasks=block.get("downstream_blocks", []),
            )
            for block in detail.get("blocks", [])
        ]

        # Check for existing record
        existing = metadata.get_by_name(
            Pipeline, fqn=f"{PIPELINE_SERVICE_NAME}.{pid}"
        )

        if existing and not _needs_update(existing, p):
            continue  # No changes — skip

        request = CreatePipelineRequest(
            name=pid,
            displayName=pid,
            description=description,
            tasks=tasks,
            service=PIPELINE_SERVICE_NAME,
            scheduleInterval=interval,
            startDate=start_date,
            sourceUrl=source_url,
            tags=[
                TagLabel(
                    labelType=LabelType.Automated,
                    tagFQN=f"Status.{status_tag}",
                    source=TagSource.Classification,
                    state=State.Confirmed,
                )
            ],
        )
        metadata.create_or_update(request)

        if existing:
            updated += 1
        else:
            created += 1

    return created, updated
```

---

## Adding Lineage

Connecting pipelines to their source and target tables is where the real value emerges — it answers "where does this data come from?" across your entire platform.

```python
from metadata.generated.schema.api.lineage.addLineage import AddLineageRequest
from metadata.generated.schema.type.entityLineage import EntitiesEdge
from metadata.generated.schema.type.entityReference import EntityReference
from metadata.generated.schema.entity.data.table import Table

def add_pipeline_lineage(pipeline_fqn, source_table_fqn, target_table_fqn):
    """Create lineage edges: source_table → pipeline → target_table."""
    pipeline = metadata.get_by_name(Pipeline, pipeline_fqn)
    source = metadata.get_by_name(Table, source_table_fqn)
    target = metadata.get_by_name(Table, target_table_fqn)

    if pipeline and source:
        metadata.add_lineage(
            AddLineageRequest(
                edge=EntitiesEdge(
                    fromEntity=EntityReference(id=source.id, type="table"),
                    toEntity=EntityReference(id=pipeline.id, type="pipeline"),
                )
            )
        )

    if pipeline and target:
        metadata.add_lineage(
            AddLineageRequest(
                edge=EntitiesEdge(
                    fromEntity=EntityReference(id=pipeline.id, type="pipeline"),
                    toEntity=EntityReference(id=target.id, type="table"),
                )
            )
        )
```

---

## Optional: Slack Notifications

A simple notification layer helps surface sync failures without checking logs:

```python
from slack_sdk.webhook import WebhookClient

slack_client = (
    WebhookClient(os.environ["SLACK_WEBHOOK_URL"])
    if os.environ.get("SLACK_WEBHOOK_URL")
    else None
)

def notify(message: str):
    print(message)
    if slack_client:
        slack_client.send(text=message)
```

---

## Putting It All Together

```python
def main():
    if not metadata.health_check():
        notify("Failed to connect to OpenMetadata.")
        return

    try:
        created, updated = sync_pipelines()
        notify(f"Pipeline sync complete — created: {created}, updated: {updated}")
    except Exception as e:
        notify(f"Pipeline sync failed: {e}")
        raise

if __name__ == "__main__":
    main()
```

Schedule this with cron, a CI pipeline, or — if you're already running MageAI — as a standalone pipeline block that fires daily.

---

## Production Checklist

Before promoting this to production, make sure you've covered:

- **Retry logic** — wrap API calls with exponential backoff for transient failures.
- **Change detection** — the `_needs_update` function above is minimal; extend it to compare tasks, schedules, and tags.
- **Logging** — replace `print` statements with structured logging (`logging` module or your observability stack).
- **Idempotency** — `create_or_update` is idempotent by design, but verify your change-detection logic doesn't trigger unnecessary writes.
- **Secrets management** — in production, use a vault or your orchestrator's secrets manager instead of `.env` files.

---

## Wrapping Up

A metadata catalog is only as useful as it is accurate. By automating the sync between your pipeline orchestrator and OpenMetadata, you close the gap between what's running in production and what your team can discover in the catalog.

The pattern shown here — fetch from API, map to OpenMetadata entities, upsert idempotently — generalizes to any orchestrator with a REST interface. Whether you're running MageAI, Prefect, Dagster, or a custom scheduler, the OpenMetadata Python SDK gives you the primitives to keep your catalog in sync without manual intervention.

The end result: better data discovery, reliable lineage, and a governance layer that actually reflects your production pipelines.
