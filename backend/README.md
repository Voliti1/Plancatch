# PlanCatch backend

## Local setup

Create and activate a Python 3.12 virtual environment, then install the dependencies:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements-dev.txt
```

Copy the environment template before running the application:

```bash
cp .env.example .env
```

Keep real credentials in `.env`. The file is ignored by Git and must not be
committed.

Apply database migrations after configuring the DB settings:

```bash
alembic upgrade head
```

## Run

```bash
uvicorn main:app --reload
```

The health endpoint is available at `http://127.0.0.1:8000/health`.

## Test

```bash
pytest
```
