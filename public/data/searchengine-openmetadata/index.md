# Automating Search Engine Index Ingestion to OpenMetadata Using Python SDK

OpenMetadata does a solid job of cataloging databases, pipelines, and dashboards out of the box — but search engines are often left out. If you're running a search engine alongside your data stack, those collections hold valuable schema and usage context that belongs in your metadata catalog.

The problem: there's no native connector for every search engine. The solution: a lightweight Python script that discovers your search engine collections and registers them as search index entities in OpenMetadata via the SDK.

This guide walks through the full implementation — connection setup, field type mapping, sample data extraction, and idempotent sync — so you can drop it into your stack and schedule it.

---

## Why Catalog Search Indexes?

Search collections tend to be invisible to governance tooling. They sit outside the warehouse, have their own schemas, and are usually managed by application engineers rather than data teams. But they're still data assets that deserve discoverability, ownership, and lineage — especially when they're derived from tables in your warehouse.

Bringing your search engine into OpenMetadata gives you a single pane of glass across databases, pipelines, dashboards, *and* search indexes.

---

## Prerequisites

- A running OpenMetadata instance (v1.x+)
- A search engine server with at least one collection
- Python 3.9+
- API credentials for both services

---

## Environment Setup

Install dependencies:

```bash
pip install openmetadata-ingestion <search-engine-client> python-dotenv slack_sdk
```

Store credentials in a `.env` file:

```env
OPENMETADATA_HOST=https://<your-openmetadata-host>/api
OPENMETADATA_JWT_TOKEN=<your_jwt_token>
SEARCH_ENGINE_HOST=<your-search-engine-host>
SEARCH_ENGINE_PORT=<your-search-engine-port>
SEARCH_ENGINE_PROTOCOL=https
SEARCH_ENGINE_API_KEY=<your_api_key>
SLACK_WEBHOOK_URL=<optional_slack_webhook>
```

---

## Establishing Connections

Before writing any sync logic, create a custom search service named `search-engine` from the OpenMetadata UI (no connection properties needed — the SDK handles the rest).

Then initialize both clients:

```python
import os
import logging
from dotenv import load_dotenv
import search_engine_client  # replace with your search engine's Python client
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

SEARCH_SERVICE_NAME = "search-engine"


def setup_connections():
    """Initialize and validate connections to OpenMetadata and the search engine."""
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

    se_client = search_engine_client.Client(
        {
            "nodes": [
                {
                    "host": os.environ["SEARCH_ENGINE_HOST"],
                    "port": os.environ["SEARCH_ENGINE_PORT"],
                    "protocol": os.environ["SEARCH_ENGINE_PROTOCOL"],
                }
            ],
            "api_key": os.environ["SEARCH_ENGINE_API_KEY"],
            "connection_timeout_seconds": 5,
        }
    )
    se_client.collections.retrieve()  # Fail fast if unreachable
    logger.info("Search engine connection verified")

    return metadata, se_client
```

---

## Mapping Search Engine Field Types

Search engines and OpenMetadata use different type systems. This mapping handles the conversion, defaulting to `TEXT` for anything unrecognized:

```python
SEARCH_ENGINE_TYPE_MAP = {
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


def map_field_type(field_type: str) -> str:
    return SEARCH_ENGINE_TYPE_MAP.get(field_type.lower(), "TEXT")
```

---

## Extracting Sample Documents

A sample document in the catalog helps consumers understand what a collection actually contains — much more useful than a bare schema. The function below fetches a single document and strips out vector fields and oversized values:

```python
def get_sample_document(se_client, collection_name: str) -> dict:
    """Fetch and clean a single sample document from a search engine collection."""
    try:
        results = se_client.collections[collection_name].documents.search(
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
        logger.warning(f"Could not fetch sample for '{collection_name}': {e}")
        return {"error": str(e)}
```

---

## Syncing Collections to OpenMetadata

The core function iterates over every search engine collection, converts its schema to OpenMetadata's `SearchIndexField` model, and calls `create_or_update`. Vector/embedding fields are filtered out to keep the catalog clean.

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


def sync_collections(metadata, se_client):
    """Discover search engine collections and register them as search indexes."""
    collections = se_client.collections.retrieve()
    logger.info(f"Found {len(collections)} collections")

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
            f"Search index collection '{name}' — "
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
            sample = get_sample_document(se_client, name)
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

If your search engine collections are populated from warehouse tables (a common pattern), you can express that relationship as lineage:

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
        metadata, se_client = setup_connections()
        registered, total = sync_collections(metadata, se_client)
        notify(f"Search engine sync complete — {registered}/{total} collections registered")
    except Exception as e:
        notify(f"Search engine sync failed: {e}")
        logger.exception("Fatal error during sync")

if __name__ == "__main__":
    main()
```

Schedule this with cron, Airflow, or any scheduler you already run. A daily cadence works for most teams; increase frequency if collections change often.

---

## Handling Edge Cases

### Vector and Embedding Fields

Many modern search engines support vector search, meaning collections increasingly contain high-dimensional embedding arrays. These fields are noisy in a metadata catalog — hundreds of floats don't help anyone understand the data. The sync logic applies a heuristic filter: fields with vector-related names or numeric array types are silently skipped.

### Large Collections

The script fetches only one sample document per collection and truncates oversized string values. This keeps the OpenMetadata API calls lightweight while still providing meaningful context to catalog consumers.

### Partial Failures

Each collection is processed independently. A schema mapping error or API failure for one collection is logged and skipped — it doesn't block the rest of the sync.

---

## Production Checklist

Before scheduling this in production:

- **Retry logic** — wrap the search engine and OpenMetadata API calls with exponential backoff.
- **Change detection** — compare existing OpenMetadata records to incoming data and skip unchanged collections to reduce API load.
- **Secrets management** — move from `.env` files to your orchestrator's secrets manager or a vault.
- **Monitoring** — route the Slack notifications to an alerts channel and set up a dead-man's-switch if the job stops running.
- **Lineage automation** — if you have a mapping between warehouse tables and search engine collections (e.g., in a config file or naming convention), automate the `add_search_index_lineage` calls as part of the sync.

---

## Wrapping Up

Search engines are first-class data assets — they deserve the same catalog coverage as your tables and pipelines. By automating search engine collection ingestion into OpenMetadata, you close a common gap in metadata coverage and give your team a single place to discover, document, and govern every component of the data stack.

The pattern generalizes to any search engine with a schema API — whether open-source or custom-built — and can be integrated the same way: discover collections, map field types, register as search index entities, and attach lineage. The OpenMetadata Python SDK handles the heavy lifting; you just need to build the bridge.
