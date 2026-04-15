# Loading Large MySQL Tables Into ClickHouse Without Blocking Production — A MageAI Pipeline Pattern

*A chunked, memory-efficient full-load pattern for replicating MySQL tables into ClickHouse using query-based extraction and MageAI orchestration.*

---

If you run ClickHouse for analytics alongside MySQL as your OLTP database, you've probably dealt with this: how do you replicate large tables from MySQL into ClickHouse without killing your production database, blowing up your orchestrator's memory, or spending hours debugging silent data loss?

This article walks through the architecture, trade-offs, and battle-tested patterns I've developed for full-load replication from MySQL to ClickHouse using MageAI as the orchestration layer. No CDC, no binlog, no replica required — just well-designed query-based extraction that respects your production MySQL instance.

Whether you're running 500K rows or 50M, these patterns will save you from the pitfalls I've already hit.

---

## The Problem With the Naive Approach

The textbook way to move data between databases in an orchestrator like MageAI, Airflow, or Dagster looks something like this:

**Block 1 — Data Loader:** `SELECT * FROM big_table` → materialize entire result into a DataFrame.

**Block 2 — Data Exporter:** Take that DataFrame → `INSERT INTO clickhouse_table`.

This works fine for small tables. But once your table crosses the 5M-row or 1GB threshold, things break down fast:

