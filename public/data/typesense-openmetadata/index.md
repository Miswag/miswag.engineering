# Automating Typesense Search Index Ingestion to OpenMetadata Using Python SDK

OpenMetadata does a solid job of cataloging databases, pipelines, and dashboards out of the box — but search engines are often left out. If you're running Typesense alongside your data stack, those collections hold valuable schema and usage context that belongs in your metadata catalog.

The problem: there's no native Typesense connector. The solution: a lightweight Python script that discovers your Typesense collections and registers them as search index entities in OpenMetadata via the SDK.

This guide walks through the full implementation — connection setup, field type mapping, sample data extraction, and idempotent sync — so you can drop it into your stack and schedule it.

---

## Why Catalog Search Indexes?

Search collections tend to be invisible to governance tooling. They sit outside the warehouse, have their own schemas, and are usually managed by application engineers rather than data teams. But they're still data assets that deserve discoverability, ownership, and lineage — especially when they're derived from tables in your warehouse.

Bringing Typesense into OpenMetadata gives you a single pane of glass across databases, pipelines, dashboards, *and* search indexes.

---

## Prerequisites

- A running OpenMetadata instance (v1.x+)
- A Typesense server with at least one collection
- Python 3.9+
- API credentials for both services

---

## Environment Setup

Install dependencies:

```bash
pip install openmetadata-ingestion typesense python-dotenv slack_sdk
```

Store credentials in a `.env` file:

```env
OPENMETADATA_HOST=https://<your-openmetadata-host>/api
OPENMETADATA_JWT_TOKEN=<your_jwt_token>
TYPESENSE_HOST=<your-typesense-host>
TYPESENSE_PORT=8108
TYPESENSE_PROTOCOL=https
TYPESENSE_API_KEY=<your_api_key>
SLACK_WEBHOOK_URL=<optional_slack_webhook>
```

---

## Establishing Connections

Before writing any sync logic, create a custom search service named `typesense` from the OpenMetadata UI (no connection properties needed — the SDK handles the rest).

Then initialize both clients:

```python
import os
import logging
from dotenv import load_dotenv
import typesense
from metadata.generated.schema.entity.services.connections.metadata.openMetadataConnection import (
    OpenMetadataConnection,
)
from metadata.generated.schema.security.client.openMetadataJWTClientConfig import (
    OpenMetadataJWTClientConfig,
)
from metadata.ingestion.ometa.ometa_api import OpenMetadata

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

SEARCH_SERVICE_NAME = "typesense"


def setup_connections():
    """Initialize and validate connections to OpenMetadata and Typesense."""
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
    logger.info("OpenMetadata connection verified")

    ts_client = typesense.Client(
        {
            "nodes": [
                {
                    "host": os.environ["TYPESENSE_HOST"],
                    "port": os.environ["TYPESENSE_PORT"],
                    "protocol": os.environ["TYPESENSE_PROTOCOL"],
                }
            ],
            "api_key": os.environ["TYPESENSE_API_KEY"],
            "connection_timeout_seconds": 5,
        }
    )
    ts_client.collections.retrieve()  # Fail fast if unreachable
    logger.info("Typesense connection verified")

    return metadata, ts_client
```

---

## Mapping Typesense Field Types

Typesense and OpenMetadata use different type systems. This mapping handles the conversion, defaulting to `TEXT` for anything unrecognized:

```python
TYPESENSE_TYPE_MAP = {
    "string": "TEXT",
    "int32": "INTEGER",
    "int64": "LONG",
    "float": "FLOAT",
    "bool": "BOOLEAN",
    "bool[]": "ARRAY",
    "string[]": "ARRAY",
    "int32[]": "ARRAY",
    "int64[]": "ARRAY",
    "float[]": "ARRAY",
    "geopoint": "GEO_POINT",
    "object": "STRUCT",
    "object[]": "ARRAY",
    "auto": "TEXT",
}


def map_field_type(typesense_type: str) -> str:
    return TYPESENSE_TYPE_MAP.get(typesense_type.lower(), "TEXT")
```

---

## Extracting Sample Documents

A sample document in the catalog helps consumers understand what a collection actually contains — much more useful than a bare schema. The function below fetches a single document and strips out vector fields and oversized values:

```python
def get_sample_document(ts_client, collection_name: str) -> dict:
    """Fetch and clean a single sample document from a Typesense collection."""
    try:
        results = ts_client.collections[collection_name].documents.search(
            {"q": "*", "per_page": 1}
        )
        hits = results.get("hits", [])
        if not hits:
            return {"note": "No documents found in collection"}

        raw = hits[0].get("document", {})

        # Filter out vector fields and oversized values
        cleaned = {}
        for key, value in raw.items():
            if isinstance(value, list) and len(value) > 10:
                if all(isinstance(x, (int, float)) for x in value[:10]):
                    continue  # Skip embedding vectors
            if isinstance(value, str) and len(value) > 500:
                cleaned[key] = f"{value[:80]}... (truncated)"
            else:
                cleaned[key] = value

        return cleaned or {"note": "All fields were filtered (likely vector-only)"}

    except Exception as e:
        logger.warning(f"Could not fetch sample for {collection_name}: {e}")
        return {"error": str(e)}
```

---

## Syncing Collections to OpenMetadata

The core function iterates over every Typesense collection, converts its schema to OpenMetadata's `SearchIndexField` model, and calls `create_or_update`. Vector/embedding fields are filtered out to keep the catalog clean.

```python
import datetime
from metadata.generated.schema.entity.data.searchIndex import (
    SearchIndexField,
    SearchIndex,
    SearchIndexSampleData,
)
from metadata.generated.schema.api.data.createSearchIndex import (
    CreateSearchIndexRequest,
)

# Fields matching these patterns are skipped (vectors, embeddings)
_VECTOR_KEYWORDS = {"vector", "embed"}


def _is_vector_field(name: str, field_type: str) -> bool:
    """Heuristic: skip fields that are likely embedding vectors."""
    name_lower = name.lower()
    if any(kw in name_lower for kw in _VECTOR_KEYWORDS):
        return True
    # Numeric arrays (int32[], int64[], float[]) are usually vectors
    if field_type.endswith("[]") and field_type not in ("string[]", "bool[]"):
        return True
    return False


def sync_collections(metadata, ts_client):
    """Discover Typesense collections and register them as search indexes."""
    collections = ts_client.collections.retrieve()
    logger.info(f"Found {len(collections)} Typesense collections")

    registered = 0

    for collection in collections:
        name = collection.get("name")
        if not name:
            continue

        fields = collection.get("fields", [])
        if not fields:
            logger.warning(f"Skipping {name} — no fields defined")
            continue

        # Convert fields, filtering out vectors and suspect entries
        om_fields = []
        for f in fields:
            fname, ftype = f.get("name"), f.get("type")
            if not fname or not ftype:
                continue
            if _is_vector_field(fname, ftype):
                continue
            if len(fname) > 50:
                continue  # Likely serialized data, not a real field name

            om_fields.append(
                SearchIndexField(
                    name=fname,
                    dataType=map_field_type(ftype),
                    description=f"Field type: {ftype}",
                )
            )

        if not om_fields:
            logger.warning(f"Skipping {name} — no valid fields after filtering")
            continue

        # Build collection-level metadata
        settings = {
            "name": name,
            "type": collection.get("type", ""),
            "num_documents": collection.get("num_documents", 0),
        }
        created_at = collection.get("created_at")
        if created_at:
            try:
                dt = datetime.datetime.fromtimestamp(int(created_at))
                settings["created_at"] = dt.strftime("%Y-%m-%d %H:%M:%S")
            except (ValueError, TypeError):
                pass

        description = (
            f"Typesense collection '{name}' — "
            f"{settings['num_documents']} documents"
        )

        try:
            request = CreateSearchIndexRequest(
                name=name,
                displayName=name,
                description=description,
                service=SEARCH_SERVICE_NAME,
                searchIndexSettings=settings,
                fields=om_fields,
            )
            metadata.create_or_update(request)
            logger.info(f"Registered: {name}")

            # Attach sample data
            sample = get_sample_document(ts_client, name)
            if sample and "error" not in sample:
                index_entity = metadata.get_by_name(
                    entity=SearchIndex,
                    fqn=f"{SEARCH_SERVICE_NAME}.{name}",
                )
                metadata.ingest_search_index_sample_data(
                    search_index=index_entity,
                    sample_data=SearchIndexSampleData(
                        messages=[str(sample)]
                    ),
                )
                logger.info(f"Sample data added for: {name}")

            registered += 1

        except Exception as e:
            logger.error(f"Failed to register {name}: {e}")

    logger.info(f"Sync complete — {registered}/{len(collections)} collections registered")
    return registered, len(collections)
```

