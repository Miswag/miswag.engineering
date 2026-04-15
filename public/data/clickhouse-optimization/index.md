# Over-Partitioning Can Kill Your ClickHouse Performance and Inflate Your Costs

*A practical case study on diagnosing and fixing a silent memory drain*

---

ClickHouse partitioning is one of those features that feels harmless until it isn't. You pick `toYYYYMMDD(timestamp)` because it seems reasonable — one partition per day, clean and organized. Months later, your memory usage is pinned at 8 GiB, your merge queue never settles, and you're considering a tier upgrade you shouldn't need.

This is the story of how daily partitioning quietly consumed gigabytes of memory on our ClickHouse Cloud instance, how we diagnosed it, and how switching to monthly partitioning cut memory by 30% — without changing a single query or losing any functionality.

---

## The Setup

We run ClickHouse Cloud as the analytics backend for a high-traffic e-commerce platform. Event data flows in through RudderStack — page views, screen events, product clicks, searches, cart actions, and dozens of other event types — each landing in its own table. On top of that, dbt models transform and aggregate the raw events into analytics-ready marts.

The architecture works well. But our ClickHouse instance was consistently sitting at **~8 GiB resident memory**, uncomfortably close to the ceiling of our service tier. We needed to understand why — and whether we could bring it down without sacrificing performance.

## The Wrong Suspect: Indexes

The first thing most people check when ClickHouse memory is high is **primary key index size**. ClickHouse loads primary key indexes into RAM, so a large dataset with a wide primary key could theoretically consume significant memory.

We checked. Total primary key memory across all databases: **~0.5 GiB**. That didn't explain the other 7+ GiB.

## The Real Problem: 16,000 Active Parts

We pulled a comprehensive set of diagnostics: jemalloc internals from `system.asynchronous_metrics`, part-level statistics from `system.parts`, and tracked memory from `system.metrics`.

The picture was clear. Our production event database had **16,546 active parts** spread across 165 daily partitions, with an average of 100 parts per partition. A second environment had another 4,794 parts across 163 partitions. With 60+ event tables each creating daily partitions, the part count had grown to an unsustainable level.

Here's how over-partitioning was consuming memory:

**Direct cost — part metadata.** Each active part carries column statistics, min/max indexes, mark file references, and checksums. At roughly 15 KB per part, 16K parts alone account for ~240 MiB of metadata held in memory.

**Indirect cost — merge pressure.** ClickHouse continuously merges small parts into larger ones in the background. With thousands of parts across hundreds of partitions, the merge scheduler is constantly active, allocating and freeing temporary buffers for each merge operation. This churn was consuming an estimated 0.5 GiB in transient merge overhead.

**Hidden cost — allocator fragmentation.** This was the big one. The constant allocation-and-release cycle of merges caused severe **jemalloc fragmentation**. The gap between `jemalloc.active` (memory reserved by the allocator) and `jemalloc.allocated` (memory actually in use) was **1.91 GiB** — 27% fragmentation. Nearly 2 GiB of memory that the process owned but wasn't productively using.

The full pre-migration memory breakdown:

| Component | Usage |
|---|---|
| ClickHouse Core (caches, buffers) | ~3.5 GiB |
| jemalloc fragmentation (active − allocated) | ~1.9 GiB |
| Fixed overhead (code, shared libraries) | ~1.0 GiB |
| Merge overhead (temporary buffers) | ~0.5 GiB |
| jemalloc metadata | ~0.4 GiB |
| Part metadata | ~0.3 GiB |
| **Total MemoryResident** | **~8.0 GiB** |

Over-partitioning was responsible for roughly **2.5–3 GiB** of that total — through metadata, merge overhead, and fragmentation combined.

## Why Over-Partitioning Costs You Money

On ClickHouse Cloud, memory consumption directly affects your bill. Services are sized by memory tier, and exceeding your tier either triggers throttling or forces an upgrade. In our case, 8 GiB of memory usage was pushing us toward a larger (and more expensive) service that we didn't actually need for our query workload.

But the cost isn't just financial:

