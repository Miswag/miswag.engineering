# Over-Partitioning Can Kill Your ClickHouse Performance and Inflate Your Costs

*A practical case study on diagnosing and fixing a silent memory drain*

---

ClickHouse partitioning is one of those features that feels harmless until it isn't. You pick `toYYYYMMDD(timestamp)` because it seems reasonable — one partition per day, clean and organized. Months later, your active part count is in the tens of thousands, your merge queue never settles, and you're staring at a forced tier upgrade that will roughly double your bill.

This is the story of how daily partitioning quietly accumulated **21,883 active parts** on our ClickHouse Cloud cluster, pushed resident memory to 9.5 GiB, and how switching to a coarser partition period cut memory to 6 GiB — a **37% reduction** — without changing a single query or losing any functionality.

---

## The Setup

We run ClickHouse Cloud as the analytics backend for a high-traffic e-commerce platform. Event data flows in through RudderStack — page views, screen events, product clicks, searches, cart actions, and dozens of other event types — each landing in its own table. On top of that, dbt models transform and aggregate the raw events into analytics-ready marts.

The architecture works well. But our ClickHouse instance was consistently sitting at **~9.5 GiB resident memory**, uncomfortably close to the ceiling of our service tier. We needed to understand why — and whether we could bring it down without sacrificing performance.

## The Wrong Suspect: Indexes

The first thing most people check when ClickHouse memory is high is **primary key index size**. ClickHouse loads primary key indexes into RAM, so a large dataset with a wide primary key could theoretically consume significant memory.

We checked. Total primary key memory across all databases: **~0.5 GiB**. That didn't explain the rest of the footprint.

## The Real Problem: 21,883 Active Parts

We pulled a comprehensive set of diagnostics: jemalloc internals from `system.asynchronous_metrics`, part-level statistics from `system.parts`, and tracked memory from `system.metrics`.

The picture was clear. The cluster as a whole was carrying **21,883 active parts** — and that number sat against two hard ClickHouse limits we were actively at risk of hitting:

- **A service-wide ceiling of ~50,000 parts.** Cross it and the entire cluster stops accepting writes. We were already at 44% of that ceiling and trending upward with every daily partition created.
- **A per-insert limit of 100 partitions.** Each `INSERT` can write into at most 100 distinct partitions in a single block. Our largest event database had 165 daily partitions, which meant any backfill that crossed a wide enough date range would fail outright.

The bulk of those 21,883 parts were concentrated in a single database — our high-volume RudderStack event database, which alone held over 18,000 parts spread across 165 daily partitions. That averaged out to **roughly 110 parts per partition**, on a system where healthy is single digits. With 60+ event tables each creating a new partition every day, the part count had grown to an unsustainable level.

Here's how over-partitioning was consuming memory:

**Direct cost — part metadata.** Each active part carries column statistics, min/max indexes, mark file references, and checksums. At roughly 15 KB per part, 22K parts alone account for ~330 MiB of metadata held permanently in memory.

**Indirect cost — merge pressure.** ClickHouse continuously merges small parts into larger ones in the background. With tens of thousands of parts across hundreds of partitions, the merge scheduler is constantly active, allocating and freeing temporary buffers for each merge operation. That churn is invisible in `system.parts` but very visible to the allocator.

**Hidden cost — allocator fragmentation.** This was the biggest contributor. The constant allocation-and-release cycle of merges caused severe **jemalloc fragmentation** — the gap between memory the allocator had reserved from the OS and memory it was actually using productively. On ClickHouse Cloud, that gap shows up as resident memory you're paying for and can't use.

Combined, these three effects accounted for a meaningful share of the 9.5 GiB resident footprint — and the cascade was driven entirely by partition granularity.

## Why Over-Partitioning Costs You Money

ClickHouse Cloud's pricing model has a sharp non-linearity that makes memory pressure expensive in a way most teams don't realize until they hit it.

A single replica caps out at around **12 GiB of memory**. Below that ceiling, you scale up gracefully — pay a bit more, get a bit more memory, no architectural change. Cross it, and you can no longer scale a single replica further. The only way forward is to add a second replica, and from that point on you're paying for **two replicas** at the new tier, not one.

The math is brutal. If you were paying, say, $300/month for a single 12 GiB replica, the next step up isn't $400 for 16 GiB — it's something like $450 × 2 replicas = **$900/month** for 16 GiB × 2. Roughly triple the cost for marginally more usable headroom. And the second replica isn't buying you redundancy you actually needed; it's a pricing artifact of the tier model.

Sitting at 9.5 GiB of resident memory put us alarmingly close to that wall, and most of that memory wasn't doing useful work — it was part metadata, merge buffers, and fragmentation from too many parts. Hitting the ceiling and being forced into a multi-replica tier would have meant paying double-or-more for capacity we'd already be wasting on partition overhead.

But the cost isn't just financial:

- **Slower merges.** More parts means more merge work. When merges can't keep up with ingestion, you end up with too many parts per partition, which degrades query performance because ClickHouse must read from and merge results across many small files instead of a few large ones.
- **Higher disk usage.** Small parts compress poorly. ClickHouse's codecs work best with large data blocks — when data is fragmented across thousands of tiny parts, compression ratios suffer.
- **Query overhead.** Each query must open file handles, read mark files, and check min/max indexes for every relevant part. With 100+ parts per partition, even a simple filtered query does 100× the metadata work compared to a well-merged partition with a single part.

## The Fix: A Longer Partition Period

The change was simple in shape: replace `PARTITION BY toYYYYMMDD(received_at)` with a coarser partition expression. For our workload that meant `toYYYYMM(received_at)` — monthly. But the principle generalizes.

