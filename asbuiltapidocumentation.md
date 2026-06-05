# AsBuilt IQ — API Documentation

**Version:** v1  
**Backend:** TwinBackend (Laravel 11)  
**Base URL (online — for employees):** `https://purple-mink-495054.hostingersite.com/api/v1`  
**Base URL (local Wi-Fi — same network only):** `https://purple-mink-495054.hostingersite.com/api/v1`

> **Employees posting from outside the office must use the ngrok URL.**  
> Local IP only works when the device is on the same Wi-Fi as the backend server.

---

## Base URL Setup (Frontend Constant)

Set this once in your app config:

```js
// ✅ Online — use this for employees posting remotely (ngrok static domain)
const BASE_URL = 'https://purple-mink-495054.hostingersite.com/api/v1'

// Local Wi-Fi only — use this when device is on the same network as the server
// const BASE_URL = 'http://192.168.1.17:8080/api/v1'
```

All endpoint paths in this document are relative to `BASE_URL`.  
Example: `GET /asbuilt/sites` → `GET https://purple-mink-495054.hostingersite.com//api/v1/asbuilt/sites`

---

## Authentication

| Header | Value | Required |
|--------|-------|----------|
| `X-AsBuilt-Key` | `asbuilt-iq-secret-key-2026` | ✅ Always |
| `ngrok-skip-browser-warning` | `1` | ✅ Always (required when using ngrok URL) |

No user login required. API key only.

---

## Terminology

| AsBuilt IQ | Backend Table / Column |
|------------|----------------------|
| **Site / Area** | `skycable_areas` (NCR, North Luzon, South Luzon, Visayas, Mindanao) |
| **Node Identifier** | `skycable_nodes.node_id` — VARCHAR string, e.g. `"TY1401"` |
| **Node Name** | `skycable_nodes.name` — human name, e.g. `"MONTEVISTA SUBD."` |
| **Pole** | `poles` + `skycable_poles` |
| **Span** | `skycable_spans` + `skycable_span_summaries` |

---

## How It Works

```
1. Fetch all sites / areas
         GET /asbuilt/sites
         → [ NCR, North Luzon, South Luzon, Visayas, Mindanao ]

2. Display all areas on the screen using forEach

3. User selects a site / area
         GET /asbuilt/sites/{areaId}/nodes
         → [ { node_id: "TY1401", name: "MONTEVISTA SUBD." }, ... ]

4. User can choose either:
         Option A: Select an existing node
         Option B: Add node manually

5. If user selects an existing node:
         Use selected node_id and name

6. If user adds node manually:
         Display a form input for node_id, node_name, region, province, city,
         and barangay_name

7. User uploads poles and spans

8. On POST:
         All poles and spans are posted to the selected/manual node_id

9. After POST:
         Display all uploaded poles and spans under that specific node
```

---

## ForEach Pattern

```js
const BASE_URL = 'https://quack-useable-thesaurus.ngrok-free.dev/api/v1'
const API_KEY  = 'asbuilt-iq-secret-key-2026'
const headers  = {
  'X-AsBuilt-Key': API_KEY,
  'ngrok-skip-browser-warning': '1'
}

// Step 1 — Load all sites / areas
const sitesRes = await fetch(`${BASE_URL}/asbuilt/sites`, { headers })
const areas    = await sitesRes.json()

// Step 2 — Display every area
areas.forEach(area => {
  displayAreaCard({
    id: area.id,
    name: area.name,
    node_count: area.node_count
  })
})

// Step 3 — User picks an area
const selectedArea = area

// Step 4 — Load all nodes under selected area
const nodesRes     = await fetch(`${BASE_URL}/asbuilt/sites/${selectedArea.id}/nodes`, { headers })
const { nodes }    = await nodesRes.json()

// Step 5 — Display every existing node
nodes.forEach(node => {
  displayNodeOption({
    id: node.id,
    node_id: node.node_id,
    name: node.name,
    pole_count: node.pole_count,
    source_file: node.source_file
  })
})
```

---

## Endpoints

---

### 1. List Sites / Areas

```
GET /api/v1/asbuilt/sites
```

Returns all areas. These are the **Sites** in AsBuilt IQ.

**Response `200`:**

