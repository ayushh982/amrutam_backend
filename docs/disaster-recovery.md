# Amrutam Telemedicine Backend: Backup & Disaster Recovery (DR) Plan

**Target Availability:** 99.95% (Max unplanned downtime: ~4.38 hours/year)  
**Recovery Point Objective (RPO):** < 5 minutes (Maximum acceptable data loss)  
**Recovery Time Objective (RTO):** < 15 minutes (Maximum time to restore full service)  

---

## 1. Backup Architecture & Strategy

Amrutam’s database stores mission-critical medical histories, prescriptions, financial payments, and consultation schedules. Data loss is unacceptable.

```
+-------------------------------------------------------------+
|               PRIMARY POSTGRESQL 16 CLUSTER                 |
|                   (Write Master Instance)                   |
+------------------------------+------------------------------+
                               |
            +------------------+------------------+
            | Continuous WAL Streaming           | Nightly Full Physical Backup
            v                                     v
+------------------------------+   +------------------------------+
|     WAL ARCHIVE STORAGE      |   |      SNAPSHOT ARCHIVE        |
|  - Encrypted (AES-256-GCM)   |   |  - Full pg_basebackup        |
|  - Multi-region S3 / GCS     |   |  - Retention: 30 daily,      |
|  - PITR granularity: seconds |   |    12 monthly snapshots      |
+------------------------------+   +------------------------------+
```

### 1. Continuous Archiving & Point-In-Time Recovery (PITR)
- **Tooling:** `WAL-G` / `pgBackRest`
- Write-Ahead Logs (WAL) are streamed continuously to object storage every 60 seconds or whenever a 16MB WAL segment completes.
- Enables restoring the database to any millisecond within the 30-day retention window.

### 2. Full Daily Snapshots
- Automated physical base backups (`pg_basebackup`) executed daily at 02:00 UTC during lowest traffic.
- Compressed with `zstd` (level 3) and encrypted with AES-256 before upload.

---

## 2. Disaster Recovery Scenarios & Playbooks

### Scenario A: Primary Database Node Hardware Failure
1. **Detection:** Automated health check fails 3 consecutive probes (15 seconds).
2. **Failover Execution:**
   - In a High Availability (HA) cluster (Patroni/Stolon), the synchronous standby replica is promoted to primary within 30 seconds.
   - Applications re-route traffic via virtual IP or DNS CNAME.
3. **Data Loss:** 0 seconds (Synchronous replication).
4. **Downtime:** < 45 seconds.

### Scenario B: Data Corruption or Catastrophic Region Outage (PITR Restoration)
1. **Isolate:** Stop application instances to prevent further writes.
2. **Determine Target Timestamp:** Identify the exact timestamp $T_{incident} - 1s$ before the corrupting event.
3. **Provision Restoration Target:** Launch new PostgreSQL instance in the secondary standby region.
4. **Execute Restoration Script:**
   ```bash
   # Download latest base backup
   wal-g backup-fetch /var/lib/postgresql/data LATEST

   # Configure recovery target in postgresql.conf
   cat <<EOF >> /var/lib/postgresql/data/postgresql.auto.conf
   restore_command = 'wal-g wal-fetch "%f" "%p"'
   recovery_target_time = '2026-10-19 14:32:00+00'
   recovery_target_action = 'promote'
   EOF

   # Start database recovery
   systemctl start postgresql
   ```
5. **Verify Database Integrity:** Run automated validation queries against `consultations`, `users`, and `payments`.
6. **Switch DNS / Load Balancer:** Point application database connection strings to the restored database instance.
7. **RTO Achieved:** ~12 minutes.

---

## 3. Automated Restore Validation & Testing

Backups that are not tested for restoration are not backups.

1. **Daily Automated Restore Drill (CI / Test Runner)**:
   - A dedicated ephemeral runner spins up every night at 04:00 UTC.
   - Fetches the previous night's base backup and applies WAL logs.
   - Starts PostgreSQL and executes the backend test suite (`npm test`) against the restored database.
   - Posts a webhook notification to Slack/PagerDuty verifying successful drill completion.
2. **Quarterly Tabletop Simulation**:
   - Engineering team conducts simulated regional failover exercises every quarter.
