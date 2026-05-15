# AsBuilt IQ — API Documentation

**Version:** v1  
**Backend:** TwinBackend (Laravel 11)  
**Base URL:** `https://disguisedly-enarthrodial-kristi.ngrok-free.dev/api/v1`  
**Required header (all requests):** `ngrok-skip-browser-warning: 1`

---

## Authentication

AsBuilt IQ uses **API Key authentication only** — no user login or user credentials required.

| Header | Value |
|--------|-------|
| `X-AsBuilt-Key` | `asbuilt-iq-secret-key-2026` |

> The API key is configured in the backend `.env` as `ASBUILT_API_KEY`.  
> All AsBuilt endpoints return `401 Unauthorized` without a valid key.

---

## Scope

This API only covers **Skycable** data:

| Resource | Table |
|----------|-------|
| Sites | `skycable_sites` |
| Nodes | `skycable_nodes` |
| Poles | `poles` + `skycable_poles` |
| Spans | `skycable_spans` |
| Components | `skycable_span_summaries` |

No user management, no teardown, no photos.

---

## Export Flow (How the App Should Work)

Before uploading sitemap data, the AsBuilt IQ app must show an **Export Modal** to let the user select where the data goes.

```
User finishes reading sitemap
        │
        ▼
┌─────────────────────────────┐
│       EXPORT MODAL          │
│                             │
│  Site:  [  dropdown  ▼  ]   │  ← GET /asbuilt/sites
│  Node:  [  dropdown  ▼  ]   │  ← GET /asbuilt/sites/{siteId}/nodes
│                             │
│  [ Cancel ]  [ Export Now ] │
└─────────────────────────────┘
        │
        ▼ on "Export Now"
POST /asbuilt/import  { node_id, poles[], spans[] }
        │
        ▼
  node.report_type = full_report  ✅
```

**Step-by-step:**
1. App reads the sitemap (poles + spans + components)
2. User taps **Export** → modal opens
3. Modal loads site list → `GET /asbuilt/sites`
4. User selects a **Site** → modal loads node list → `GET /asbuilt/sites/{siteId}/nodes`
5. User selects a **Node**
6. User taps **Export Now** → `POST /asbuilt/import` with `node_id` + parsed data
7. On success → show summary (poles created, spans created)

---

## Endpoints

---

### 1. List Sites *(for export modal dropdown)*

```
GET /api/v1/asbuilt/sites
```

Returns all available sites for the site dropdown in the export modal.

**Headers:**
```
X-AsBuilt-Key: asbuilt-iq-secret-key-2026
ngrok-skip-browser-warning: 1
```

**Response `200 OK`:**
```json
[
  {
    "id":      1,
    "name":    "BGC Site",
    "area_id": 2,
    "area":    "NCR",
    "address": "Bonifacio Global City, Taguig"
  },
  {
    "id":      2,
    "name":    "Makati Site",
    "area_id": 2,
    "area":    "NCR",
    "address": null
  }
]
```

**Response Fields:**

| Field | Description |
|-------|-------------|
| `id` | Site ID — use this as `siteId` in the next request |
| `name` | Site name (display in dropdown) |
| `area_id` | Parent area ID |
| `area` | Parent area name |
| `address` | Site address (optional) |

---

### 2. List Nodes by Site *(for export modal node dropdown)*

```
GET /api/v1/asbuilt/sites/{siteId}/nodes
```

Returns all nodes under the selected site. Call this after the user selects a site in the export modal.

**Headers:**
```
X-AsBuilt-Key: asbuilt-iq-secret-key-2026
ngrok-skip-browser-warning: 1
```

**URL Parameter:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `siteId` | integer | ID from `GET /asbuilt/sites` |

**Response `200 OK`:**
```json
{
  "site": {
    "id":   1,
    "name": "BGC Site",
    "area": "NCR"
  },
  "nodes": [
    {
      "id":          10,
      "name":        "Node-A",
      "full_label":  "BGC-NODE-A",
      "status":      "pending",
      "report_type": null,
      "pole_count":  0
    },
    {
      "id":          11,
      "name":        "Node-B",
      "full_label":  "BGC-NODE-B",
      "status":      "in_progress",
      "report_type": "full_report",
      "pole_count":  15
    }
  ]
}
```

**Response Fields:**

| Field | Description |
|-------|-------------|
| `nodes[].id` | Node ID — use this as `node_id` in the import |
| `nodes[].name` | Node name (display in dropdown) |
| `nodes[].full_label` | Full node label/code |
| `nodes[].status` | `pending` / `in_progress` / `completed` |
| `nodes[].report_type` | `full_report` if already imported, `null` if not yet |
| `nodes[].pole_count` | How many poles are already enrolled in this node |