```json
[
  { "id": 1, "name": "NCR",         "node_count": 12 },
  { "id": 2, "name": "North Luzon", "node_count": 8  },
  { "id": 3, "name": "South Luzon", "node_count": 6  },
  { "id": 4, "name": "Visayas",     "node_count": 4  },
  { "id": 5, "name": "Mindanao",    "node_count": 3  }
]
```

---

### 2. List Nodes by Site / Area

```
GET /api/v1/asbuilt/sites/{areaId}/nodes
```

Returns all nodes under the selected area.

**Response `200`:**

```json
{
  "site": {
    "id":   1,
    "name": "NCR"
  },
  "nodes": [
    {
      "id":          10,
      "node_id":     "TY1401",
      "name":        "MONTEVISTA SUBD.",
      "full_label":  "MONTEVISTA SUBD.",
      "status":      "pending",
      "report_type": null,
      "source_file": null,
      "pole_count":  0
    },
    {
      "id":          11,
      "node_id":     "TY1402",
      "name":        "BRGY. DILA",
      "full_label":  "BRGY. DILA",
      "status":      "in_progress",
      "report_type": "full_report",
      "source_file": "asbuilt",
      "pole_count":  15
    }
  ]
}
```

| Field | Description |
|-------|-------------|
| `id` | Integer database ID of the node |
| `node_id` | **VARCHAR string identifier** e.g. `"TY1401"` — use this in the import payload |
| `name` | Node name saved in `skycable_nodes.name` |
| `source_file` | `"asbuilt"` if previously imported via AsBuilt IQ |
| `pole_count` | Number of poles already enrolled in this node |

---

### 3. Import JSON Body

```
POST /api/v1/asbuilt/import
Content-Type: application/json
```

Use this endpoint for both:

1. Existing node import  
2. Manual node create-or-update import  

If the `node_id` does not exist yet inside the selected `area_id`, the backend creates the node automatically.  
If the `node_id` already exists inside the selected `area_id`, the backend updates that node.

---

## Import Payload Structure

### Required Fields (root level)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `node_id` | string | ✅ | VARCHAR identifier e.g. `"TY1401"` — maps to `skycable_nodes.node_id` |
| `node_name` | string | ✅ | Saved to `skycable_nodes.name` |
| `area_id` | integer | ✅ | From `GET /asbuilt/sites` |
| `region` | string | ❌ | e.g. `"CALABARZON"` — saved to node |
| `province` | string | ❌ | e.g. `"LAGUNA"` — saved to node |
| `city` | string | ❌ | e.g. `"STA. ROSA"` — saved to node |
| `poles` | array | ✅ | Minimum 1 pole required |
| `spans` | array | ❌ | Optional. Empty array or omit if no spans |

### Pole Fields (`poles[]`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `pole_code` | string | ✅ | Stored UPPERCASE. e.g. `"PL-001"` |
| `pole_index` | integer | ⭐ **Strongly recommended** | **1-based sequential number for this pole within the node.** Saved to `skycable_poles.sequence`. Node-scoped — the same physical pole can have a different `pole_index` in different nodes. Used by spans to pinpoint exactly which physical pole is the `from` or `to` endpoint. Prevents wrong spanning when two poles share the same `pole_code`. e.g. `1`, `2`, `3` … |
| `latitude` | decimal | ❌ | −90 to 90 |
| `longitude` | decimal | ❌ | −180 to 180 |
| `barangay_name` | string | ❌ | Per-pole barangay. The node's `barangay_name` is auto-set to the most frequent value across all poles |

> **Always include `pole_index`.** Even when all `pole_code` values are unique, providing `pole_index` on every pole and referencing it in spans guarantees that the backend creates each span between exactly the two poles you intended — no ambiguity, no wrong connections.

---

