# Amrutam Telemedicine Database Entity-Relationship Diagram

This document illustrates the relational schema designed for Amrutam's Telemedicine Platform. It enforces data integrity, medical confidentiality, strict slot locking, and asynchronous audit trails.

```mermaid
erDiagram
    users ||--o| profiles : "has profile"
    users ||--o| doctors : "has doctor profile"
    users ||--o{ consultations : "books as patient"
    users ||--o{ prescriptions : "receives as patient"
    users ||--o{ audit_logs : "initiates actions"

    doctors ||--o{ availability_slots : "manages slots"
    doctors ||--o{ consultations : "attends consultation"
    doctors ||--o{ prescriptions : "issues prescription"

    availability_slots ||--o| consultations : "booked for (1:1 strict constraint)"

    consultations ||--o| prescriptions : "generates (1:1)"
    consultations ||--o{ payments : "requires"

    prescriptions ||--|{ prescription_items : "contains medications"

    users {
        uuid id PK
        string email UK
        string password_hash
        string role "PATIENT | DOCTOR | ADMIN"
        string status "ACTIVE | INACTIVE | SUSPENDED"
        datetime created_at
        datetime updated_at
    }

    profiles {
        uuid id PK
        uuid user_id FK, UK
        string name
        string phone
        datetime date_of_birth
        string gender
        string address
        datetime created_at
        datetime updated_at
    }

    doctors {
        uuid id PK
        uuid user_id FK, UK
        string specialization
        string license_number UK
        int consultation_fee "minor currency units"
        string currency "INR"
        string verification_status "PENDING | VERIFIED | REJECTED"
        string bio
        int experience_years
        datetime created_at
        datetime updated_at
    }

    availability_slots {
        uuid id PK
        uuid doctor_id FK
        timestamptz start_at
        timestamptz end_at
        string status "AVAILABLE | RESERVED | BOOKED | CANCELLED"
        datetime created_at
        datetime updated_at
    }

    consultations {
        uuid id PK
        uuid patient_id FK
        uuid doctor_id FK
        uuid slot_id FK, UK "Guarantees no double booking"
        string status "BOOKED | IN_PROGRESS | COMPLETED | CANCELLED | NO_SHOW"
        string reason
        string notes
        datetime created_at
        datetime updated_at
    }

    prescriptions {
        uuid id PK
        uuid consultation_id FK, UK
        uuid doctor_id FK
        uuid patient_id FK
        string notes
        datetime created_at
        datetime updated_at
    }

    prescription_items {
        uuid id PK
        uuid prescription_id FK
        string medication
        string dosage
        string instructions
        string duration
        datetime created_at
    }

    payments {
        uuid id PK
        uuid consultation_id FK
        int amount "minor currency units"
        string currency
        string status "PENDING | COMPLETED | FAILED | REFUNDED"
        string provider_reference
        string idempotency_key UK
        datetime created_at
        datetime updated_at
    }

    audit_logs {
        uuid id PK
        uuid actor_id FK
        string action
        string resource_type
        string resource_id
        string outcome "SUCCESS | FAILURE"
        string ip_address
        string user_agent
        json details
        timestamptz timestamp
    }

    idempotency_keys {
        uuid id PK
        string key UK
        string target_endpoint
        string request_hash
        int response_status
        json response_body
        datetime created_at
        datetime expires_at
    }

    outbox_events {
        uuid id PK
        string event_type
        string aggregate_type
        string aggregate_id
        json payload
        string status "PENDING | PROCESSED | FAILED"
        int retry_count
        datetime created_at
        datetime processed_at
    }

    webhook_events {
        uuid id PK
        string provider
        string event_id UK
        string event_type
        json payload
        string status "RECEIVED | PROCESSED | FAILED"
        datetime processed_at
        datetime created_at
    }
```

## Key Database Design Principles

1. **Strict 1:1 Booking Constraint**:
   `consultations.slot_id` has a strict `@unique` database constraint and references `availability_slots.id`. This ensures that even in the case of application bugs, PostgreSQL will never allow two consultations to reference the same slot.
2. **Money in Minor Units**:
   Consultation fees and payment amounts are stored as integers representing minor currency units (e.g. 50,000 paise = ₹500.00), preventing floating-point rounding errors.
3. **Audit Trail**:
   All sensitive actions (registrations, logins, status updates, prescriptions, payments, cancellations) are written to `audit_logs` with actor ID, IP address, user agent, timestamp, and metadata.
4. **Resilient Outbox & Idempotency**:
   Write transactions write corresponding events to `outbox_events`, preventing distributed transaction anomalies across message brokers or push notification systems.