> If `report_type` is already `full_report`, the node was previously imported — re-importing will **update** existing data.

**Error `404`:**
```json
{ "message": "No query results for model [App\\Models\\SkycableSite]." }
```

---

### 3. Bulk Import — JSON Body

```
POST /api/v1/asbuilt/import
Content-Type: application/json
```

Imports poles + spans + components from AsBuilt IQ sitemap data.  
Sets `report_type = full_report` on the node automatically.  
Idempotent — safe to re-import the same data.

**Headers:**
```
X-AsBuilt-Key: asbuilt-iq-secret-key-2026
Content-Type: application/json
ngrok-skip-browser-warning: 1
```

**Request Body:**
```json
{
  "node_id": 10,
  "poles": [
    {
      "pole_code":  "PL-001",
      "latitude":   14.599512,
      "longitude":  120.984219
    },
    {
      "pole_code":  "PL-002",
      "latitude":   14.600100,
      "longitude":  120.984800
    },
    {
      "pole_code":  "PL-003",
      "latitude":   14.600750,
      "longitude":  120.985300
    }
  ],
  "spans": [
    {
      "from_pole_code": "PL-001",
      "to_pole_code":   "PL-002",
      "strand_length":  50.5,
      "number_of_runs": 1,
      "components": {
        "node":        2,
        "amplifier":   1,
        "extender":    0,
        "tsc":         1,
        "powersupply": 0,
        "ps_housing":  0
      }
    },
    {
      "from_pole_code": "PL-002",
      "to_pole_code":   "PL-003",
      "strand_length":  45.0,
      "number_of_runs": 2,
      "components": {
        "node":        1,
        "amplifier":   0,
        "extender":    1,
        "tsc":         0,
        "powersupply": 1,
        "ps_housing":  1
      }
    }
  ]
}
```

---

### 4. Bulk Import — JSON File Upload

```
POST /api/v1/asbuilt/import
Content-Type: multipart/form-data
```

Same as above but uploads a `.json` file. The file must contain the exact same JSON structure.

**Headers:**
```
X-AsBuilt-Key: asbuilt-iq-secret-key-2026
Content-Type: multipart/form-data
ngrok-skip-browser-warning: 1
```

**Form Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | file | ✅ | `.json` file with the import payload |

> Accepted MIME types: `application/json`, `text/plain`, `text/json`

**Sample file — `bgc_node_a_export.json`:**
```json
{
  "node_id": 10,
  "poles": [
    { "pole_code": "PL-001", "latitude": 14.5995, "longitude": 120.9842 },
    { "pole_code": "PL-002", "latitude": 14.6001, "longitude": 120.9848 }
  ],
  "spans": [
    {
      "from_pole_code": "PL-001",
      "to_pole_code":   "PL-002",
      "strand_length":  50.5,
      "number_of_runs": 1,
      "components": {
        "node": 2, "amplifier": 1, "extender": 0,
        "tsc": 1, "powersupply": 0, "ps_housing": 0
      }
    }
  ]
}
```

---

### Import — Request Fields Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `node_id` | integer | ✅ | Target node — get from `GET /asbuilt/sites/{id}/nodes` |
| `poles` | array | ✅ | List of poles (minimum 1) |
| `poles[].pole_code` | string | ✅ | Unique pole identifier (stored UPPERCASE) |
| `poles[].latitude` | decimal | ❌ | GPS latitude −90 to 90 |
| `poles[].longitude` | decimal | ❌ | GPS longitude −180 to 180 |
| `spans` | array | ❌ | Spans connecting poles |
| `spans[].from_pole_code` | string | ✅* | Must be in the `poles` list above |
| `spans[].to_pole_code` | string | ✅* | Must be in the `poles` list, different from `from` |
| `spans[].strand_length` | decimal | ❌ | Span length in meters |
| `spans[].number_of_runs` | integer | ❌ | Cable runs (default: 1) |
| `spans[].components.node` | integer | ❌ | Expected node boxes (default: 0) |
| `spans[].components.amplifier` | integer | ❌ | Expected amplifiers (default: 0) |
| `spans[].components.extender` | integer | ❌ | Expected extenders (default: 0) |
| `spans[].components.tsc` | integer | ❌ | Expected TSC units (default: 0) |
| `spans[].components.powersupply` | integer | ❌ | Expected power supplies (default: 0) |
| `spans[].components.ps_housing` | integer | ❌ | Expected PS housings (default: 0) |