### Span Fields (`spans[]`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `from_pole_code` | string | ✅ | `pole_code` of the starting pole |
| `to_pole_code` | string | ✅ | `pole_code` of the ending pole. Must differ from `from_pole_code` |
| `from_pole_index` | integer | ⭐ **Strongly recommended** | `pole_index` of the starting pole. Takes priority over `pole_code` matching. Use this to lock the span to the exact pole you mean |
| `to_pole_index` | integer | ⭐ **Strongly recommended** | `pole_index` of the ending pole |
| `strand_length` | decimal | ❌ | Length in meters. e.g. `50.5` |
| `number_of_runs` | integer | ❌ | Minimum 1. Default: `1`. `expected_cable = strand_length × number_of_runs` |
| `components` | object | ❌ | Equipment counts. All default to `0` if omitted |
| `components.node` | integer | ❌ | Node count. Min 0 |
| `components.amplifier` | integer | ❌ | Amplifier count. Min 0 |
| `components.extender` | integer | ❌ | Extender count. Min 0 |
| `components.tsc` | integer | ❌ | TSC count. Min 0 |
| `components.powersupply` | integer | ❌ | Power supply count. Min 0 |
| `components.ps_housing` | integer | ❌ | PS housing count. Min 0 |

> `expected_cable` is auto-computed: `strand_length × number_of_runs` and saved to `skycable_span_summaries.expected_cable`.

---

### How `pole_index` Prevents Wrong Spanning

Without `pole_index`, the backend matches poles by `pole_code` string only. If two poles share the same `pole_code` (a common occurrence when importing from field surveys), the backend picks the **first occurrence** — which may not be the pole you intended. This causes spans to connect the wrong physical poles.

**With `pole_index`:** assign a unique 1-based integer to every pole, then reference those integers in your span definitions. The backend resolves the pole by index first, ignoring duplicate codes entirely.

```
poles:
  pole_index: 1  →  PL-001  (lat 14.5397, lng 121.1092)
  pole_index: 2  →  PL-001  (lat 14.5401, lng 121.1098)  ← same code, different location!
  pole_index: 3  →  PL-002  (lat 14.5407, lng 121.1103)

spans:
  from_pole_index: 1 → to_pole_index: 2   ✅ connects the two PL-001 poles correctly
  from_pole_index: 2 → to_pole_index: 3   ✅ connects second PL-001 to PL-002 correctly

Without pole_index:
  from_pole_code: "PL-001" → to_pole_code: "PL-001"  ❌ same code, backend can't tell which is which
```

---

### Pole Resolution Priority (backend)

The backend resolves which physical pole a span endpoint refers to using this priority order:

1. **GPS coordinate match** — if `from_lat`/`from_lng` or `to_lat`/`to_lng` are provided on the span, the pole whose coordinates match is used
2. **`pole_index` match** — if `from_pole_index` / `to_pole_index` is provided, the pole whose `pole_index` field equals that value is used ✅ **most reliable when GPS is unavailable**
3. **Array-position fallback** — if no `pole_index` field was set on the pole, the value is treated as a 0-based array position
4. **First occurrence** — final fallback: the first pole in the `poles` array whose `pole_code` matches ⚠️ may connect wrong poles if codes repeat

**`pole_index` is also saved to `skycable_poles.sequence`.** If you provide `pole_index` on a pole, that value becomes its sequence number in the node. If omitted, the backend auto-increments from the highest existing sequence.

**Always include `pole_index` on every pole and `from_pole_index`/`to_pole_index` on every span for predictable, correct spanning.**

---

### Disambiguation Fields for Spans (alternative — GPS coordinate hints)

If `pole_index` is not available, GPS coordinate hints can also disambiguate poles.

| Field | Type | Description |
|-------|------|-------------|
| `from_latitude` / `from_pole_latitude` / `from_lat` | decimal | GPS latitude of the from-pole to match |
| `from_longitude` / `from_pole_longitude` / `from_lng` | decimal | GPS longitude of the from-pole to match |
| `to_latitude` / `to_pole_latitude` / `to_lat` | decimal | GPS latitude of the to-pole to match |
| `to_longitude` / `to_pole_longitude` / `to_lng` | decimal | GPS longitude of the to-pole to match |

> Prefer `pole_index` over coordinate hints. GPS coordinates can have slight variations between devices; `pole_index` is always exact.

---

## Full Import Example