- **Slower merges.** More parts means more merge work. When merges can't keep up with ingestion, you end up with too many parts per partition, which degrades query performance because ClickHouse must read from and merge results across many small files instead of a few large ones.
- **Higher disk usage.** Small parts compress poorly. ClickHouse's codecs work best with large data blocks — when data is fragmented across thousands of tiny parts, compression ratios suffer. We saw a **58% disk reduction** on one environment just from consolidating parts.
- **Query overhead.** Each query must open file handles, read mark files, and check min/max indexes for every relevant part. With 100 parts per partition, even a simple filtered query does 100× the metadata work compared to a well-merged partition with a single part.

## The Fix: Monthly Partitioning

The change was simple: replace `PARTITION BY toYYYYMMDD(received_at)` with `PARTITION BY toYYYYMM(received_at)`.

Daily partitioning is rarely necessary for event data. The common justification is "we might need to drop a specific day," but in practice, TTL policies handle data expiration and they work at the partition level regardless of granularity. For query filtering, ClickHouse's primary key (typically starting with a date column) provides the same pruning within a monthly partition that a daily partition boundary would.

We projected the savings before committing:

| Component | Daily (Current) | Monthly (Projected) |
|---|---|---|
| Part Metadata | 0.3 GiB | 0.02 GiB |
| jemalloc Fragmentation | 2.2 GiB | 0.6 GiB |
| Merge Overhead | 0.5 GiB | 0.1 GiB |
| **Total Resident** | **~8.0 GiB** | **~5.5 GiB** |

## Validating on Staging First

We tested on a staging environment — same schema, lower volume, 4,794 parts across 60+ tables.

The migration process for each table:

1. Create a new table with identical schema but `PARTITION BY toYYYYMM(received_at)`
2. `INSERT INTO new_table SELECT * FROM old_table`
3. Verify row counts match exactly
4. `RENAME TABLE old_table TO old_table_backup, new_table TO old_table`
5. Drop the backup after verification

### Staging Results: 15 Minutes Post-Migration

| Metric | Before | After | Change |
|---|---|---|---|
| Total Parts | 4,794 | 332 | **−93%** |
| Unique Partitions | 163 | 7 | **−96%** |
| Disk Size | 35.34 MiB | 14.91 MiB | **−58%** |
| jemalloc.allocated | 5.09 GiB | 4.43 GiB | **−660 MiB** |
| MemoryResident | 7.63 GiB | 7.56 GiB | −70 MiB |

The `jemalloc.allocated` drop of 660 MiB confirmed real memory was being freed. The smaller `MemoryResident` drop (70 MiB) was expected — jemalloc doesn't immediately return freed pages to the OS, especially after heavy allocation churn from the migration process itself.

Fragmentation temporarily jumped from 27% to 36%, which is normal: the migration involves creating new tables, bulk-copying data, and dropping old ones — exactly the kind of activity that fragments the heap. We needed time for jemalloc's decay mechanisms to reclaim that space.

## Production Migration and Long-Term Results

With staging validated, we applied the same process to production — 16,546 parts across 165 daily partitions. Same procedure, larger scale.

Here are the results three months after completing the full migration:

### Parts: 90% Reduction

| Environment | Before | After | Change |
|---|---|---|---|
| Production | 16,546 parts / 165 partitions | 1,576 parts / 276 partitions | **−90%** |
| Staging | 4,794 parts / 163 partitions | 598 parts / 18 partitions | **−88%** |

Production went from 100 parts per partition down to 5.7 — a sign that background merges are keeping up effortlessly instead of constantly racing to consolidate an avalanche of small parts.

### Memory: From 8 GiB to 6 GiB

| Metric | Before (Jan 2026) | After (Apr 2026) | Change |
|---|---|---|---|
| MemoryResident | 7.63 GiB | 5.91 GiB | **−1.72 GiB (−23%)** |
| jemalloc.resident | 7.41 GiB | 6.11 GiB | **−1.30 GiB (−18%)** |
| TrackedMemory | 7.19 GiB | 5.96 GiB | **−1.23 GiB (−17%)** |
| jemalloc.allocated | 5.21 GiB | 2.98 GiB | **−2.23 GiB (−43%)** |
| Estimated Metadata Memory | 315 MiB | 41 MiB | **−274 MiB (−87%)** |

The `jemalloc.allocated` drop from 5.21 GiB to 2.98 GiB is the most telling metric — ClickHouse is using **2.2 GiB less actual memory** for the same data and workload. No queries changed. No data was lost. No features were removed.

### A Note on Fragmentation

