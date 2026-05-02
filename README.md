<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# 🚢 Shipyard Equipment & Maintenance Hub

A comprehensive asset management dashboard for shipyard equipment — tracking maintenance, repairs, fleet health, and project deployments.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript + Vite + TailwindCSS |
| Backend | **Go** (Chi router + JWT + bcrypt) |
| Database | SQLite (via `modernc.org/sqlite` — pure Go, no CGO) |
| Deploy | Docker multi-stage (final image ~30MB) |

## Run Locally

**Prerequisites:** Node.js, Go 1.21+

```bash
# 1. Install frontend dependencies
npm install

# 2. Copy and configure environment variables
cp go-server/.env.example go-server/.env

# 3a. Run Go backend (port 3000)
npm run dev:go

# 3b. Run Vite frontend dev server (port 5173, in a separate terminal)
npm run dev
```

> The Vite dev server proxies `/api` requests to the Go backend at `localhost:3000`.

## API Endpoints

### Auth (Public)
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/login` | Login, returns JWT token |
| `GET` | `/api/auth/session` | Validate JWT session |

### Data CRUD (🔐 Requires Login)
| Method | Path | Role Required |
|---|---|---|
| `GET` | `/api/data/:table` | Any (`Staff`, `Manager`, `Admin`) |
| `POST` | `/api/data/:table` | `Manager`, `Admin` |
| `PUT` | `/api/data/:table` | `Manager`, `Admin` |
| `DELETE` | `/api/data/:table` | `Manager`, `Admin` |

**Tables:** `equipment`, `loan_requests`, `deployment_records`, `vendors`, `companies`, `ships`, `projects`, `profiles`

### Export & Import (🔐 Requires Login)
| Method | Path | Role Required |
|---|---|---|
| `GET` | `/api/export/:table/csv` | Any |
| `GET` | `/api/export/:table/json` | Any |
| `POST` | `/api/import/:table/csv` | `Manager`, `Admin` |
| `GET` | `/api/stats` | Any |

## Docker Deploy

```bash
# Build and run (single command)
docker compose up --build -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

> The SQLite database is persisted in a Docker volume `shipyard_data`. Data survives container restarts.

## Default Credentials

| Field | Value |
|---|---|
| Email | `admin@shipyard.local` |
| Password | `admin123` |

> ⚠️ **Change these in production** via environment variables in `docker-compose.yml`.