```json
{
  "node_id":   "TY1401",
  "node_name": "MONTEVISTA SUBD.",
  "area_id":   1,
  "region":    "CALABARZON",
  "province":  "LAGUNA",
  "city":      "STA. ROSA",
  "poles": [
    {
      "pole_index":    1,
      "pole_code":     "PL-001",
      "latitude":      14.539770,
      "longitude":     121.109219,
      "barangay_name": "Balibago"
    },
    {
      "pole_index":    2,
      "pole_code":     "PL-002",
      "latitude":      14.540100,
      "longitude":     121.109800,
      "barangay_name": "Balibago"
    },
    {
      "pole_index":    3,
      "pole_code":     "PL-003",
      "latitude":      14.540750,
      "longitude":     121.110300,
      "barangay_name": "Tagapo"
    }
  ],
  "spans": [
    {
      "from_pole_code":  "PL-001",
      "to_pole_code":    "PL-002",
      "from_pole_index": 1,
      "to_pole_index":   2,
      "strand_length":   50.5,
      "number_of_runs":  1,
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
      "from_pole_code":  "PL-002",
      "to_pole_code":    "PL-003",
      "from_pole_index": 2,
      "to_pole_index":   3,
      "strand_length":   45.0,
      "number_of_runs":  2,
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

**Result of this import:**

- `PL-001`: `barangay_name = Balibago`
- `PL-002`: `barangay_name = Balibago`
- `PL-003`: `barangay_name = Tagapo`
- Node `barangay_name` = `Balibago` (majority: 2 vs 1)
- Span 1 `expected_cable` = `50.5 × 1 = 50.5`
- Span 2 `expected_cable` = `45.0 × 2 = 90.0`

---

## Import — Response `201`

```json
{
  "message": "AsBuilt import completed.",
  "data": {
    "node": {
      "id":           10,
      "node_id":      "TY1401",
      "name":         "MONTEVISTA SUBD.",
      "region":       "CALABARZON",
      "province":     "LAGUNA",
      "city":         "STA. ROSA",
      "barangay_name":"Balibago",
      "report_type":  "full_report",
      "source_file":  "asbuilt"
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

> **Note:** If the `from_pole_code` or `to_pole_code` of a span is not found in the `poles` list, that span is skipped and an error message is added to `errors[]`. Other spans still save successfully.

---

### 4. Import File Upload

```
POST /api/v1/asbuilt/import
Content-Type: multipart/form-data
```

Upload the export as a `.json` file. The file must contain the same structure as the JSON body above.

| Field | Type | Description |
|-------|------|-------------|
| `file` | `.json` file | Must include all required fields: `node_id`, `node_name`, `area_id`, `poles`, `spans` |

Accepted MIME types: `application/json`, `text/plain`, `text/json`

---

### 5. Verify Node State

```
GET /api/v1/asbuilt/node/{nodeId}
```

Check what was imported. `{nodeId}` is the **integer database ID** from `skycable_nodes.id` — use `data.node.id` from the import response.

**Response `200`:**

```json
{
  "node": {
    "id":          10,
    "node_id":     "TY1401",
    "name":        "MONTEVISTA SUBD.",
    "area":        "NCR",
    "region":      "CALABARZON",
    "province":    "LAGUNA",
    "city":        "STA. ROSA",
    "barangay":    "Balibago",
    "report_type": "full_report",
    "source_file": "asbuilt",
    "status":      "pending"
  },
  "poles": [
    {
      "skycable_pole_id": 1,
      "pole_id":          1,
      "pole_code":        "PL-001",
      "sequence":         1,
      "latitude":         14.539770,
      "longitude":        121.109219,
      "status":           "pending",
      "date_start":       null,
      "finished_at":      null,
      "duration":         null
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

> **Note on node response key:** The node's barangay is returned as `"barangay"` (not `"barangay_name"`) in this endpoint.

---

## Barangay Majority Logic

The node's `barangay_name` is automatically set to the most frequently appearing `barangay_name` across all poles in the import.

Example:

```
PL-001 → Balibago
PL-002 → Balibago
PL-003 → Tagapo
```

Result:

```
Balibago appears 2 times
Tagapo   appears 1 time

Node barangay_name = Balibago
```

---

## Manual Node Creation Flow

### Step 1 — Get All Areas

```
GET /api/v1/asbuilt/sites
```

Display all areas on the screen.

```js
const sitesRes = await fetch(`${BASE_URL}/asbuilt/sites`, { headers })
const areas    = await sitesRes.json()

areas.forEach(area => {
  displayAreaCard({
    id: area.id,
    name: area.name,
    node_count: area.node_count
  })
})
```

---

### Step 2 — User Clicks an Area

After the user clicks one area, get all existing nodes under that area.

```
GET /api/v1/asbuilt/sites/{areaId}/nodes
```

```js
const selectedArea = area

const response  = await fetch(`${BASE_URL}/asbuilt/sites/${selectedArea.id}/nodes`, { headers })
const { nodes } = await response.json()

nodes.forEach(node => {
  displayNodeOption({
    id: node.id,
    node_id: node.node_id,
    name: node.name,
    pole_count: node.pole_count,
    source_file: node.source_file
  })
})
```

---

### Step 3 — Show Two Options

After selecting an area, the user must have two options:

```
Option 1: Select Existing Node
Option 2: Add Node Manually
```

---

## Option 1 — Select Existing Node

If the user clicks an existing node, save the selected node data.

```js
const selectedNode = {
  id: node.id,
  node_id: node.node_id,
  name: node.name
}
```

This selected `node_id` will be used when posting poles and spans.

---

## Option 2 — Add Node Manually

If the user clicks **Add Node Manually**, display a form input.

### Manual Node Form Fields

```
Node ID       (required)
Node Name     (required)
Region        (optional)
Province      (optional)
City          (optional)
Barangay Name (optional)
```

Example form value:

```json
{
  "node_id":      "TY1501",
  "node_name":    "BRGY. BALIBAGO NODE",
  "region":       "CALABARZON",
  "province":     "LAGUNA",
  "city":         "STA. ROSA",
  "barangay_name":"Balibago"
}
```

Frontend form state:

```js
const manualNode = {
  node_id:      form.node_id,
  name:         form.node_name,
  region:       form.region,
  province:     form.province,
  city:         form.city,
  barangay_name:form.barangay_name
}
```

> Manual node creation uses the same `POST /asbuilt/import` endpoint.  
> If the `node_id` does not exist yet inside the selected `area_id`, the backend creates the node automatically.  
> If the `node_id` already exists inside the selected `area_id`, the backend updates that node.

---

## Post Data After Selecting or Creating a Node

After the user selects an existing node or creates a node manually, the user can click **Post**.

When they click **Post**, all uploaded poles and spans must be posted to that specific `node_id`.

```http
POST /api/v1/asbuilt/import
Content-Type: application/json
```

### Frontend Payload Builder

```js
// ── API config ────────────────────────────────────────────────────────────────
const BASE_URL = 'https://quack-useable-thesaurus.ngrok-free.dev/api/v1'
const API_KEY  = 'asbuilt-iq-secret-key-2026'

const headers = {
  'Content-Type': 'application/json',
  'X-AsBuilt-Key': API_KEY,
  'ngrok-skip-browser-warning': '1'
}

// ── Build and send payload ────────────────────────────────────────────────────
const targetNode = selectedNode || manualNode

const payload = {
  node_id:   targetNode.node_id,
  node_name: targetNode.name,
  area_id:   selectedArea.id,

  // Optional node location fields
  region:   manualNode?.region   || selectedArea.region   || '',
  province: manualNode?.province || selectedArea.province || '',
  city:     manualNode?.city     || selectedArea.city     || '',

  poles: uploadedPoles.map((pole, i) => ({
    pole_index:    pole.pole_index ?? (i + 1),   // 1-based; always include this
    pole_code:     pole.pole_code,
    latitude:      pole.latitude  ?? null,
    longitude:     pole.longitude ?? null,
    barangay_name: pole.barangay_name ?? null
  })),

  spans: uploadedSpans.map(span => ({
    from_pole_code:  span.from_pole_code,
    to_pole_code:    span.to_pole_code,
    from_pole_index: span.from_pole_index ?? null,  // always include — prevents wrong spanning
    to_pole_index:   span.to_pole_index   ?? null,
    strand_length:   span.strand_length  ?? null,
    number_of_runs:  span.number_of_runs ?? 1,
    components: {
      node:        span.components?.node        ?? 0,
      amplifier:   span.components?.amplifier   ?? 0,
      extender:    span.components?.extender    ?? 0,
      tsc:         span.components?.tsc         ?? 0,
      powersupply: span.components?.powersupply ?? 0,
      ps_housing:  span.components?.ps_housing  ?? 0
    }
  }))
}

// ── POST to backend (local Wi-Fi) ─────────────────────────────────────────────
const res = await fetch(`${BASE_URL}/asbuilt/import`, {
  method:  'POST',
  headers: headers,
  body:    JSON.stringify(payload)
})
const importResponse = await res.json()
// importResponse.data.node.id = integer DB id — use for verify call
console.log('Import result:', importResponse)
```

---

## Display Uploaded Poles and Spans After Post

After successful import, use the integer database node ID from the import response.

```js
const nodeDatabaseId = importResponse.data.node.id
```

Then verify and display the uploaded data.

```http
GET /api/v1/asbuilt/node/{nodeId}
```

```js
const verifyRes = await fetch(`${BASE_URL}/asbuilt/node/${nodeDatabaseId}`, {
  headers: { 'X-AsBuilt-Key': API_KEY }
})
const nodeState = await verifyRes.json()

displayNodeDetails(nodeState.node)
displayPoles(nodeState.poles)
displaySpans(nodeState.spans)
```

---

## Final UI Flow

```
1.  GET all areas
2.  Display all areas using forEach
3.  User clicks an area
4.  GET all nodes under selected area
5.  Display existing nodes
6.  User chooses either:
       A. Select existing node
       B. Add node manually
7.  If manual, display node form:
       - node_id        (required)
       - node_name      (required)
       - region         (optional)
       - province       (optional)
       - city           (optional)
       - barangay_name  (optional)
8.  User uploads poles and spans
9.  Each span must reference pole_code values that exist in the poles array
10. User clicks Post
11. POST data to /asbuilt/import using the selected/manual node_id
12. Backend creates or updates the node
13. Backend saves poles and spans under that specific node_id
14. Node barangay_name is auto-set to the most frequent barangay across poles
15. expected_cable per span is auto-computed: strand_length × number_of_runs
16. GET /asbuilt/node/{nodeId}
17. Display all uploaded poles and spans under that node
```

---

## All Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/asbuilt/sites` | List all areas |
| `GET` | `/asbuilt/sites/{areaId}/nodes` | List nodes under an area |
| `POST` | `/asbuilt/import` | Bulk import — JSON body or `.json` file upload (pole_code based) |
| `POST` | `/asbuilt/import-by-sequence` | **Sequence-first import** — spans use `from_sequence`/`to_sequence`, no disambiguation needed |
| `GET` | `/asbuilt/node/{nodeId}` | Verify node state after import |

---

### 6. Sequence-First Import

```
POST /api/v1/asbuilt/import-by-sequence
Content-Type: application/json
```

Cleaner alternative to `/asbuilt/import`. Every pole carries a required `sequence` number. Spans reference poles by `from_sequence` / `to_sequence` — no `pole_code` disambiguation, no duplicate confusion.

**Key difference from `/import`:**

| | `/import` | `/import-by-sequence` |
|---|---|---|
| Span matching | `from_pole_code` + optional `from_pole_index` | `from_sequence` + `to_sequence` only |
| Duplicate poles | Need index/GPS hints | Sequence is unique per node — no ambiguity |
| `sequence` on pole | Optional (`pole_index`) | **Required** |

**Payload:**

```json
{
  "node_id":   "TY1401",
  "node_name": "MONTEVISTA SUBD.",
  "area_id":   1,
  "region":    "CALABARZON",
  "province":  "LAGUNA",
  "city":      "STA. ROSA",
  "poles": [
    { "sequence": 1, "pole_code": "PL-001", "lat": 14.539770, "lng": 121.109219, "barangay_name": "Balibago" },
    { "sequence": 2, "pole_code": "PL-002", "lat": 14.540100, "lng": 121.109800, "barangay_name": "Balibago" },
    { "sequence": 3, "pole_code": "PL-003", "lat": 14.540750, "lng": 121.110300, "barangay_name": "Tagapo"   }
  ],
  "spans": [
    {
      "from_sequence": 1, "to_sequence": 2,
      "strand_length": 50.5, "number_of_runs": 1,
      "components": { "node": 2, "amplifier": 1, "extender": 0, "tsc": 1, "powersupply": 0, "ps_housing": 0 }
    },
    {
      "from_sequence": 2, "to_sequence": 3,
      "strand_length": 45.0, "number_of_runs": 2,
      "components": { "node": 1, "amplifier": 0, "extender": 1, "tsc": 0, "powersupply": 1, "ps_housing": 1 }
    }
  ]
}
```

**Pole fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sequence` | integer | ✅ | 1-based. Saved to `skycable_poles.sequence`. Must be unique within the node |
| `pole_code` | string | ✅ | Stored UPPERCASE |
| `lat` / `latitude` | decimal | ❌ | −90 to 90 |
| `lng` / `longitude` | decimal | ❌ | −180 to 180 |
| `barangay_name` | string | ❌ | Per-pole barangay |

**Span fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `from_sequence` | integer | ✅ | `sequence` of the starting pole |
| `to_sequence` | integer | ✅ | `sequence` of the ending pole. Must differ from `from_sequence` |
| `strand_length` | decimal | ❌ | Meters |
| `number_of_runs` | integer | ❌ | Default 1 |
| `components` | object | ❌ | Same structure as `/import` |

**Response `201`:** Same shape as `/import` response.

---

## Error Handling

| HTTP Status | Meaning |
|-------------|---------|
| `201` | Import completed (may include `errors[]` for skipped spans) |
| `422` | Validation failed — missing `node_id`, `node_name`, `area_id`, or `poles`; or invalid file |
| `404` | `area_id` not found |

When a span's `from_pole_code` or `to_pole_code` is not found in the `poles` list, that span is **silently skipped** and recorded in `data.errors[]`. The rest of the import still succeeds with a `201`.

```json
{
  "message": "AsBuilt import completed.",
  "data": {
    "node": { ... },
    "poles_created": ["PL-001", "PL-002"],
    "spans_created": [],
    "total_poles": 2,
    "total_spans": 0,
    "errors": [
      "spans[0]: from_pole_code 'PL-999' not found in poles list"
    ]
  }
}
```

---

## cURL Examples

```bash
# Online (ngrok static domain — use this for employees)
BASE="https://quack-useable-thesaurus.ngrok-free.dev/api/v1"
KEY="asbuilt-iq-secret-key-2026"
NGROK="ngrok-skip-browser-warning: 1"

# Local Wi-Fi only (same network as server)
# BASE="http://192.168.1.17:8080/api/v1"

# 1 — List sites / areas
curl "$BASE/asbuilt/sites" \
  -H "X-AsBuilt-Key: $KEY" \
  -H "$NGROK"

# 2 — List nodes for NCR, area id = 1
curl "$BASE/asbuilt/sites/1/nodes" \
  -H "X-AsBuilt-Key: $KEY" \
  -H "$NGROK"

# 3 — Import via JSON body
curl -X POST "$BASE/asbuilt/import" \
  -H "X-AsBuilt-Key: $KEY" \
  -H "$NGROK" \
  -H "Content-Type: application/json" \
  -d '{
    "node_id":   "TY1401",
    "node_name": "MONTEVISTA SUBD.",
    "area_id":   1,
    "region":    "CALABARZON",
    "province":  "LAGUNA",
    "city":      "STA. ROSA",
    "poles": [
      {
        "pole_index":    1,
        "pole_code":     "PL-001",
        "latitude":      14.53977,
        "longitude":     121.10921,
        "barangay_name": "Balibago"
      },
      {
        "pole_index":    2,
        "pole_code":     "PL-002",
        "latitude":      14.54010,
        "longitude":     121.10980,
        "barangay_name": "Balibago"
      }
    ],
    "spans": [
      {
        "from_pole_code":  "PL-001",
        "to_pole_code":    "PL-002",
        "from_pole_index": 1,
        "to_pole_index":   2,
        "strand_length":   50.5,
        "number_of_runs":  1,
        "components": {
          "node": 2, "amplifier": 1, "extender": 0,
          "tsc": 1, "powersupply": 0, "ps_housing": 0
        }
      }
    ]
  }'

# 4 — Import via file upload
curl -X POST "$BASE/asbuilt/import" \
  -H "X-AsBuilt-Key: $KEY" \
  -H "$NGROK" \
  -F "file=@export.json"

# 5 — Verify node state (use integer id from import response)
curl "$BASE/asbuilt/node/10" \
  -H "X-AsBuilt-Key: $KEY" \
  -H "$NGROK"
```