| Metric | Before | After |
|---|---|---|
| Fragmentation (active − allocated) | 1.91 GiB (27%) | 2.32 GiB (44%) |

The fragmentation percentage went up, but this is misleading. Absolute fragmentation barely changed (~1.9 → 2.3 GiB) while the denominator (`jemalloc.allocated`) dropped sharply, inflating the ratio. What matters is the bottom line: total `MemoryResident` fell from 7.63 to 5.91 GiB. The remaining fragmentation is largely structural — jemalloc's arena overhead relative to a much smaller working set.

## How to Check If You're Over-Partitioned

Run this query against your ClickHouse instance:

```sql
SELECT
    database,
    count() AS total_parts,
    uniqExact(partition) AS unique_partitions,
    round(count() / uniqExact(partition), 2) AS parts_per_partition,
    formatReadableSize(sum(bytes_on_disk)) AS total_size,
    formatReadableSize(count() * 15000) AS estimated_metadata_memory
FROM system.parts
WHERE active
GROUP BY database
ORDER BY total_parts DESC;
```

**Red flags to watch for:**

- **Total parts > 5,000** across the instance — you're likely paying a memory tax.
- **Parts per partition > 20** — merges can't keep up with your ingestion rate at this partition granularity.
- **Hundreds of unique partitions** in a single database — each partition is a merge boundary; ClickHouse cannot merge parts across partitions.

For jemalloc fragmentation, check:

```sql
SELECT
    formatReadableSize(active.value) AS jemalloc_active,
    formatReadableSize(allocated.value) AS jemalloc_allocated,
    formatReadableSize(active.value - allocated.value) AS fragmentation,
    round((active.value - allocated.value) / active.value * 100, 2) AS fragmentation_pct
FROM
    (SELECT value FROM system.asynchronous_metrics
     WHERE metric = 'jemalloc.active') AS active,
    (SELECT value FROM system.asynchronous_metrics
     WHERE metric = 'jemalloc.allocated') AS allocated;
```

If fragmentation exceeds 20–25%, part churn from over-partitioning is a likely contributor.

## Key Takeaways

**Daily partitioning is almost never worth it for event data.** Unless you're routinely dropping individual days via `ALTER TABLE DROP PARTITION`, monthly partitioning gives you the same query pruning benefits with a fraction of the overhead. ClickHouse filters efficiently within partitions using the primary key — you don't need partition boundaries for date filtering.

**The memory cost of parts is mostly indirect.** Direct metadata per part is small (~15 KB). But the cascade effect — merge pressure → temporary allocations → allocator fragmentation — amplifies the cost by 10×. In our case, 274 MiB of metadata savings led to 1.7 GiB of total memory reduction.

**Measure, wait, then measure again.** Our 15-minute post-migration check showed only 70 MiB improvement in `MemoryResident`. Three months later, the same metric showed 1.72 GiB improvement. Memory allocators operate on longer timescales than a quick before/after comparison captures — decay timers, page reclamation, and merge cycle completion all take time.

**Over-partitioning is a cost problem, not just a performance problem.** On ClickHouse Cloud, memory determines your tier and your bill. The 30% memory reduction from this single change was equivalent to a meaningful monthly cost saving — or alternatively, 30% more headroom for actual query workloads without upgrading.

## The Migration Playbook

For teams considering the same change:

1. **Collect baseline metrics.** Query `system.asynchronous_metrics` for jemalloc internals, `system.parts` for part counts by database and table, and `system.metrics` for tracked memory. Save raw numbers.

2. **Start with a low-risk environment.** Migrate staging or a development replica first. Validate row count integrity and confirm the direction of memory movement.

3. **Migrate table by table.** Create the new table, `INSERT INTO ... SELECT * FROM`, verify, rename, drop. Don't try batch DDL operations across all tables at once.

4. **Wait before declaring victory.** Give jemalloc 24–48 hours minimum to stabilize. The real savings materialize over days to weeks.

5. **Monitor parts per partition.** A healthy table should converge to single-digit parts per partition after merges complete. If you're consistently above 10, revisit your partitioning granularity or merge settings.

---

*This optimization took our ClickHouse instance from perpetually bumping against its memory ceiling to running comfortably within budget — no tier upgrade, no configuration tuning, just a better partitioning key. The best infrastructure optimization is often the one you remove, not the one you add.*
