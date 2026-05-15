# sgis-backend

**Surveyor General Information System — Backend API**
Office of the Surveyor General · KWGIS · Kwara State
Developer: Naviss Technologies

---

## Stack

| Layer       | Technology                  |
|-------------|------------------------------|
| Runtime     | Bun                          |
| Framework   | Express.js                   |
| Language    | JavaScript (ES Modules)      |
| Database    | PostgreSQL 16 + PostGIS      |
| Auth        | JWT (jsonwebtoken + bcryptjs)|
| File upload | Multer (local disk)          |
| Security    | Helmet + express-rate-limit  |
| Linting     | ESLint 9 (flat config)       |
| Formatting  | Prettier                     |

---

## Project Structure

```
sgis-backend/
├── db/
│   ├── 001_schema.sql              # Full PostgreSQL schema — run first
│   └── 002_seed_surveyors.sql      # 56 licensed surveyors — run second
├── src/
│   ├── index.js                    # Express app entry point — all routes wired
│   ├── db/
│   │   └── pool.js                 # PostgreSQL connection pool
│   ├── lib/
│   │   ├── refNumbers.js           # Auto-reference number generators (all 6 formats)
│   │   └── upload.js               # Multer config — local disk storage, MIME filter
│   ├── middleware/
│   │   ├── auth.js                 # JWT requireAuth + requireRole guards
│   │   └── errorHandler.js         # Central Express error handler
│   └── routes/
│       ├── auth.js                 # Login, logout, /me, change-password, staff CRUD
│       ├── surveyors.js            # Phase 2 — Surveyor register + autocomplete
│       ├── applications.js         # Phase 3 — DB1 Pillar Applications
│       ├── lodgments.js            # Phase 4 — DB2 Surveyor Lodgments + certificate
│       ├── clients.js              # Phase 5 — DB3 Client Lodgments + charting
│       ├── comparison.js           # Phase 6 — Comparison Engine (all 10 checks)
│       ├── documents.js            # Phase 7 — Certificate + CIR data endpoints
│       ├── dashboard.js            # Phase 8 — Stats, quarterly, search
│       ├── uploads.js              # File upload endpoint (plan, stamp, red_copy, document)
│       └── lgas.js                 # LGA reference list for form dropdowns
├── uploads/                        # Created automatically on first run (gitignored)
│   ├── plans/
│   ├── stamps/
│   ├── red_copies/
│   └── documents/
├── .env.example
├── .gitignore
├── eslint.config.js
├── .prettierrc
├── package.json
└── README.md
```

---

## Setup

### 1. Prerequisites

- Bun installed → https://bun.sh
- PostgreSQL 16 running locally (with PostGIS and pg_trgm extensions available)

### 2. Install dependencies

```bash
cd sgis-backend
bun install
```

### 3. Environment

```bash
cp .env.example .env
# Edit .env — set DB_PASSWORD, JWT_SECRET (min 32 chars), and confirm other values
```

### 4. Create database and apply schema

```bash
psql -U postgres -c "CREATE DATABASE sgis;"
psql -U postgres -d sgis -f db/001_schema.sql
psql -U postgres -d sgis -f db/002_seed_surveyors.sql
```

### 5. Set the default admin password

The schema seeds a default admin account with a placeholder password hash.
Replace it with a real bcrypt hash before first use:

```bash
# Generate a bcrypt hash for your chosen password (rounds=12):
node -e "import('bcryptjs').then(b => b.default.hash('YourPassword123', 12).then(console.log))"

# Then update the DB:
psql -U postgres -d sgis -c "UPDATE staff_users SET password_hash = '<paste_hash_here>' WHERE email = 'admin@kwgis.gov.ng';"
```

Or log in via the API after starting the server and use `POST /api/auth/change-password`.

### 6. Start dev server

```bash
bun dev
# → API running at http://localhost:4000
# → Uploads served at http://localhost:4000/uploads
```

### 7. Verify

```bash
curl http://localhost:4000/api/health
# → {"status":"ok","service":"SGIS API","ts":"..."}

curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@kwgis.gov.ng","password":"YourPassword123"}'
# → {"token":"eyJ...","user":{...}}
```

---

## Authentication

All API endpoints except `/api/health` and `POST /api/auth/login` require a valid JWT token.

**Login:**
```
POST /api/auth/login
Body: { "email": "...", "password": "..." }
Response: { "token": "eyJ...", "user": { "id", "email", "role", "fullName" } }
```