**MySQL side:** A single `SELECT *` on a large table under `REPEATABLE READ` (InnoDB's default isolation) forces MySQL to maintain an MVCC snapshot for the entire duration of the query. On a 10-minute extraction, that means undo logs stay alive, the history list grows, buffer pool pressure increases, and the purge thread stalls. Your production app starts feeling the drag.

**Orchestrator side:** MageAI (and most orchestrators) pass data between blocks by materializing the full DataFrame in memory. A 10M-row table sitting in RAM between a loader block and an exporter block can easily OOM your worker process — and you won't know until it crashes mid-pipeline.

**ClickHouse side:** A single massive `INSERT` can spike memory on the ClickHouse server and, depending on your table engine, create write pressure that affects query performance.

I needed something better.

---

## Server-Side Cursor vs. Normal Query: Why It Matters

Before diving into the pipeline design, it's worth understanding a fundamental MySQL client behavior that most engineers don't think about until it bites them.

When you execute a normal query through a MySQL client — whether via SQLAlchemy, `mysql-connector-python`, or `pymysql` — the default behavior is **client-side buffering**. The MySQL server executes the query, serializes the entire result set, and sends it all to the client. The client library then buffers every row in memory before your application code sees the first row. A `SELECT *` on a 10M-row table means 10M rows land in your Python process's RAM before `pd.read_sql()` returns.

A **server-side cursor** (also called `SSCursor` or `SSDictCursor` in pymysql) changes this behavior. Instead of buffering the entire result, the client fetches rows **on demand** from the server — typically one row or a small batch at a time. Your application processes rows as they arrive, and memory stays flat regardless of table size.

Server-side cursors sound like the perfect solution, but they come with trade-offs. The MySQL connection remains locked for the entire duration of the fetch — you can't run other queries on that connection until you've consumed or closed the cursor. If your processing is slow (say, a ClickHouse insert takes a few seconds per batch), the MySQL connection sits open and occupied for the full pipeline run. Long-lived connections under heavy load can trigger `wait_timeout` kills, and if the pipeline crashes mid-cursor, the connection may not be released cleanly.

### What I Chose Instead: Chunked Short-Lived Queries

Rather than holding a single long-lived server-side cursor open for the entire extraction, I use **keyset pagination with short-lived connections**. Each chunk is a new, independent `SELECT` query:

```python
query = text(f"""
    SELECT
        order_id, customer_id, item_id, quantity,
        unit_price, discount_amount, total_cost,
        order_status, payment_method, shipping_address_id,
        created_at, updated_at
    FROM {MYSQL_TABLE}
    WHERE {PK_COLUMN} > :last_pk
    ORDER BY {PK_COLUMN} ASC
    LIMIT :batch_size
""")

with engine.connect() as conn:
    conn.execute(text("SET SESSION TRANSACTION ISOLATION LEVEL READ UNCOMMITTED"))
    conn.execute(text(f"SET SESSION net_read_timeout = {MYSQL_FETCH_TIMEOUT}"))
    conn.execute(text(f"SET SESSION net_write_timeout = {MYSQL_FETCH_TIMEOUT}"))
    df = pd.read_sql(query, conn, params={"last_pk": last_pk, "batch_size": BATCH_SIZE})
```

Each batch opens a connection, reads a fixed number of rows, closes the connection, then inserts to ClickHouse. The connection is occupied for seconds, not minutes. If ClickHouse is slow or the pipeline crashes, no MySQL connection is left dangling. And because each query uses the primary key index via keyset pagination, it's an efficient range scan every time.

The comparison:

| | Server-Side Cursor | Chunked Short-Lived Queries |
|---|---|---|
| Memory | Flat (rows streamed on demand) | Flat (one chunk at a time) |
| MySQL connection | Locked for entire extraction | Locked for seconds per chunk |
| Failure behavior | Connection may leak on crash | Clean — connection scoped to `with` block |
| MySQL load | Single long query | Multiple short queries with sleep between |
| Complexity | Requires careful cursor management | Simple pagination loop |

For analytical extraction against a production MySQL instance, the chunked approach gives you the same memory benefit as a server-side cursor without the connection management headaches.

---

## The Architecture: Chunked Read-Write in a Single Block

The core idea is simple: **read a chunk, write the chunk, free the chunk, repeat.** No intermediate materialization, no block-to-block handoff, and constant memory usage regardless of table size.

```
┌─────────────────────────────────────────────────────────┐
│                    MageAI Custom Block                   │
│                                                         │
│   ┌──────────┐     ┌───────────┐     ┌──────────────┐  │
│   │  MySQL    │────▶│ Transform │────▶│  ClickHouse  │  │
│   │  Chunk N  │     │ (nulls)   │     │  Batch Insert│  │
│   └──────────┘     └───────────┘     └──────────────┘  │
│        │                                     │          │
│        ▼                                     ▼          │
│   sleep(0.3s)                          checkpoint       │
│        │                                     │          │
│        └─────────── next chunk ◀─────────────┘          │
└─────────────────────────────────────────────────────────┘
```

### Why a Single Block?

MageAI's block-to-block handoff expects a complete DataFrame as output from each block. If you split reading and writing into separate blocks, the orchestrator would need to hold the entire dataset in memory between them — defeating the purpose of chunking. By combining both operations in one block, we maintain a read-write loop where only one chunk lives in memory at any time.

Here's the skeleton of the main loop:

```python
while True:
    batch_num += 1

    # ── Read chunk ──
    with engine.connect() as conn:
        conn.execute(text("SET SESSION TRANSACTION ISOLATION LEVEL READ UNCOMMITTED"))
        df = pd.read_sql(query, conn, params={"last_pk": last_pk, "batch_size": BATCH_SIZE})

    if df.empty:
        break

    # ── Transform: fill nulls ──
    df = _fill_nulls(df)

    # ── Write chunk ──
    client.insert_df(f"{CH_DATABASE}.{CH_TABLE}", df)

    # ── Advance cursor ──
    last_pk = int(df[PK_COLUMN].max())
    del df  # Free memory explicitly

    if last_pk >= mysql_max_pk:
        break

    time.sleep(SLEEP_BETWEEN)
```

The `del df` after each insert is intentional — it signals to Python's garbage collector that the previous chunk's memory can be reclaimed immediately, rather than waiting for the next loop iteration to overwrite the variable.

---

## Keyset Pagination Over OFFSET

The most critical design decision is how you paginate through the source table. There are two options:

**OFFSET-based:** `SELECT * FROM orders LIMIT 50000 OFFSET 500000`

**Keyset-based:** `SELECT * FROM orders WHERE order_id > 500000 ORDER BY order_id LIMIT 50000`

OFFSET pagination has a hidden cost that gets worse with every page. MySQL must scan and discard all rows before the offset, meaning page 100 of a 50K-batch requires scanning 5M rows just to skip them. On a 10M-row table, the later batches become painfully slow.

Keyset pagination uses the primary key index directly. Every batch is an efficient range scan regardless of how deep into the table you are. The performance is consistent from the first batch to the last.

---

## Handling Composite Primary Keys

Not all tables have a simple auto-increment `order_id` column. Many production tables use composite primary keys — for example, an inventory table keyed on `(product_id, variant_id, size_id, warehouse_id)`.

The solution is **tuple comparison**, which MySQL supports natively and evaluates using lexicographic ordering — exactly matching how the composite PK's B-tree index is sorted:

```sql
SELECT *
FROM inventory
WHERE (product_id, variant_id, size_id, warehouse_id)
    > (:last_product_id, :last_variant_id, :last_size_id, :last_warehouse_id)
ORDER BY product_id, variant_id, size_id, warehouse_id ASC
LIMIT :batch_size
```

This gives you the same efficient index range scan as single-column keyset pagination, but across multiple columns. The cursor advances by capturing the composite key values from the last row of each batch:

```python
last_row = df.iloc[-1]
last_pk = tuple(int(last_row[col]) for col in PK_COLUMNS)
```

There's one important caveat: since there's no single `max(id)` to compare against for a "done" signal, use the batch size as the indicator. If a batch returns fewer rows than the configured limit, it's the last page.

---

## The Case for READ UNCOMMITTED

This is the most debated decision in this pipeline design. Conventional wisdom says: never use `READ UNCOMMITTED` because dirty reads are dangerous. That's correct advice — for OLTP workloads. For analytical extraction, the calculus is different.

Under `REPEATABLE READ`, MySQL maintains an MVCC snapshot for the entire duration of your read session. For a multi-minute extraction running across many chunks, this means:

- **Undo log bloat** — the history list length grows because InnoDB can't purge old row versions while your snapshot is active.
- **Buffer pool pressure** — old row versions stay pinned in the buffer pool.
- **Purge thread stalling** — cleanup operations queue up behind your long-running consistent view.

`READ UNCOMMITTED` skips the MVCC snapshot entirely. No undo log retention, no history list growth, no purge stalling. The trade-off is theoretically reading an uncommitted row — but in practice, the window of an in-flight transaction overlapping with your read on a specific row is vanishingly small. And even if it happens, you're feeding an analytics warehouse that runs on eventual consistency anyway.

Notice in the pipeline code, we set the isolation level per connection, per chunk:

```python
with engine.connect() as conn:
    conn.execute(text("SET SESSION TRANSACTION ISOLATION LEVEL READ UNCOMMITTED"))
    conn.execute(text(f"SET SESSION net_read_timeout = {MYSQL_FETCH_TIMEOUT}"))
    conn.execute(text(f"SET SESSION net_write_timeout = {MYSQL_FETCH_TIMEOUT}"))
    df = pd.read_sql(query, conn, params={...})
```

The `SESSION` scope ensures we never affect other connections on the same MySQL instance. The generous `net_read_timeout` and `net_write_timeout` prevent MySQL from killing our connection during larger batch reads — a common failure mode with the default 30-second timeout.

This isn't a theoretical optimization. On a production MySQL instance handling live traffic, switching from `REPEATABLE READ` to `READ UNCOMMITTED` for extraction workloads measurably reduced undo log pressure during peak hours.

---

## Null Handling Before ClickHouse Insert

ClickHouse is strict about types. A `NULL` value in a pandas DataFrame for a non-Nullable ClickHouse column will cause the entire batch insert to fail. I handle this with explicit null-fill rules defined declaratively at the top of the pipeline:

```python
NUMERIC_COLS = [
    'customer_id', 'item_id', 'quantity', 'unit_price',
    'discount_amount', 'total_cost', 'shipping_address_id',
]

STRING_COLS = [
    'order_status', 'payment_method',
]

DATETIME_COLS = [
    'created_at', 'updated_at',
]
```

Then a single transformation function applies the rules before each insert:

```python
def _fill_nulls(df: pd.DataFrame) -> pd.DataFrame:
    for col in NUMERIC_COLS:
        if col in df.columns:
            df[col] = df[col].fillna(0)

    for col in STRING_COLS:
        if col in df.columns:
            df[col] = df[col].fillna('')

    for col in DATETIME_COLS:
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors='coerce').fillna(EPOCH)

    return df
```

The `errors='coerce'` parameter on datetime columns is important — it converts any malformed datetime strings to `NaT` first, which then gets replaced by the epoch sentinel value. This prevents a single bad datetime string from crashing the entire batch.

Defining the column groups at the top of the file rather than inline makes it immediately visible which columns get which treatment, and easy to update when the schema changes.

---

## Choosing the Right Approach for Your Table Size

Not every table needs the chunked approach. Over-engineering small table loads adds complexity without benefit. Here's my decision framework:

**Under 5M rows / under 1GB** — Use the simple two-block approach (loader block → exporter block). It's simpler to debug, gives you MageAI's native block-level observability and retry, and lets you preview data between blocks. The memory overhead is acceptable.

**Over 5M rows / multi-GB** — Use the chunked single-block approach. The memory savings and reduced MySQL pressure are worth the trade-off in observability. Add checkpoint tracking so failed runs can be diagnosed quickly.

**Over 50M rows** — Consider the same chunked approach but with resumability: instead of truncating on every run, check the last loaded cursor position and resume from there. This turns a potentially hour-long full reload into a quick catch-up after a failure.

---

## Production Configuration Recommendations

Based on running these pipelines across dozens of tables in a high-traffic environment, here are the settings I've converged on:

**Batch size: 50,000–500,000 rows.** Smaller batches mean more round-trips but lower memory. Larger batches are more efficient but increase the blast radius of a failure. I typically use 200K–500K depending on column count and average row width.

**Sleep interval: 0.2–0.5 seconds.** This gives MySQL a brief window to process other queries between extraction batches. During off-peak hours, you can reduce this to near-zero. During peak, increase it.

**Timeout settings:** Set `net_read_timeout` and `net_write_timeout` generously (300+ seconds) to prevent MySQL from killing your connection during large batch reads.

**ClickHouse insert strategy:** Use `insert_df` from `clickhouse-connect` for batch inserts. Avoid row-by-row inserts (massive overhead) and avoid single multi-million-row inserts (memory spike and potential timeout).

---

## Summary

Building reliable data replication between MySQL and ClickHouse isn't about choosing the fanciest tool — it's about understanding the pressure points on each system and designing around them. Chunked short-lived queries protect MySQL from both connection pressure and MVCC overhead. Single-block read-write loops protect your orchestrator from memory exhaustion. Explicit null handling protects ClickHouse from type mismatches. And proper observability protects you from silent failures.

These patterns handle everything from 50K-row reference tables to multi-million-row transactional tables with the same codebase and configuration-driven approach. No CDC infrastructure, no binlog parsing, no read replicas — just well-designed queries against a single MySQL instance.

The best pipeline isn't the cleverest one. It's the one that runs every day without waking anyone up.

---
