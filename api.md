# TwinBackend API Documentation

**Base URL:** `https://disguisedly-enarthrodial-kristi.ngrok-free.dev`  
**API Prefix:** `/api/v1`  
**Auth:** Laravel Sanctum (Bearer Token)  
**Required header on all requests:** `ngrok-skip-browser-warning: 1`

---

## Table of Contents

1. [Global](#1-global)
2. [Authentication](#2-authentication)
3. [Skycable — Areas](#3-skycable--areas)
4. [Skycable — Sites](#4-skycable--sites)
5. [Skycable — Nodes](#5-skycable--nodes)
6. [Skycable — Poles](#6-skycable--poles)
7. [Skycable — Spans](#7-skycable--spans)
8. [Skycable — Teardown Reports](#8-skycable--teardown-reports)
9. [Skycable — Daily Reports](#9-skycable--daily-reports)
10. [Skycable — Warehouses & Stock](#10-skycable--warehouses--stock)
11. [Skycable — Deliveries & Pickup Requests](#11-skycable--deliveries--pickup-requests)
12. [Globe — NAP Boxes & Ports](#12-globe--nap-boxes--ports)
13. [Globe — Surveys](#13-globe--surveys)
14. [Globe — Tickets](#14-globe--tickets)
15. [Globe — Teardown Reports](#15-globe--teardown-reports)
16. [Globe — Daily Reports](#16-globe--daily-reports)
17. [Meralco — Poles (Read-Only)](#17-meralco--poles-read-only)
18. [Meralco — Summary](#18-meralco--summary)
19. [Admin — Users](#19-admin--users)
20. [Admin — Subcontractors](#20-admin--subcontractors)
21. [Admin — Teams](#21-admin--teams)
22. [Shared — Audit Logs](#22-shared--audit-logs)
23. [Shared — Support Tickets](#23-shared--support-tickets)
24. [Shared — PSGC Locations](#24-shared--psgc-locations)

---

## 1. Global

### Health Check
```
GET /api/v1/ping
```
No auth required.

**Response:**
```json
{ "status": "ok", "version": "v1" }
```

---

## 2. Authentication

Each company has its own auth prefix. Replace `{company}` with `skycable`, `globe`, `meralco`, or `admin`.

| Company | Prefix |
|---|---|
| Skycable | `/api/v1/skycable/auth` |
| Globe | `/api/v1/globe/auth` |
| Meralco | `/api/v1/meralco/auth` |
| Admin (TelcoVantage) | `/api/v1/admin/auth` |

---

### POST `/{company}/auth/login`
No auth required.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "yourpassword"
}
```

**Response 200:**
```json
{
  "token": "1|abc123...",
  "password_reset_required": false,
  "user": {
    "id": 1,
    "company": "skycable",
    "role": "lineman",
    "first_name": "Juan",
    "last_name": "Dela Cruz",
    "full_name": "Juan Dela Cruz",
    "email": "juan@example.com",
    "cellphone": "09171234567",
    "status": "active",
    "last_login": "2026-04-28T10:00:00.000000Z",
    "is_online": true
  }
}
```

**Response 401:** Invalid credentials  
**Response 403:** Account inactive / on hold

---

### POST `/{company}/auth/logout`
🔒 Requires Bearer token.

**Response:**
```json
{ "message": "Logged out successfully." }
```

---

### GET `/{company}/auth/me`
🔒 Requires Bearer token.

Returns the current authenticated user object (same shape as login response `user`).

---

### PUT `/{company}/auth/profile`
🔒 Requires Bearer token. Accepts `multipart/form-data`.

**Fields (all optional):**
| Field | Type | Notes |
|---|---|---|
| `first_name` | string | max 100 |
| `last_name` | string | max 100 |
| `cellphone` | string | max 20 |
| `address` | string | |
| `profile_photo` | file | image, max 10MB |

---

### POST `/{company}/auth/change-password`
🔒 Requires Bearer token.

**Request:**
```json
{
  "current_password": "oldpass",
  "password": "newpass12345",
  "password_confirmation": "newpass12345"
}
```
> `current_password` is not required if `password_reset_required` is `true`.

---

### POST `/{company}/auth/forgot-password`
No auth required.

**Request:**
```json
{ "email": "user@example.com" }
```

---

### POST `/{company}/auth/reset-password`
No auth required.

**Request:**
```json
{
  "token": "reset-token-from-email",
  "email": "user@example.com",
  "password": "newpass12345",
  "password_confirmation": "newpass12345"
}
```

---

## 3. Skycable — Areas

Base: `/api/v1/skycable` | 🔒 Auth required

### GET `/areas`
Returns all areas with node counts.

**Response:**
```json
[
  {
    "id": 1,
    "name": "Area North",
    "nodes_count": 12,
    "pending_count": 5,
    "in_progress_count": 4,
    "completed_count": 3
  }
]
```

---

### POST `/areas`
**Request:**
```json
{ "name": "Area North" }
```
> `name` must be unique.

**Response 201:** Created area object.

---

### GET `/areas/{id}`
Returns area with its nodes.

---

### PUT `/areas/{id}`
**Request:**
```json
{ "name": "Updated Name" }
```

---

### DELETE `/areas/{id}`
**Response:**
```json
{ "message": "Area deleted." }
```

---

## 4. Skycable — Sites

Base: `/api/v1/skycable` | 🔒 Auth required

### GET `/sites`
**Query params:**
| Param | Type | Description |
|---|---|---|
| `area_id` | integer | Filter by area |

**Response:** Array of sites with `area` and `nodes_count`.

---

### POST `/sites`
**Request:**
```json
{
  "area_id": 1,
  "name": "Site Alpha",
  "address": "123 Main St",
  "barangay_code": "101010"
}
```

| Field | Required | Notes |
|---|---|---|
| `area_id` | ✅ | Must exist in `skycable_areas` |
| `name` | ✅ | max 255 |
| `address` | ❌ | max 500 |
| `barangay_code` | ❌ | Must exist in PSGC barangays |

**Response 201:** Site with `area`.

---

### GET `/sites/{id}`
Returns site with `area`, `barangay`, `nodes.barangay`.

---

### PUT `/sites/{id}`
All fields optional (`sometimes`). Same fields as store.

---

### DELETE `/sites/{id}`
```json
{ "message": "Site deleted." }
```

---

## 5. Skycable — Nodes

Base: `/api/v1/skycable` | 🔒 Auth required

### GET `/nodes`
**Query params:**
| Param | Description |
|---|---|
| `area_id` | Filter by area |
| `site_id` | Filter by site |
| `subcontractor_id` | Filter by subcontractor |
| `status` | `pending` \| `in_progress` \| `completed` |

**Response:** Paginated (50/page), includes `area`, `site`, `subcontractor`, `team`.

---

### POST `/nodes`
**Request:**
```json
{
  "area_id": 1,
  "site_id": 2,
  "name": "Node A",
  "status": "pending",
  "subcontractor_id": 3,
  "team_id": 1,
  "barangay_code": "101010",
  "data_source": "manual",
  "expected_cable_meters": 500,
  "region": "NCR",
  "province": "Metro Manila",
  "city": "Quezon City",
  "barangay_name": "Barangay 1"
}
```

| Field | Required | Notes |
|---|---|---|
| `area_id` | ✅ | |
| `name` | ✅ | max 255 |
| `site_id` | ❌ | |
| `status` | ❌ | `pending` \| `in_progress` \| `completed` |
| `data_source` | ❌ | `manual` \| `json_import` \| `ai_scanner` |
| `expected_cable_meters` | ❌ | numeric |
| `subcontractor_id` | ❌ | |
| `team_id` | ❌ | |
| `barangay_code` | ❌ | max 20 |
| `region`, `province`, `city`, `barangay_name` | ❌ | max 255 each |

**Response 201:** Node with `area`.

---

### GET `/nodes/{id}`
Returns node with `area`, `barangay`, `subcontractor`, `team`, `skycablePoles.pole`, `spans`.

---

### PUT `/nodes/{id}`
All fields optional. Same fields as store.

---

### DELETE `/nodes/{id}`
```json
{ "message": "Node deleted." }
```

---

### POST `/nodes/{id}/import-poles`
Attach existing poles to a node.

**Request:**
```json
{
  "poles": [10, 11, 12]
}
```
> `poles` — array of existing `poles.id`. Sequence auto-assigned in order.

**Response:**
```json
{ "message": "Poles imported.", "count": 3 }
```

---

## 6. Skycable — Poles

Base: `/api/v1/skycable` | 🔒 Auth required

### GET `/nodes/{nodeId}/poles`
Returns all poles attached to a node, ordered by sequence.

**Response:**
```json
[
  {
    "id": 5,
    "node_id": 2,
    "pole_id": 10,
    "sequence": 1,
    "pole": {
      "id": 10,
      "pole_code": "SKY-001",
      "lat": "14.5995",
      "lng": "120.9842",
      "barangay_code": "101010",
      "skycable_status": "pending",
      "barangay": { ... },
      "cableSlots": [ ... ]
    }
  }
]
```

---

### POST `/poles`
Create a new pole and attach it to a node.

**Request:**
```json
{
  "pole_code": "SKY-NODE3-001",
  "node_id": 3,
  "lat": 14.5995,
  "lng": 120.9842,
  "barangay_code": "101010",
  "sequence": 1
}
```

| Field | Required | Notes |
|---|---|---|
| `pole_code` | ✅ | Globally unique |
| `node_id` | ✅ | Attaches pole to this node |
| `lat` | ❌ | numeric |
| `lng` | ❌ | numeric |
| `barangay_code` | ❌ | max 20 |
| `sequence` | ❌ | Auto-assigns max+1 if omitted |

**Response 201:**
```json
{
  "pole": {
    "id": 42,
    "pole_code": "SKY-NODE3-001",
    "lat": "14.5995",
    "lng": "120.9842",
    "skycable_status": "pending"
  },
  "node_pole": {
    "id": 7,
    "node_id": 3,
    "pole_id": 42,
    "sequence": 1
  }
}
```

---

### GET `/poles/{id}`
Returns pole with `barangay.city.province`, `cableSlots`.

---

### PUT `/poles/{id}`
**Request (all optional):**
```json
{
  "pole_code": "SKY-NEW-001",
  "lat": 14.60,
  "lng": 120.99,
  "skycable_status": "cleared"
}
```

| Field | Values |
|---|---|
| `pole_code` | Unique string |
| `lat`, `lng` | numeric |
| `skycable_status` | `pending` \| `in_progress` \| `cleared` |

---

### DELETE `/poles/{id}`
Removes the pole and its node attachment.

```json
{ "message": "Pole deleted." }
```

---

### GET `/poles/{id}/slots`
Returns all cable slots for the pole.

---

### POST `/poles/{id}/slots`
Add a cable slot to a pole.

**Request:**
```json
{
  "slot_label": "Slot A",
  "occupied_by": "skycable"
}
```

| Field | Required | Values |
|---|---|---|
| `slot_label` | ✅ | max 50 |
| `occupied_by` | ❌ | `skycable` \| `globe` |

**Response 201:** Cable slot object.

---

## 7. Skycable — Spans

Base: `/api/v1/skycable` | 🔒 Auth required

### GET `/spans`
**Query params:**
| Param | Description |
|---|---|
| `node_id` | Filter by node |
| `status` | `pending` \| `in_progress` \| `completed` \| `cancelled` |

**Response:** Plain array (not paginated).
```json
[
  {
    "id": 1,
    "node_id": 3,
    "from_pole_id": 5,
    "to_pole_id": 6,
    "span_code": "SP-LK2J4F-A1B",
    "strand_length": "100.00",
    "number_of_runs": 2,
    "actual_cable": "200.00",
    "status": "pending",
    "node": { ... },
    "from_pole": { "id": 5, "pole": { "pole_code": "SKY-001" } },
    "to_pole": { "id": 6, "pole": { "pole_code": "SKY-002" } },
    "components": [
      { "component_type": "node", "expected_count": 3 },
      { "component_type": "amplifier", "expected_count": 2 }
    ]
  }
]
```

**Component types:** `node`, `amplifier`, `extender`, `tsc`, `cable`, `powersupply`, `powersupply_case`

---

### POST `/spans`
**Request:**
```json
{
  "node_id": 3,
  "from_pole_id": 5,
  "to_pole_id": 6,
  "span_code": "SP-LK2J4F-A1B",
  "strand_length": 100,
  "number_of_runs": 2,
  "actual_cable": 200,
  "nodes_count": 3,
  "amplifier": 2,
  "extender": 1,
  "tsc": 0,
  "power_supply": 1,
  "power_supply_case": 1
}
```

| Field | Required | Notes |
|---|---|---|
| `node_id` | ✅ | |
| `from_pole_id` | ✅ | Must be a `skycable_poles.id` (the junction table ID, not `poles.id`) |
| `to_pole_id` | ✅ | Must differ from `from_pole_id` |
| `span_code` | ❌ | Auto-generate as `SP-{timestamp36}-{random}` |
| `strand_length` | ❌ | numeric |
| `number_of_runs` | ❌ | integer |
| `actual_cable` | ❌ | numeric — `strand_length × number_of_runs` |
| `nodes_count` | ❌ | integer — stored as component type `node` |
| `amplifier` | ❌ | integer — stored as component type `amplifier` |
| `extender` | ❌ | integer — stored as component type `extender` |
| `tsc` | ❌ | integer — stored as component type `tsc` |
| `power_supply` | ❌ | integer — stored as component type `powersupply` |
| `power_supply_case` | ❌ | integer — stored as component type `powersupply_case` |

**Response 201:** Span with `fromPole.pole`, `toPole.pole`, `components`.

---

### GET `/spans/{id}`
Returns span with `node`, `fromPole.pole`, `toPole.pole`, `components`, `teardownReports`.

---

### PUT `/spans/{id}`
All fields optional. Same component fields as store, plus:

| Field | Values |
|---|---|
| `status` | `pending` \| `in_progress` \| `completed` \| `cancelled` |

---

### DELETE `/spans/{id}`
(No response body — soft-deleted.)

---

### PUT `/spans/{id}/components`
Bulk update/create span components directly.

**Request:**
```json
{
  "components": [
    { "component_type": "node", "expected_count": 5, "actual_count": 4, "unit": "pcs" },
    { "component_type": "amplifier", "expected_count": 2, "actual_count": null, "unit": null }
  ]
}
```

| Field | Required |
|---|---|
| `component_type` | ✅ |
| `expected_count` | ✅ integer ≥ 0 |
| `actual_count` | ❌ integer |
| `unit` | ❌ string |

**Response:** Span with updated `components`.

---

## 8. Skycable — Teardown Reports

Base: `/api/v1/skycable` | 🔒 Auth required

### GET `/teardowns`
**Query params:** `span_id`, `team_id`, `status`

**Response:** Paginated (50/page), includes `span.node`, `team`, `lineman`.

---

### POST `/teardowns/start`
Start a teardown report.

**Request:**
```json
{
  "span_id": 1,
  "team_id": 2,
  "start_time": "2026-04-28T08:00:00",
  "expected_cable": 200.00,
  "offline_mode": false,
  "captured_at_device": "2026-04-28T08:00:00",
  "captured_lat": 14.5995,
  "captured_lng": 120.9842
}
```

| Field | Required |
|---|---|
| `span_id` | ✅ |
| `team_id` | ✅ |
| `start_time` | ✅ date |
| `expected_cable` | ❌ numeric |
| `offline_mode` | ❌ boolean |
| `captured_at_device` | ❌ date |
| `captured_lat`, `captured_lng` | ❌ numeric |

**Response 201:** Teardown report object (status: `pending`).

---

### GET `/teardowns/{id}`
Returns report with `span.fromPole.pole`, `span.toPole.pole`, `team`, `lineman`, `slots`, `photos`.

---

### POST `/teardowns/{id}/submit`
Submit a completed teardown. Accepts `multipart/form-data`.

**Fields:**
| Field | Required | Notes |
|---|---|---|
| `end_time` | ✅ | Must be after `start_time` |
| `actual_cable` | ❌ | numeric |
| `before_photo` | ❌ | image file, max 10MB |
| `after_photo` | ❌ | image file, max 10MB |
| `pole_tag_photo` | ❌ | image file, max 10MB |
| `bunching_photo` | ❌ | image file, max 10MB |
| `notes` | ❌ | string |
| `slots` | ❌ | array |
| `slots[].pole_id` | ✅ if slots | |
| `slots[].pole_cable_slot_id` | ✅ if slots | |
| `slots[].slot_label` | ✅ if slots | |

**Response:** Updated report with `slots`, `photos`.

> Only the lineman who created the report (or admin/pm/executive) can submit.

---

### PUT `/teardowns/{id}/review`
Subcontractor review (approve/reject).

**Request:**
```json
{
  "action": "approve",
  "rejection_reason": null
}
```
> `rejection_reason` required if `action` is `reject`.

**Resulting statuses:** `subcon_approved` | `rejected`

---

### PUT `/teardowns/{id}/backend-approve`
Backend final approval.

**Request:** Same as review.

**Resulting statuses:** `backend_approved` | `rejected`

> On `backend_approved`: frees cable slots, auto-completes the span if all its teardowns are approved.

---

## 9. Skycable — Daily Reports

Base: `/api/v1/skycable` | 🔒 Auth required

### GET `/daily-reports`
**Query params:** `node_id`, `team_id`, `status`, `date` (YYYY-MM-DD)

**Response:** Paginated (30/page), includes `node`, `team`, `subcontractor`, `submittedBy`.

---

### POST `/daily-reports`
**Request:**
```json
{
  "node_id": 3,
  "team_id": 2,
  "subcontractor_id": 1,
  "report_date": "2026-04-28",
  "teardown_report_ids": [10, 11, 12],
  "notes": "Completed span 3 today."
}
```

| Field | Required |
|---|---|
| `node_id` | ✅ |
| `team_id` | ✅ |
| `subcontractor_id` | ✅ |
| `report_date` | ✅ date |
| `teardown_report_ids` | ✅ array, min 1 |
| `notes` | ❌ |

**Response 201:** Daily report with `teardownReports`.

---

### GET `/daily-reports/{id}`
Returns report with `node`, `team`, `subcontractor`, `submittedBy`, teardown details, photos. Also returns `missing_images` array.

---

### GET `/daily-reports/{id}/missing-images`
Returns list of teardown report slots that are missing required photos.

---

### PUT `/daily-reports/{id}/subcon-review`
**Request:** `{ "action": "approve" | "reject", "rejection_reason": "..." }`

**Resulting statuses:** `subcon_approved` | `rejected`

---

### PUT `/daily-reports/{id}/backend-approve`
**Request:** Same as subcon-review.

**Resulting statuses:** `backend_approved` | `rejected`

---

## 10. Skycable — Warehouses & Stock

Base: `/api/v1/skycable` | 🔒 Auth required

### GET `/warehouses`
**Query params:** `type`, `subcontractor_id`

**Response:** Array with `subcontractor`, `stocks`.

---

### GET `/warehouses/{id}`
Returns warehouse with `subcontractor`, `stocks`, `receipts.items`.

---

### PUT `/warehouses/{id}`
**Request (all optional):**
```json
{
  "name": "Main Warehouse",
  "sqm": 150.5,
  "status": "active"
}
```

---

### GET `/warehouses/{id}/stocks`
Returns current stock levels.

**Response:**
```json
[
  { "item_type": "cable", "quantity": 500, "unit": "meters" }
]
```

---

### GET `/warehouses/{id}/receipts`
**Query param:** `status`

**Response:** Paginated (30/page), includes `items`, `receivedBy`, `node`.

---

### POST `/warehouse-receipts`
Receive stock into a warehouse.

**Request:**
```json
{
  "warehouse_id": 1,
  "subcontractor_id": 2,
  "node_id": 3,
  "receipt_date": "2026-04-28",
  "items": [
    { "item_type": "cable", "quantity": 200, "unit": "meters" },
    { "item_type": "amplifier", "quantity": 5, "unit": "pcs" }
  ]
}
```

| Field | Required |
|---|---|
| `warehouse_id` | ✅ |
| `receipt_date` | ✅ date |
| `items` | ✅ array, min 1 |
| `items[].item_type` | ✅ |
| `items[].quantity` | ✅ numeric > 0 |
| `items[].unit` | ❌ |
| `subcontractor_id`, `node_id` | ❌ |

**Response 201:** Receipt with `items` (status: `pending`).

---

### PUT `/warehouse-receipts/{id}/approve`
**Request:** `{ "action": "approve" | "reject" }`

> On `approve`: adds quantities to warehouse stocks.

---

## 11. Skycable — Deliveries & Pickup Requests

Base: `/api/v1/skycable` | 🔒 Auth required

### GET `/pickup-requests`
**Query param:** `status`

**Response:** Paginated, includes `fromWarehouse`, `toWarehouse`, `requestedBy`.

---

### POST `/pickup-requests`
**Request:**
```json
{
  "from_warehouse_id": 1,
  "to_warehouse_id": 2
}
```
> `from_warehouse_id` must differ from `to_warehouse_id`.

**Response 201:** Pickup request (status: `pending`).

---

### PUT `/pickup-requests/{id}/approve`
**Request:** `{ "action": "approve" | "reject" }`

---

### GET `/deliveries`
**Query param:** `status`

**Response:** Paginated, includes `fromWarehouse`, `toWarehouse`, `dispatchedBy`, `items`.

---

### POST `/deliveries/{pickupRequestId}/dispatch`
Dispatch a delivery from an approved pickup request.

**Request:**
```json
{
  "items": [
    { "item_type": "cable", "quantity": 100, "unit": "meters" }
  ]
}
```
> Dispatching decrements stock from the source warehouse.

**Response 201:** Delivery with `items` (status: `in_transit`).

---

### PUT `/deliveries/{id}/accept`
Accept an incoming delivery.

> Accepting increments stock in the destination warehouse.

**Response:** Delivery with `items` (status: `accepted`).

---

### GET `/pull-out-requests`
**Query param:** `status`

**Response:** Paginated, includes `warehouse`, `declaredBy`.

---

### POST `/pull-out-requests`
**Request:**
```json
{
  "warehouse_id": 1,
  "purpose": "for_sale",
  "destination": "Customer ABC",
  "items": [
    { "item_type": "cable", "quantity": 50, "unit": "meters" }
  ]
}
```

| Field | Required | Values |
|---|---|---|
| `warehouse_id` | ✅ | |
| `purpose` | ✅ | `for_sale` \| `for_delivery` |
| `destination` | ❌ | |
| `items` | ✅ | array, min 1 |

**Response 201:** Pull-out request with `items` (status: `pending`).

---

### PUT `/pull-out-requests/{id}/approve`
**Request:** `{ "action": "approve" | "reject" }`

---

## 12. Globe — NAP Boxes & Ports

Base: `/api/v1/globe` | 🔒 Auth required

### GET `/poles/{poleId}/nap-boxes`
**Query params:** `pole_id`, `status`

**Response:** Paginated (50/page), includes `pole.barangay`.

---

### POST `/nap-boxes`
**Request:**
```json
{
  "pole_id": 10,
  "nap_code": "NAP-001",
  "port_count": 16,
  "status": "active"
}
```

| Field | Required | Values |
|---|---|---|
| `pole_id` | ✅ | |
| `nap_code` | ✅ | Globally unique |
| `port_count` | ✅ | `8` \| `12` \| `16` \| `32` |
| `status` | ❌ | `active` \| `inactive` \| `removed` |

**Response 201:** NAP box with `ports` (auto-created).

---

### GET `/nap-boxes/{id}`
Returns NAP box with `pole.barangay`, `ports`, `surveys`.

---

### PUT `/nap-boxes/{id}`
**Request (optional):**
```json
{ "nap_code": "NAP-002", "status": "inactive" }
```

---

### GET `/nap-boxes/{id}/ports`
Returns all ports with `surveyedBy`.

**Response:**
```json
[
  {
    "id": 1,
    "nap_box_id": 5,
    "port_number": 1,
    "status": "active",
    "subscriber_id": "SUB123",
    "subscriber_name": "Juan Dela Cruz",
    "account_number": "ACC456",
    "surveyed_at": "2026-04-28T10:00:00.000000Z"
  }
]
```

---

### PUT `/nap-boxes/{id}/ports/{portNumber}`
Update a single port.

**Request:**
```json
{
  "status": "active",
  "subscriber_id": "SUB123",
  "subscriber_name": "Juan Dela Cruz",
  "account_number": "ACC456"
}
```

| Field | Required | Values |
|---|---|---|
| `status` | ✅ | `active` \| `inactive` \| `free` |
| `subscriber_id` | ❌ | Cleared automatically if status=`free` |
| `subscriber_name` | ❌ | |
| `account_number` | ❌ | |

---

## 13. Globe — Surveys

Base: `/api/v1/globe` | 🔒 Auth required

### GET `/nap-boxes/{napBoxId}/surveys`
Returns all surveys for the NAP box (latest first), includes `surveyedBy`.

---

### POST `/nap-boxes/{napBoxId}/surveys`
Create a survey for a NAP box.

**Request:**
```json
{
  "items": [
    {
      "port_number": 1,
      "status": "active",
      "subscriber_id": "SUB001",
      "subscriber_name": "Juan Dela Cruz",
      "account_number": "ACC001"
    },
    {
      "port_number": 2,
      "status": "free"
    }
  ]
}
```

| Field | Required | Values |
|---|---|---|
| `items` | ✅ | array, min 1 |
| `items[].port_number` | ✅ | integer ≥ 1 |
| `items[].status` | ✅ | `active` \| `inactive` \| `free` |
| `items[].subscriber_id`, `subscriber_name`, `account_number` | ❌ | |

**Response 201:** Survey with `items` (status: `pending`).

---

### GET `/surveys/{id}`
Returns survey with `napBox.pole`, `surveyedBy`, `items`.

---

### PUT `/surveys/{id}/submit`
Finalizes the survey, applies results to actual port records.

> Status becomes `complete` if all ports were surveyed, otherwise `partial`.

**Response:** Updated survey.

---

## 14. Globe — Tickets

Base: `/api/v1/globe` | 🔒 Auth required

### GET `/tickets`
**Query params:** `status`, `team_id`, `pole_id`

**Response:** Paginated (50/page).

**Status values:** `pending` | `in_progress` | `for_approval` | `completed` | `cancelled` | `rejected`

---

### POST `/tickets`
**Request:**
```json
{
  "pole_id": 10,
  "nap_box_id": 5,
  "subcontractor_id": 1,
  "team_id": 2
}
```

| Field | Required |
|---|---|
| `pole_id` | ✅ |
| `nap_box_id`, `subcontractor_id`, `team_id` | ❌ |

**Response 201:** Ticket with auto-generated `ticket_number` (format: `GLB-XXXXXXXX`), status: `pending`.

---

### GET `/tickets/{id}`
Returns ticket with `pole.barangay`, `napBox.ports`, `team`, `subcontractor`, `claimedBy`, `teardownReport.slots`.

---

### PUT `/tickets/{id}`
**Request (all optional):**
```json
{
  "subcontractor_id": 1,
  "team_id": 2,
  "status": "in_progress"
}
```

---

### POST `/tickets/{id}/claim`
Claim a pending ticket.

**Request (optional):**
```json
{ "team_id": 2 }
```
> Only works if ticket status is `pending`. Sets status to `in_progress`.

---

### PUT `/tickets/{id}/cancel`
Sets ticket status to `cancelled`. No body required.

---

## 15. Globe — Teardown Reports

Base: `/api/v1/globe` | 🔒 Auth required

### POST `/tickets/{ticketId}/teardown`
Submit a teardown report for a ticket. Accepts `multipart/form-data`.

**Fields:**
| Field | Required | Notes |
|---|---|---|
| `wire_status` | ✅ | `removed` \| `partially_removed` \| `unable_to_remove` |
| `teardown_date` | ✅ | date |
| `before_photo` | ❌ | image, max 10MB |
| `after_photo` | ❌ | image, max 10MB |
| `pole_tag_photo` | ❌ | image, max 10MB |
| `slots` | ❌ | array |
| `slots[].pole_id` | ✅ if slots | |
| `slots[].pole_cable_slot_id` | ✅ if slots | |
| `slots[].slot_label` | ✅ if slots | |
| `offline_mode` | ❌ | boolean |
| `captured_at_device` | ❌ | date |
| `captured_lat`, `captured_lng` | ❌ | numeric |

> Only one teardown report per ticket. Auto-sets ticket status to `for_approval`.

**Response 201:** Report with `slots`.

---

### GET `/teardowns/{id}`
Returns teardown report with `ticket.pole`, `lineman`, `slots.pole`, `slots.cableSlot`.

---

### PUT `/teardowns/{id}/approve`
**Request:**
```json
{
  "action": "approve",
  "rejection_reason": null
}
```

> On `approve`: frees cable slots, sets ticket to `completed`.  
> On `reject`: sets ticket to `rejected`.

---

## 16. Globe — Daily Reports

Base: `/api/v1/globe` | 🔒 Auth required

### GET `/daily-reports`
**Query params:** `team_id`, `status`, `date`

**Response:** Paginated (30/page), includes `team`, `submittedBy`.

---

### POST `/daily-reports`
**Request:**
```json
{
  "team_id": 2,
  "report_date": "2026-04-28",
  "ticket_ids": [10, 11, 12]
}
```

| Field | Required |
|---|---|
| `team_id` | ✅ |
| `report_date` | ✅ date |
| `ticket_ids` | ✅ array, min 1 |

**Response 201:** Daily report with `tickets`. Auto-calculates `total_tickets`, `total_completed`, `total_rejected`.

---

### GET `/daily-reports/{id}`
Returns report with `team`, `submittedBy`, `approvedBy`, `tickets.teardownReport`.

---

### PUT `/daily-reports/{id}/approve`
**Request:** `{ "action": "approve" | "reject", "rejection_reason": "..." }`

**Resulting statuses:** `approved` | `rejected`

---

## 17. Meralco — Poles (Read-Only)

Base: `/api/v1/meralco` | 🔒 Auth required

### GET `/poles`
**Query params:**
| Param | Description |
|---|---|
| `barangay_code` | Filter by barangay |
| `skycable_status` | `pending` \| `in_progress` \| `cleared` |
| `globe_status` | same values |
| `search` | Partial match on `pole_code` |

**Response:** Paginated (50/page), includes `barangay.city.province.region`, `cableSlots`, `napBoxes`.

---

### GET `/poles/{id}`
Returns pole with `barangay.city.province.region`, `cableSlots`, `napBoxes.ports`.

---

### GET `/poles/{id}/teardown-proof`
Returns proof of clearance documents for a pole.

**Response:**
```json
{
  "pole": { "id": 10, "pole_code": "SKY-001", "skycable_status": "cleared", "globe_status": "cleared" },
  "skycable_proof": {
    "cleared_at": "2026-04-20T00:00:00.000000Z",
    "spans": [
      {
        "span_code": "SP-ABC123",
        "teardown_reports": [ ... ]
      }
    ]
  },
  "globe_proof": {
    "cleared_at": "2026-04-21T00:00:00.000000Z",
    "tickets": [ ... ]
  }
}
```

> `skycable_proof` is `null` if pole is not `cleared` for Skycable.  
> `globe_proof` is `null` if pole is not `cleared` for Globe.

---

## 18. Meralco — Summary

Base: `/api/v1/meralco` | 🔒 Auth required

### GET `/summary`
Returns a cross-company overview.

**Response:**
```json
{
  "poles": {
    "total": 500,
    "skycable_active": 200,
    "skycable_cleared": 150,
    "globe_active": 180,
    "globe_cleared": 120,
    "fully_cleared": 100
  },
  "skycable": {
    "nodes_total": 30,
    "nodes_completed": 18
  },
  "globe": {
    "tickets_total": 450,
    "tickets_completed": 320
  }
}
```

---

## 19. Admin — Users

Base: `/api/v1/admin` | 🔒 Auth required (TelcoVantage only)

### GET `/users`
**Query params:** `company`, `role`, `status`, `subcontractor_id`, `search` (name/email)

**Response:** Paginated (30/page), includes soft-deleted users (`withTrashed`), `subcontractor`, `team`.

---

### POST `/users`
**Request:**
```json
{
  "company": "skycable",
  "role": "lineman",
  "first_name": "Juan",
  "last_name": "Dela Cruz",
  "email": "juan@example.com",
  "cellphone": "09171234567",
  "address": "123 Main St",
  "subcontractor_id": 1,
  "team_id": 2,
  "project_access": ["node_1", "node_2"],
  "status": "active"
}
```

| Field | Required | Values |
|---|---|---|
| `company` | ✅ | `skycable` \| `globe` \| `meralco` \| `telcovantage` |
| `role` | ✅ | string |
| `first_name`, `last_name` | ✅ | max 100 |
| `email` | ✅ | unique |
| `status` | ❌ | `active` \| `inactive` \| `on_hold` (default: `active`) |

**Response 201:**
```json
{
  "user": { ... },
  "temp_password": "Xk9mP2qRvT8n"
}
```
> A temporary password is auto-generated. User will be required to change it on first login.

---

### GET `/users/{id}`
Returns user with `subcontractor`, `team`.

---

### PUT `/users/{id}`
**Request (all optional):** `role`, `first_name`, `last_name`, `cellphone`, `address`, `subcontractor_id`, `team_id`, `project_access`

---

### PUT `/users/{id}/status`
**Request:**
```json
{ "status": "inactive" }
```
Values: `active` | `inactive` | `on_hold`

---

### POST `/users/{id}/reset-password`
Generates a new temporary password and revokes all existing tokens.

**Response:**
```json
{ "temp_password": "Ym3nK7xLpQ1w" }
```

---

### DELETE `/users/{id}`
Soft-deletes the user and revokes all tokens.

---

### POST `/users/{id}/restore`
Restores a soft-deleted user.

---

## 20. Admin — Subcontractors

Base: `/api/v1/admin` | 🔒 Auth required (TelcoVantage only)

### GET `/subcontractors`
**Query params:** `company`, `status`

**Response:** Paginated (30/page), includes `teams`.

---

### POST `/subcontractors`
**Request:**
```json
{
  "company": "skycable",
  "name": "ABC Contractors",
  "contact_name": "Pedro Santos",
  "contact_phone": "09181234567",
  "contact_email": "pedro@abc.com",
  "address": "456 Sub St",
  "status": "active"
}
```

| Field | Required | Values |
|---|---|---|
| `company` | ✅ | `skycable` \| `globe` |
| `name` | ✅ | max 255 |
| `status` | ❌ | `active` \| `inactive` |

**Response 201:** Subcontractor with `warehouses`.

---

### GET `/subcontractors/{id}`
Returns subcontractor with `teams.members`, `warehouses.stocks`.

---

### PUT `/subcontractors/{id}`
All fields optional. Same as store (except `company`).

---

### DELETE `/subcontractors/{id}`
```json
{ "message": "Subcontractor deleted." }
```

---

## 21. Admin — Teams

Base: `/api/v1/admin` | 🔒 Auth required (TelcoVantage only)

### GET `/teams`
**Query params:** `company`, `subcontractor_id`, `status`

**Response:** Paginated (30/page), includes `subcontractor`, `members`.

---

### POST `/teams`
**Request:**
```json
{
  "company": "skycable",
  "name": "Team Alpha",
  "subcontractor_id": 1,
  "status": "active"
}
```

| Field | Required | Values |
|---|---|---|
| `company` | ✅ | `skycable` \| `globe` |
| `name` | ✅ | max 255 |
| `status` | ❌ | `active` \| `inactive` |

---

### GET `/teams/{id}`
Returns team with `subcontractor`, `members`.

---

### PUT `/teams/{id}`
**Request (all optional):** `name`, `subcontractor_id`, `status`

---

### DELETE `/teams/{id}`
```json
{ "message": "Team deleted." }
```

---

### POST `/teams/{id}/members`
Add a user to a team.

**Request:**
```json
{
  "user_id": 5,
  "role": "leader"
}
```
> `role` defaults to `"member"` if omitted.

**Response:** Team with updated `members`.

---

### DELETE `/teams/{id}/members`
Remove a user from a team.

**Request:**
```json
{ "user_id": 5 }
```

**Response:**
```json
{ "message": "Member removed." }
```

---

## 22. Shared — Audit Logs

Available in: `admin`, `skycable`, `globe` | 🔒 Auth required

### GET `/{company}/audit-logs`
**Query params:**
| Param | Description |
|---|---|
| `company` | (admin only) filter by company |
| `user_id` | filter by user |
| `action` | `create` \| `update` \| `delete` |
| `model_type` | e.g. `App\Models\SkycablePole` |
| `model_id` | specific record ID |
| `from` | date (YYYY-MM-DD) |
| `to` | date (YYYY-MM-DD) |

**Response:** Paginated (50/page), includes `user`.

```json
{
  "data": [
    {
      "id": 1,
      "action": "create",
      "model_type": "App\\Models\\Pole",
      "model_id": 42,
      "old_values": null,
      "new_values": { "pole_code": "SKY-001", ... },
      "user": { "id": 1, "full_name": "Juan Dela Cruz" },
      "created_at": "2026-04-28T10:00:00.000000Z"
    }
  ]
}
```

---

### GET `/admin/audit-logs/{id}`
Returns single audit log entry with `user`.

---

## 23. Shared — Support Tickets

Available in: `admin`, `skycable`, `globe`, `meralco` | 🔒 Auth required

### GET `/{company}/support/tickets`
**Query params:** `status`, `priority`

> Non-admin users only see their own tickets.  
> Admin/executive/pm can filter by `company`.

**Status values:** `open` | `in_progress` | `resolved` | `closed`  
**Priority values:** `low` | `medium` | `high` | `urgent`

---

### POST `/{company}/support/tickets`
**Request:**
```json
{
  "subject": "Issue with pole data",
  "description": "Pole SKY-001 is showing wrong coordinates.",
  "priority": "high"
}
```

| Field | Required | Values |
|---|---|---|
| `subject` | ✅ | max 255 |
| `description` | ✅ | |
| `priority` | ❌ | `low` \| `medium` \| `high` \| `urgent` (default: `medium`) |

**Response 201:** Ticket with auto-generated `ticket_number` (format: `TKT-XXXXXXXX`).

---

### GET `/{company}/support/tickets/{id}`
Returns ticket with `submittedBy`, `assignedTo`, `messages.sender`, `messages.attachments`.

---

### POST `/{company}/support/tickets/{id}/reply`
Send a reply. Accepts `multipart/form-data`.

**Fields:**
| Field | Required | Notes |
|---|---|---|
| `message` | ✅ | |
| `attachments` | ❌ | array of files, max 10MB each |

**Response 201:** Message with `attachments`.

---

### PUT `/admin/support/tickets/{id}/assign`
Assign a ticket to a user. (Admin only)

**Request:**
```json
{ "assigned_to": 5 }
```
> Sets status to `in_progress`.

---

### PUT `/admin/support/tickets/{id}/status`
Update ticket status. (Admin only)

**Request:**
```json
{ "status": "resolved" }
```
> Sets `resolved_at` / `closed_at` timestamp automatically.

---

## 24. Shared — PSGC Locations

Available in: all companies | 🔒 Auth required

### GET `/{company}/locations/regions`
### GET `/{company}/locations/provinces`
### GET `/{company}/locations/cities`
### GET `/{company}/locations/barangays`

Returns PSGC lookup data for the Philippines.

---

## Error Responses

All errors follow a consistent format:

**401 — Unauthenticated:**
```json
{ "message": "Unauthenticated." }
```

**403 — Forbidden:**
```json
{ "message": "This action is unauthorized." }
```

**422 — Validation Error:**
```json
{
  "message": "The pole code has already been taken.",
  "errors": {
    "pole_code": ["The pole code has already been taken."]
  }
}
```

**404 — Not Found:**
```json
{ "message": "No query results for model [App\\Models\\Pole] 999" }
```

---

## Quick Reference — Headers

All requests must include:
```
Accept: application/json
Content-Type: application/json        (for JSON body requests)
Authorization: Bearer {token}         (for protected routes)
ngrok-skip-browser-warning: 1         (required for ngrok tunnel)
```

For file uploads use `Content-Type: multipart/form-data` instead of `application/json`.