**Use the token:**
```
Authorization: Bearer eyJ...
```

**Roles:**

| Role    | Permissions |
|---------|-------------|
| `admin` | Full access — create/edit all records, issue certificates, sign CIR, manage staff |
| `staff` | Create and edit records — cannot issue certificates or sign CIR |
| `viewer`| Read-only — GET endpoints only |

---

## API Reference

### Auth

| Method | Endpoint                    | Auth         | Description                              |
|--------|-----------------------------|--------------|------------------------------------------|
| POST   | `/api/auth/login`           | Public       | Log in — returns JWT                     |
| POST   | `/api/auth/logout`          | Public       | Client-side token discard                |
| GET    | `/api/auth/me`              | Any role     | Current user profile                     |
| POST   | `/api/auth/change-password` | Any role     | Change own password                      |
| POST   | `/api/auth/staff`           | admin only   | Create a new staff account               |
| GET    | `/api/auth/staff`           | admin only   | List all staff accounts                  |
| PATCH  | `/api/auth/staff/:id`       | admin only   | Update role or active status             |

### LGAs

| Method | Endpoint    | Auth     | Description                           |
|--------|-------------|----------|---------------------------------------|
| GET    | `/api/lgas` | Any role | 16 Kwara State LGAs for form dropdowns|

### File Uploads

| Method | Endpoint              | Auth          | Description                                    |
|--------|-----------------------|---------------|------------------------------------------------|
| POST   | `/api/uploads/plan`   | admin, staff  | Upload survey plan scan (PDF/image)            |
| POST   | `/api/uploads/stamp`  | admin, staff  | Upload surveyor stamp image                    |
| POST   | `/api/uploads/red_copy` | admin, staff| Upload RED COPY scan                           |
| POST   | `/api/uploads/document` | admin, staff| Upload supporting document                     |

Send as `multipart/form-data` with a single field named `file`.
Returns `{ url, originalName, size, mimetype }`.
The `url` value is stored in the database and served at `GET /uploads/<folder>/<filename>`.

### Surveyors

| Method | Endpoint                       | Auth     | Description                              |
|--------|--------------------------------|----------|------------------------------------------|
| GET    | `/api/surveyors/search?q=`     | Any role | Autocomplete — min 2 chars, active only  |
| GET    | `/api/surveyors/:id`           | Any role | Single surveyor — auto-fill form fields  |
| GET    | `/api/surveyors`               | Any role | Paginated register list                  |

### Pillar Applications (DB1)

| Method | Endpoint                        | Auth          | Description                              |
|--------|---------------------------------|---------------|------------------------------------------|
| POST   | `/api/applications`             | admin, staff  | Create new Pillar Application            |
| GET    | `/api/applications`             | Any role      | List all (filter: status, lga, year, q)  |
| GET    | `/api/applications/:planNumber` | Any role      | Fetch single + linked DB2 + DB3          |
| PATCH  | `/api/applications/:planNumber` | admin, staff  | Update status or notes                   |

### Surveyor Lodgments (DB2)

| Method | Endpoint                                   | Auth          | Description                                   |
|--------|--------------------------------------------|---------------|-----------------------------------------------|
| POST   | `/api/lodgments`                           | admin, staff  | Create — auto-generates cert no.              |
| GET    | `/api/lodgments`                           | Any role      | List (filter: certStatus, year, quarter, q)   |
| GET    | `/api/lodgments/:planNumber`               | Any role      | Fetch single                                  |
| PATCH  | `/api/lodgments/:planNumber`               | admin, staff  | Update document URLs / editable fields        |
| PATCH  | `/api/lodgments/:planNumber/certificate`   | admin, staff  | Update certificate status (issued: admin only)|

### Client Lodgments (DB3)

| Method | Endpoint                        | Auth          | Description                              |
|--------|---------------------------------|---------------|------------------------------------------|
| POST   | `/api/clients`                  | admin, staff  | Create — auto-generates 5 ref numbers    |
| GET    | `/api/clients`                  | Any role      | List (filter: status, q)                 |
| GET    | `/api/clients/:planNumber`      | Any role      | Fetch single                             |
| PATCH  | `/api/clients/:planNumber`      | admin, staff  | Update charting data + 3 status checks   |

### Comparison Engine