> `expected_cable` is auto-computed as `strand_length × number_of_runs` and saved in `skycable_span_summaries`.

---

### Import — Response `201 Created`

```json
{
  "message": "AsBuilt import completed.",
  "data": {
    "node": {
      "id":          10,
      "name":        "Node-A",
      "report_type": "full_report"
    },
    "poles_created": ["PL-001", "PL-002", "PL-003"],
    "poles_updated": [],
    "spans_created": ["PL-001 → PL-002", "PL-002 → PL-003"],
    "spans_updated": [],
    "total_poles":   3,
    "total_spans":   2,
    "errors":        []
  }
}
```

### Import — What Happens

| Scenario | Result |
|----------|--------|
| `pole_code` not in `poles` table | Created + enrolled in `skycable_poles` for this node |
| `pole_code` already exists globally | Reused; GPS updated only if not yet set |
| Pole already enrolled in node | Skipped (no duplicate) |
| Span `from → to` does not exist in node | Created with `status: pending` |
| Span `from → to` already exists in node | Updated (strand_length, runs, components) |
| `from_pole_code` not in the poles list | Skipped, added to `errors[]` |
| Node `report_type` (any value) | Set to `full_report` after import |

### Import — Error Responses

**`401 Unauthorized`:**
```json
{ "message": "Unauthorized. Provide a valid X-AsBuilt-Key header." }
```

**`422 Validation failed`:**
```json
{
  "message": "Validation failed.",
  "errors": {
    "node_id": ["The selected node id is invalid."],
    "poles.0.pole_code": ["The poles.0.pole_code field is required."]
  }
}
```

**`422 Invalid JSON file`:**
```json
{ "message": "Invalid JSON file: Syntax error" }
```

> Items in `errors[]` are **non-fatal** — the rest of the batch still processes.

---

### 5. Get Node State

```
GET /api/v1/asbuilt/node/{nodeId}
```

Returns the full state of a node: enrolled poles (with GPS), spans, and expected components.  
Use this to verify the import was successful.

**Headers:**
```
X-AsBuilt-Key: asbuilt-iq-secret-key-2026
ngrok-skip-browser-warning: 1
```

**Response `200 OK`:**
```json
{
  "node": {
    "id":          10,
    "name":        "Node-A",
    "area":        "NCR",
    "report_type": "full_report",
    "status":      "pending"
  },
  "poles": [
    {
      "skycable_pole_id": 1,
      "pole_id":          1,
      "pole_code":        "PL-001",
      "sequence":         1,
      "latitude":         14.599512,
      "longitude":        120.984219,
      "status":           "pending",
      "date_start":       null,
      "finished_at":      null,
      "duration":         null
    },
    {
      "skycable_pole_id": 2,
      "pole_id":          2,
      "pole_code":        "PL-002",
      "sequence":         2,
      "latitude":         14.600100,
      "longitude":        120.984800,
      "status":           "completed",
      "date_start":       "2026-05-15T08:00:00.000000Z",
      "finished_at":      "2026-05-15T09:23:00.000000Z",
      "duration":         83
    }
  ],
  "spans": [
    {
      "span_id":        1,
      "from_pole_code": "PL-001",
      "to_pole_code":   "PL-002",
      "strand_length":  50.5,
      "number_of_runs": 1,
      "expected_cable": 50.5,
      "status":         "pending",
      "components": {
        "node":        2,
        "amplifier":   1,
        "extender":    0,
        "tsc":         1,
        "powersupply": 0,
        "ps_housing":  0
      }
    }
  ]
}
```

**Key Fields:**

| Field | Description |
|-------|-------------|
| `poles[].latitude` / `longitude` | GPS from `poles` table |
| `poles[].status` | `pending` / `in_progress` / `completed` — set by mobile field app |
| `poles[].date_start` | When field crew started teardown |
| `poles[].finished_at` | Timestamp of after-photo (= `cleared_at`) |
| `poles[].duration` | Minutes from start → finish (auto-computed) |
| `spans[].expected_cable` | `strand_length × number_of_runs` meters |

---

## Complete Export Flow cURL