---

## Adding Lineage

If your Typesense collections are populated from warehouse tables (a common pattern), you can express that relationship as lineage:

```python
from metadata.generated.schema.api.lineage.addLineage import AddLineageRequest
from metadata.generated.schema.type.entityLineage import EntitiesEdge
from metadata.generated.schema.type.entityReference import EntityReference
from metadata.generated.schema.entity.data.table import Table


def add_search_index_lineage(metadata, source_table_fqn: str, index_fqn: str):
    """Create a lineage edge: source_table → search_index."""
    source = metadata.get_by_name(Table, source_table_fqn)
    index = metadata.get_by_name(SearchIndex, index_fqn)

    if source and index:
        metadata.add_lineage(
            AddLineageRequest(
                edge=EntitiesEdge(
                    fromEntity=EntityReference(id=source.id, type="table"),
                    toEntity=EntityReference(id=index.id, type="searchIndex"),
                )
            )
        )
        logger.info(f"Lineage added: {source_table_fqn} → {index_fqn}")
```

---

## Notifications

A thin wrapper around Slack for observability:

```python
from slack_sdk.webhook import WebhookClient

slack_client = (
    WebhookClient(os.environ["SLACK_WEBHOOK_URL"])
    if os.environ.get("SLACK_WEBHOOK_URL")
    else None
)


def notify(message: str):
    logger.info(message)
    if slack_client:
        slack_client.send(text=message)
```

---

## Orchestrating the Sync

```python
def main():
    try:
        metadata, ts_client = setup_connections()
        registered, total = sync_collections(metadata, ts_client)
        notify(f"Typesense sync complete — {registered}/{total} collections registered")
    except Exception as e:
        notify(f"Typesense sync failed: {e}")
        logger.exception("Fatal error during sync")

if __name__ == "__main__":
    main()
```

Schedule this with cron, Airflow, MageAI, or any scheduler you already run. A daily cadence works for most teams; increase frequency if collections change often.

---

## Handling Edge Cases

### Vector and Embedding Fields

Typesense's vector search feature means collections increasingly contain high-dimensional embedding arrays. These fields are noisy in a metadata catalog — hundreds of floats don't help anyone understand the data. The sync logic applies a heuristic filter: fields with vector-related names or numeric array types are silently skipped.

### Large Collections

The script fetches only one sample document per collection and truncates oversized string values. This keeps the OpenMetadata API calls lightweight while still providing meaningful context to catalog consumers.

### Partial Failures

Each collection is processed independently. A schema mapping error or API failure for one collection is logged and skipped — it doesn't block the rest of the sync.

---

## Production Checklist

Before scheduling this in production:

- **Retry logic** — wrap the Typesense and OpenMetadata API calls with exponential backoff.
- **Change detection** — compare existing OpenMetadata records to incoming data and skip unchanged collections to reduce API load.
- **Secrets management** — move from `.env` files to your orchestrator's secrets manager or a vault.
- **Monitoring** — route the Slack notifications to an alerts channel and set up a dead-man's-switch if the job stops running.
- **Lineage automation** — if you have a mapping between warehouse tables and Typesense collections (e.g., in a config file or naming convention), automate the `add_search_index_lineage` calls as part of the sync.

---

## Wrapping Up

Search engines are first-class data assets — they deserve the same catalog coverage as your tables and pipelines. By automating Typesense collection ingestion into OpenMetadata, you close a common gap in metadata coverage and give your team a single place to discover, document, and govern every component of the data stack.

The pattern generalizes beyond Typesense. Any search engine with a schema API — Meilisearch, Solr, or a custom index — can be integrated the same way: discover collections, map field types, register as search index entities, and attach lineage. The OpenMetadata Python SDK handles the heavy lifting; you just need to build the bridge.