| Method | Endpoint                        | Auth          | Description                              |
|--------|---------------------------------|---------------|------------------------------------------|
| GET    | `/api/comparison/:planNumber`   | Any role      | Fetch latest result (auto-runs if none)  |
| POST   | `/api/comparison/:planNumber`   | Any role      | Force fresh engine run                   |

### Documents

| Method | Endpoint                                   | Auth     | Description                        |
|--------|--------------------------------------------|----------|------------------------------------|
| GET    | `/api/documents/certificate/:planNumber`   | Any role | Lodgement Certificate data         |
| GET    | `/api/documents/cir/:planNumber`           | Any role | Charting Information Report data   |

### Dashboard

| Method | Endpoint                        | Auth     | Description                              |
|--------|----------------------------------|----------|------------------------------------------|
| GET    | `/api/dashboard/stats`          | Any role | Top-level counts for dashboard cards     |
| GET    | `/api/dashboard/quarterly`      | Any role | Quarterly breakdown (filter: year)       |
| GET    | `/api/dashboard/pending`        | Any role | All pending applications (no DB2 yet)    |
| GET    | `/api/dashboard/flagged`        | Any role | All flagged / warned plans               |
| GET    | `/api/dashboard/search?q=`      | Any role | Global search across all 3 databases     |

---

## Business Rules Enforced

| Rule | Where enforced |
|------|----------------|
| Plan number globally unique | DB UNIQUE constraint |
| Pillar numbers globally unique | DB trigger `fn_register_pillar_numbers` |
| Only active surveyors in autocomplete | Route query filter |
| DB1 status flips to `complete` when DB2 saved | DB trigger `fn_complete_application_on_lodgment` |
| DB2 pillar numbers must be subset of DB1 | Route validation before INSERT |
| DB2 plan number must exist in DB1 | Route validation before INSERT |
| DB3 plan number must exist in DB1 | Route validation before INSERT |
| Certificate starts as `draft` | Default in INSERT |
| Only admin can issue a certificate | `requireRole('admin')` guard in certificate PATCH |
| Only admin can sign off CIR | `cirIssuedBy` set from token only for admin role |
| All reference numbers auto-generated | `src/lib/refNumbers.js` |
| Comparison auto-runs after DB2 save | `lodgments.js` POST |
| Comparison auto-runs after DB3 save | `clients.js` POST |
| Comparison auto-runs after DB3 PATCH | `clients.js` PATCH |
| Comparison auto-flags DB1 if flagged | `comparison.js` runAndStore() |
| Comparison restores DB1 to complete if cleared | `comparison.js` runAndStore() |
| enteredBy always from JWT token | All POST routes — never from request body |
| Login brute-force protection | Rate limiter: 10 attempts / 15 min / IP |
| Secure HTTP headers | Helmet middleware |

## Comparison Engine Checks

| Check | Flag Type | Condition |
|-------|-----------|-----------|
| `surveyor_mismatch` | FLAG | SURCON reg numbers differ DB1 vs DB2 |
| `pillar_count_excess` | FLAG | DB2 used more pillars than DB1 issued |
| `pillar_number_mismatch` | FLAG | DB2 pillar not found in DB1 issued list |
| `area_discrepancy` | FLAG / WARN | >5% = FLAG, any change = WARN |
| `client_plan_match` | FLAG | DB3 plan number ≠ DB1 plan number |
| `pillar_count_reduction` | WARN | DB2 used fewer pillars than issued |
| `quarter_mismatch` | WARN | Lodgment in different quarter than application |
| `incomplete_documents` | WARN | Any of 5 client docs missing |
| `missing_db2` | INFO | No Surveyor Lodgment yet |
| `missing_db3` | INFO | No Client Lodgment yet |

## Overall Status Logic

| Status | Condition |
|--------|-----------|
| `incomplete` | DB2 or DB3 missing |
| `flagged` | One or more FLAG-level checks failed |
| `warning` | One or more WARNs, zero FLAGs |
| `clean` | All checks pass — CofO may proceed |

---

## Linting & Formatting

```bash
bun run lint      # ESLint
bun run format    # Prettier
```

---

## Production Deployment (Ubuntu Server 22.04)

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Install PM2
bun install -g pm2

# Start with PM2
pm2 start src/index.js --name sgis-api --interpreter bun
pm2 save
pm2 startup

# Nginx reverse proxy → port 4000 (configure separately)
# Ensure uploads/ directory exists and is writable by the process user
mkdir -p uploads/{plans,stamps,red_copies,documents}
```
# sgis