```bash
# Step 1 — Get sites (populate site dropdown)
curl https://disguisedly-enarthrodial-kristi.ngrok-free.dev/api/v1/asbuilt/sites \
  -H "X-AsBuilt-Key: asbuilt-iq-secret-key-2026" \
  -H "ngrok-skip-browser-warning: 1"

# Step 2 — Get nodes for selected site (populate node dropdown)
curl https://disguisedly-enarthrodial-kristi.ngrok-free.dev/api/v1/asbuilt/sites/1/nodes \
  -H "X-AsBuilt-Key: asbuilt-iq-secret-key-2026" \
  -H "ngrok-skip-browser-warning: 1"

# Step 3A — Import via JSON body
curl -X POST https://disguisedly-enarthrodial-kristi.ngrok-free.dev/api/v1/asbuilt/import \
  -H "X-AsBuilt-Key: asbuilt-iq-secret-key-2026" \
  -H "Content-Type: application/json" \
  -H "ngrok-skip-browser-warning: 1" \
  -d '{
    "node_id": 10,
    "poles": [
      { "pole_code": "PL-001", "latitude": 14.5995, "longitude": 120.9842 },
      { "pole_code": "PL-002", "latitude": 14.6001, "longitude": 120.9848 }
    ],
    "spans": [
      {
        "from_pole_code": "PL-001",
        "to_pole_code":   "PL-002",
        "strand_length":  50.5,
        "number_of_runs": 1,
        "components": { "node": 2, "amplifier": 1, "extender": 0, "tsc": 1, "powersupply": 0, "ps_housing": 0 }
      }
    ]
  }'

# Step 3B — Import via file upload
curl -X POST https://disguisedly-enarthrodial-kristi.ngrok-free.dev/api/v1/asbuilt/import \
  -H "X-AsBuilt-Key: asbuilt-iq-secret-key-2026" \
  -H "ngrok-skip-browser-warning: 1" \
  -F "file=@/path/to/export.json"

# Step 4 — Verify import
curl https://disguisedly-enarthrodial-kristi.ngrok-free.dev/api/v1/asbuilt/node/10 \
  -H "X-AsBuilt-Key: asbuilt-iq-secret-key-2026" \
  -H "ngrok-skip-browser-warning: 1"
```

---

## Complete Data Flow

```
AsBuilt IQ App
      │
      ├─ 1. GET /asbuilt/sites              → Site list for dropdown
      ├─ 2. GET /asbuilt/sites/{id}/nodes   → Node list for dropdown
      │
      ├─ 3. User selects Site + Node in Export Modal
      │
      ├─ 4a. POST /asbuilt/import (JSON body)
      └─ 4b. POST /asbuilt/import (file upload)
                        │
                        ▼  (X-AsBuilt-Key — no user login)
          ┌──────────────────────────────────────────────┐
          │  TwinBackend                                 │
          │                                              │
          │  poles              ← upsert by pole_code    │
          │  skycable_poles     ← enroll in node         │
          │  skycable_spans     ← upsert from→to pair    │
          │  skycable_span_summaries ← expected counts   │
          │  skycable_nodes.report_type = full_report    │
          └──────────────────────────────────────────────┘
                        │
                        ▼
      5. GET /asbuilt/node/{id}  → Verify import result
```

---

## Component Reference

All stored in `skycable_span_summaries` as **expected** values.  
Mobile field app updates **actual** values after teardown.

| JSON Key | DB Column | Description |
|----------|-----------|-------------|
| `node` | `expected_node` | Node boxes to collect |
| `amplifier` | `expected_amplifier` | Amplifiers |
| `extender` | `expected_extender` | Extenders |
| `tsc` | `expected_tsc` | TSC units |
| `powersupply` | `expected_powersupply` | Power supplies |
| `ps_housing` | `expected_ps_housing` | PS housings |
| *(auto)* | `expected_cable` | `strand_length × number_of_runs` m |

---

## Status Values

### Pole (`skycable_poles.status`)

| Value | Meaning |
|-------|---------|
| `pending` | Not started by field crew |
| `in_progress` | Field crew started teardown |
| `completed` | After-photo captured |

### Span (`skycable_spans.status`)

| Value | Meaning |
|-------|---------|
| `pending` | No teardown started |
| `in_progress` | Teardown in progress |
| `completed` | All teardowns approved |

---

## Important Notes

- `pole_code` is always stored **UPPERCASE**
- Poles are **globally unique** by `pole_code` — one pole can be in multiple nodes
- Spans are **unique per node** on `from + to` pair — re-import updates, never duplicates
- `report_type = full_report` is set on **every** successful import
- `errors[]` in import response are non-fatal — rest of batch still processes
- File upload and JSON body use the **exact same payload structure**
- The export modal **must** call `/sites` and `/sites/{id}/nodes` before allowing import — never hardcode `node_id`