**The right partition period depends on the table.** What you want is enough partitions to make TTL drops and selective `ALTER TABLE DROP PARTITION` operations tractable, but few enough that merges stay healthy and part counts stay well below the service ceiling. The choice depends on:

- **Data volume.** A table ingesting billions of rows per day might justify monthly partitions; a low-volume dimensional table might do better with a single partition (`PARTITION BY tuple()`) or yearly.
- **Read patterns.** If queries almost always filter by a date range, the primary key handles pruning within partitions — you don't need partition boundaries to match query boundaries.
- **Write patterns.** If you backfill or reprocess by date range, the partition period should align with how you batch those operations.
- **Retention.** If you drop data after 90 days, monthly is the natural choice. If you keep data for years and rarely drop, quarterly or yearly may be enough.

Daily partitioning is rarely the right answer for high-volume event data. The common justification is "we might need to drop a specific day," but in practice, TTL policies handle data expiration at the partition level regardless of granularity, and ClickHouse's primary key (typically starting with a date column) provides query pruning *within* a partition that's just as effective as a partition boundary.

For our RudderStack event tables, monthly was the right call. For lower-volume tables in the same migration, we considered quarterly. The rule of thumb we landed on: **partition periods should produce tens of partitions per table, not hundreds**.

## Production Results

We applied the migration table by table, with verification at each step:

1. Create a new table with identical schema but a coarser `PARTITION BY` expression
2. `INSERT INTO new_table SELECT * FROM old_table`
3. Verify row counts match exactly
4. `RENAME TABLE old_table TO old_table_backup, new_table TO old_table`
5. Drop the backup after verification

### The Memory Arc

Resident memory didn't drop in a single step. It followed this timeline:

| Timing | MemoryResident |
|---|---|
| Before migration | ~9.5 GiB |
| A few days after migration | ~8.0 GiB |
| Three months after migration | ~6.0 GiB |

The immediate post-migration drop of ~1.5 GiB came from eliminating the metadata and live-merge overhead. The additional ~2 GiB that materialized over the following months came from jemalloc gradually releasing fragmented pages back to the OS once the part churn subsided. **Total reduction: 3.5 GiB, or 37% of the original footprint.**

This timing matters. A spot check 24 hours after a migration of this kind will dramatically understate the savings — most of the win is in fragmentation reclamation, and that runs on jemalloc's decay timers, not on event-loop time.

### Parts and Partitions

| Metric | Before | After (3 months in) |
|---|---|---|
| Active parts (migrated database) | ~18,100 | 1,705 |
| Parts per partition | ~110 | ~6 |
| Active parts (cluster total) | 21,883 | ~6,500 |

The migrated database alone shed over 90% of its parts. Cluster-wide, total active parts dropped from a worrying 21,883 (44% of the 50K service limit) to ~6,500 (13%) — comfortably back into safe territory.

Parts-per-partition dropping from ~110 to ~6 is the operational signal that mattered most. It means background merges are keeping up effortlessly instead of constantly racing to consolidate an avalanche of small parts. Three months in, the part count has held steady, which means the system has reached equilibrium under monthly partitioning.

No queries changed. No data was lost. No features were removed.

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

- **Cluster-wide active parts approaching 50,000** — you're in the danger zone for write outages. Anything over ~20K warrants action.
- **Total parts > 5,000 in a single database** — you're paying a meaningful memory tax.
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

**Daily partitioning is almost never worth it for event data.** Unless you're routinely dropping individual days via `ALTER TABLE DROP PARTITION`, a coarser partition period gives you the same query pruning benefits with a fraction of the overhead. ClickHouse filters efficiently within partitions using the primary key — you don't need partition boundaries for date filtering.

**Pick the partition period to match the table, not the calendar.** Monthly is a good default for high-volume event tables, but quarterly or yearly may be better for lower-volume or long-retention data. The target is tens of partitions per table, not hundreds.

**The memory cost of parts is mostly indirect.** Direct metadata per part is small (~15 KB). But the cascade effect — merge pressure → temporary allocations → allocator fragmentation — amplifies the cost by an order of magnitude.

**Measure, wait, then measure again.** A few days after the migration, resident memory had only dropped by ~1.5 GiB. Three months later, it was down by 3.5 GiB total. Memory allocators operate on longer timescales than a quick before/after comparison captures — decay timers, page reclamation, and merge cycle completion all take time.

**Over-partitioning is a cost problem, not just a performance problem.** On ClickHouse Cloud, hitting the single-replica memory ceiling forces you onto a multi-replica tier that can roughly triple your bill. The 37% memory reduction from this single change wasn't just headroom — it was protection against a non-linear cost cliff.

## The Migration Playbook

For teams considering the same change:

1. **Collect baseline metrics.** Query `system.asynchronous_metrics` for jemalloc internals, `system.parts` for part counts by database and table, and `system.metrics` for tracked memory. Save raw numbers.

2. **Pick the right period for each table.** Don't blanket-apply monthly. Match the partition period to the table's volume, retention, and query patterns. The target: tens of partitions per table, single-digit parts per partition at steady state.

3. **Migrate table by table.** Create the new table, `INSERT INTO ... SELECT * FROM`, verify row counts, rename, drop the backup. Don't try batch DDL operations across all tables at once.

4. **Wait before declaring victory.** Give jemalloc 24–48 hours minimum to stabilize, and re-check at the one-month and three-month marks. The real savings materialize over weeks, not minutes.

5. **Monitor parts per partition.** A healthy table should converge to single-digit parts per partition after merges complete. If you're consistently above 10, revisit your partitioning granularity or merge settings.

---

*This optimization took our ClickHouse instance from perpetually bumping against its memory ceiling to running comfortably within budget — no tier upgrade, no configuration tuning, just a better partitioning key. The best infrastructure optimization is often the one you remove, not the one you add.*
