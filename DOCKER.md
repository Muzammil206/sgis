# Docker Setup Guide — SGIS Backend

This guide explains how to deploy and run the SGIS backend using Docker.

## Prerequisites

- **Docker** installed ([Download](https://www.docker.com/products/docker-desktop))
- **Docker Compose** (included with Docker Desktop)

## Quick Start

### 1. Clone and Configure

```bash
# Copy environment template
cp .env.example .env

# Edit .env with your settings (optional for local dev)
# For local Docker setup, defaults work fine
```

### 2. Start Services

```bash
# Start all services (PostgreSQL + API)
docker-compose up

# Run in background
docker-compose up -d

# View logs
docker-compose logs -f api    # API logs only
docker-compose logs -f db     # Database logs only
docker-compose logs -f        # All logs
```

### 3. Access the API

- **Backend API**: http://localhost:4000
- **pgAdmin** (database UI): http://localhost:5050
  - Email: `admin@admin.com`
  - Password: `admin`

### 4. Stop Services

```bash
# Stop all containers
docker-compose down

# Stop and remove volumes (⚠️ deletes database data)
docker-compose down -v
```

---

## Configuration Options

### Option A: Local PostgreSQL (Default)

Used when running `docker-compose up`. Database runs in a container.

```env
DB_HOST=db              # Docker network hostname
DB_PORT=5432
DB_NAME=sgis
DB_USER=postgres
DB_PASSWORD=postgres
```

**Pros**: Easy setup, no external dependencies  
**Cons**: Data lost if volume deleted

### Option B: Remote Neon Database

For production or persistent cloud storage.

```env
# Comment out all DB_* variables
DATABASE_URL=postgresql://neondb_owner:npg_xxxxx@ep-xxxxx.neon.tech/neondb?sslmode=require
```

Then update `docker-compose.yml`:
```yaml
api:
  environment:
    DATABASE_URL: ${DATABASE_URL}  # Keep this
    # Comment out: DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
```

### Option C: Host PostgreSQL

If PostgreSQL runs on your host machine:

```env
DB_HOST=host.docker.internal  # Special Docker DNS name for host
DB_PORT=5432
DB_NAME=sgis
DB_USER=postgres
DB_PASSWORD=your_password
```

And in `docker-compose.yml`, comment out the `db` service.

---

## Running Database Migrations

### Automatic (on first startup)

SQL files in `./db/` folder automatically run when the database starts:

```
db/
  001_schema.sql              ← Runs first
  002_seed_surveyors.sql      ← Runs second
  003_form_intake.sql
  ...
  008_workflow_corrected.sql  ← Runs last
```

### Manual (if needed)

```bash
# Connect to running database
docker-compose exec db psql -U postgres -d sgis

# Or run specific file
docker-compose exec db psql -U postgres -d sgis -f /docker-entrypoint-initdb.d/007_gis_extended.sql
```

---

## Common Commands

### View Database

```bash
# Connect to PostgreSQL inside Docker
docker-compose exec db psql -U postgres -d sgis

# List tables
\dt

# Exit
\q
```

### View Running Containers

```bash
docker-compose ps
```

### Restart a Service

```bash
docker-compose restart api    # Restart backend
docker-compose restart db     # Restart database
```

### Clean Up Everything

```bash
# Stop containers and remove volumes (⚠️ loses all data)
docker-compose down -v

# Remove unused images
docker image prune
```

### Build Image Manually

```bash
# Build the backend image
docker build -t sgis-backend:latest .

# Or use docker-compose
docker-compose build --no-cache
```

### Run Tests Inside Container

```bash
docker-compose exec api bun src/index.js
docker-compose exec api npm run lint
docker-compose exec api npm run format
```

---

## Production Deployment

### Using Docker Hub

```bash
# Tag your image
docker tag sgis-backend:latest yourusername/sgis-backend:v1.0.0

# Push to Docker Hub
docker push yourusername/sgis-backend:v1.0.0

# Pull and run on production server
docker pull yourusername/sgis-backend:v1.0.0
docker run -p 4000:4000 --env-file .env yourusername/sgis-backend:v1.0.0
```

### Using Docker Compose on Server

```bash
# On production server
git clone <your-repo>
cd sgis-backend-v3

# Configure .env for production
cp .env.example .env
# Edit .env with production values, especially:
#   - DATABASE_URL (use managed database like Neon/AWS RDS)
#   - JWT_SECRET (generate strong random secret)
#   - FRONTEND_ORIGIN (your production frontend URL)

# Start services
docker-compose -f docker-compose.yml up -d

# View logs
docker-compose logs -f api
```

### Using Railway, Render, or AWS

These platforms support Docker directly:

1. Connect your GitHub repo
2. Upload `Dockerfile` and `docker-compose.yml`
3. Set environment variables in dashboard
4. Platform auto-builds and deploys

---

## Troubleshooting

### "Connection refused" error

```bash
# Database not ready yet
docker-compose logs db

# Wait 10 seconds and try again
sleep 10
docker-compose logs api
```

### "Database already exists" error

```bash
# Remove volumes and restart
docker-compose down -v
docker-compose up
```

### "Port 4000 already in use"

```bash
# Use different port
docker-compose up -p 5000:4000
# Or stop process using port 4000
lsof -i :4000
kill -9 <PID>
```

### API not connecting to database

```bash
# Check environment variables
docker-compose exec api env | grep DB_

# Test connection
docker-compose exec api node -e "
  const pg = require('pg');
  const pool = new pg.Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  });
  pool.query('SELECT 1', (err, res) => {
    console.log(err ? 'FAILED: ' + err.message : 'SUCCESS');
  });
"
```

### Permission denied errors

```bash
# Fix file permissions (macOS/Linux only)
chmod 755 ./uploads
chmod 755 ./uploads/documents ./uploads/plans ./uploads/red_copies ./uploads/stamps
```

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│         Docker Network (sgis-network)            │
├──────────────────────────────────────────────────┤
│                                                  │
│  ┌─────────────┐        ┌──────────────────┐   │
│  │   API       │        │  PostgreSQL      │   │
│  │  :4000      │──────→ │  :5432           │   │
│  │  (Node.js)  │        │  + PostGIS       │   │
│  └─────────────┘        └──────────────────┘   │
│                                                  │
│  ┌─────────────┐                                │
│  │  pgAdmin    │                                │
│  │  :5050      │                                │
│  └─────────────┘                                │
│                                                  │
└──────────────────────────────────────────────────┘
```

---

## Health Checks

The API and database have built-in health checks:

```bash
# Check API health
curl http://localhost:4000/health

# Check database health
docker-compose exec db pg_isready -U postgres
```

---

## Next Steps

- **Deploy to Cloud**: Use Railway, Render, AWS ECS, or Kubernetes
- **Add Monitoring**: Integrate Prometheus + Grafana for metrics
- **Enable HTTPS**: Use nginx reverse proxy with Let's Encrypt SSL
- **Scale**: Use container orchestration (Docker Swarm, Kubernetes)

For more info, see the main [README.md](./README.md)
