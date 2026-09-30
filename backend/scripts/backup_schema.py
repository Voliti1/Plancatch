"""Private schema-only backup; never prints connection strings or database rows."""
import argparse
import os
import subprocess
from pathlib import Path

from app.db.session import build_database_url

parser = argparse.ArgumentParser()
parser.add_argument("output")
path = Path(parser.parse_args().output).resolve()
os.umask(0o077)
path.parent.mkdir(parents=True, exist_ok=True)
if path.exists():
    raise SystemExit("Refusing to overwrite an existing backup")
url = build_database_url()
env = os.environ.copy()
env.update(PGHOST=url.host, PGPORT=str(url.port or 5432), PGUSER=url.username,
           PGPASSWORD=url.password, PGDATABASE=url.database, PGSSLMODE="require")
subprocess.run(["pg_dump", "--schema-only", "--format=custom", "--file", str(path)],
               env=env, check=True, capture_output=True)
listing = subprocess.check_output(["pg_restore", "--list", str(path)], text=True)
if any(" TABLE DATA " in line or " SEQUENCE SET " in line for line in listing.splitlines()):
    raise SystemExit("Unexpected data entries; backup must not be used")
print("SCHEMA_BACKUP_OK", path.name, path.stat().st_size)
