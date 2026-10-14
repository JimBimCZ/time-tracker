# System design

![System design](system-design.png)

<!-- Rendered from the Mermaid source below. Regenerate after edits:
     npx @mermaid-js/mermaid-cli -i <source>.mmd -o assets/system-design.png -w 1800 -s 2 -b white -->

```mermaid
flowchart TB
    UI["React UI<br/>(running clock from BE started_at)"]

    subgraph GW["API Gateway"]
        Kong["Kong<br/>routing · load balancing · rate limiting<br/>JWT verify (ES256 public key)"]
        Redis[("Redis<br/>rate-limit counters")]
        Kong --- Redis
    end

    UI -->|HTTPS| Kong

    subgraph AUTH["Auth service"]
        AuthAPI["Auth API"]
        AuthDB[("Postgres<br/>users · refresh_tokens · outbox")]
        AuthAPI --> AuthDB
    end

    subgraph CAT["Catalog service"]
        CatAPI["Catalog API"]
        CatDB[("Postgres<br/>companies · projects · tickets · outbox")]
        CatAPI --> CatDB
    end

    subgraph TRK["Tracking service"]
        TrkAPI["Tracking API<br/>POST /tracking/timer/start|stop → 202<br/>GET /tracking/timer/current · /tracking/entries CRUD"]
        TrkWorker["Timer worker<br/>dedupe · auto-stop · retry unknown ticket"]
        TrkDB[("Postgres<br/>time_entries · tickets_local<br/>processed_events · outbox")]
        TrkAPI --> TrkDB
        TrkWorker --> TrkDB
    end

    subgraph REP["Reporting service"]
        RepConsumer["Event consumer<br/>upsert by id"]
        RepBatch["Hourly batch<br/>split at month boundary (user TZ)<br/>recompute current + previous month"]
        RepAPI["Reporting API<br/>past months"]
        RepDB[("Postgres<br/>entries · names · users(tz)<br/>monthly_totals · processed_events")]
        RepConsumer --> RepDB
        RepBatch --> RepDB
        RepAPI --> RepDB
    end

    Kong -->|/auth| AuthAPI
    Kong -->|/catalog| CatAPI
    Kong -->|/tracking<br/>current month live| TrkAPI
    Kong -->|/reporting| RepAPI

    subgraph KAFKA["Kafka (partition key = user_id)"]
        TUser{{user.events}}
        TCat{{catalog.events}}
        TCmd{{timer.commands}}
        TDLQ{{timer.commands.dlq}}
        TTrk{{tracking.events}}
    end

    AuthDB -. outbox relay .-> TUser
    CatDB -. outbox relay .-> TCat
    TrkAPI -->|timer.start / timer.stop| TCmd
    TrkDB -. outbox relay .-> TTrk

    TCmd --> TrkWorker
    TrkWorker -->|unknown ticket after ~30s| TDLQ
    TCat -->|ticket.changed| TrkWorker
    TUser -->|user.changed / user.deleted| RepConsumer
    TUser -->|user.deleted| CatAPI
    TUser -->|user.deleted| TrkWorker
    TCat -->|company/project/ticket.changed| RepConsumer
    TTrk -->|entry.changed| RepConsumer
```

## Key flows

1. **Start timer:** UI → Kong → `POST /tracking/timer/start` (with a UUID the UI generates) → `202`. The command goes to `timer.commands`. The worker dedupes it, stops any running entry, and inserts the new one together with an outbox row in a single transaction. `entry.changed` is then published, and the UI polls `GET /tracking/timer/current`.
2. **Edit entry:** UI → Kong → Tracking REST. The DB row and outbox row are written in one transaction, then `entry.changed` is published to Reporting.
3. **Dashboard:** the current month is read live from Tracking; past months come from Reporting's `monthly_totals`.
