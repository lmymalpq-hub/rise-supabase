#!/usr/bin/env python3
"""Migration one-shot RISE Python (SQLite) → RISE Supabase (Postgres + Storage).

Lit ../rise/checkins.db, génère du SQL Postgres en préservant les IDs
(OVERRIDING SYSTEM VALUE), pousse via l'API Management Supabase
(/v1/projects/<ref>/database/query). Upload ensuite les photos
uploads/<...>.jpg vers le bucket privé rise-uploads.

Réutilise les credentials de .env.local (gitignored).

Usage :
    python3 scripts/migrate_from_python.py
"""

import json
import os
import ssl
import sqlite3
import sys
import urllib.request
import urllib.error
from pathlib import Path

# macOS Python framework n'a pas de CA bundle bundled — on utilise le contexte
# système ou un fallback non-vérifié pour cet API officiel Supabase.
try:
    import certifi
    _SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    _SSL_CTX = ssl._create_unverified_context()

ROOT          = Path(__file__).resolve().parent.parent
PYTHON_REPO   = ROOT.parent / "rise"
SQLITE_DB     = PYTHON_REPO / "checkins.db"
UPLOADS_DIR   = PYTHON_REPO / "uploads"

# --- Charge les credentials .env.local ---
env_local = ROOT / ".env.local"
if not env_local.exists():
    print(f"ERROR: {env_local} not found. Run setup d'abord.")
    sys.exit(1)

env = {}
for line in env_local.read_text().splitlines():
    if "=" not in line or line.strip().startswith("#"):
        continue
    k, _, v = line.partition("=")
    env[k.strip()] = v.strip().strip('"')

PROJECT_REF   = env["SUPABASE_PROJECT_REF"]
SUPABASE_URL  = env["SUPABASE_URL"]
SERVICE_KEY   = env["SUPABASE_SERVICE_ROLE_KEY"]
PAT           = os.environ.get("SUPABASE_ACCESS_TOKEN") or os.environ.get("PAT")
if not PAT:
    print("ERROR: set SUPABASE_ACCESS_TOKEN env var (sbp_...)")
    sys.exit(1)


def http_request(method, url, headers=None, data=None):
    req = urllib.request.Request(url, method=method, headers=headers or {})
    if data is not None:
        if isinstance(data, (dict, list)):
            data = json.dumps(data).encode("utf-8")
            req.add_header("Content-Type", "application/json")
        elif isinstance(data, str):
            data = data.encode("utf-8")
    try:
        with urllib.request.urlopen(req, data=data, timeout=60, context=_SSL_CTX) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def run_sql(sql_text):
    """Execute SQL via the Management API.

    On utilise curl en subprocess plutôt que urllib pour contourner les
    filtres Cloudflare qui blacklistent le User-Agent "Python-urllib/...".
    """
    import subprocess
    import tempfile
    payload = json.dumps({"query": sql_text}).encode("utf-8")
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        f.write(payload)
        payload_path = f.name
    try:
        result = subprocess.run(
            [
                "/usr/bin/curl", "-s", "-w", "\n%{http_code}",
                "-H", f"Authorization: Bearer {PAT}",
                "-H", "Content-Type: application/json",
                "-d", f"@{payload_path}",
                f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
            ],
            capture_output=True, timeout=60,
        )
        out = result.stdout.decode("utf-8", "replace")
        # Le code HTTP est en dernière ligne
        last_nl = out.rstrip().rfind("\n")
        body, code = (out[:last_nl], out[last_nl+1:].strip()) if last_nl >= 0 else (out, "")
        try:
            status = int(code)
        except ValueError:
            status = 0
        if status >= 300:
            print(f"  SQL ERROR [{status}]: {body[:300]}")
            return False
        return True
    finally:
        os.unlink(payload_path)


def sql_quote(v):
    """Escape value for inline SQL. Keeps it simple — small dataset."""
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)):
        return str(v)
    s = str(v).replace("'", "''")
    return f"'{s}'"


def migrate_table(con, table, columns, pg_table=None, transform=None, post_seq_col="id"):
    """Generic migrate : SELECT cols from SQLite, INSERT in Postgres avec OVERRIDING SYSTEM VALUE."""
    pg_table = pg_table or table
    rows = con.execute(f"SELECT {', '.join(columns)} FROM {table}").fetchall()
    if not rows:
        print(f"  {pg_table:25} 0 rows (skip)")
        return
    values = []
    for row in rows:
        vals = list(row)
        if transform:
            vals = transform(vals)
        values.append("(" + ", ".join(sql_quote(v) for v in vals) + ")")
    sql = (
        f"INSERT INTO public.{pg_table} ({', '.join(columns)}) "
        f"OVERRIDING SYSTEM VALUE VALUES "
        + ",\n".join(values)
        + " ON CONFLICT DO NOTHING;"
    )
    if not run_sql(sql):
        print(f"  {pg_table:25} FAILED")
        return
    # Reset la séquence pour que le prochain INSERT pioche au-dessus
    if post_seq_col:
        seq_sql = (
            f"SELECT setval(pg_get_serial_sequence('public.{pg_table}', '{post_seq_col}'), "
            f"COALESCE((SELECT MAX({post_seq_col}) FROM public.{pg_table}), 0) + 1, false);"
        )
        run_sql(seq_sql)
    print(f"  {pg_table:25} {len(rows)} rows migrated")


def migrate_app_settings(con):
    """app_settings : pas d'ID, c'est key-value avec PRIMARY KEY sur key."""
    rows = con.execute("SELECT key, value FROM app_settings").fetchall()
    if not rows:
        print("  app_settings              0 rows")
        return
    values = []
    for k, v in rows:
        values.append(f"({sql_quote(k)}, {sql_quote(v)})")
    sql = (
        "INSERT INTO public.app_settings (key, value) VALUES "
        + ",\n".join(values)
        + " ON CONFLICT (key) DO NOTHING;"
    )
    run_sql(sql)
    print(f"  app_settings              {len(rows)} rows migrated")


def upload_photos():
    """Upload toutes les photos du repo Python vers le bucket rise-uploads.

    Utilise curl en subprocess (idem run_sql) pour contourner les filtres
    Cloudflare et les pertes de connexion urllib sur multiples requêtes.
    """
    import subprocess
    photos = sorted(UPLOADS_DIR.rglob("*.jpg"))
    if not photos:
        print("  no photos to upload")
        return
    uploaded = 0
    skipped = 0
    failed = 0
    for p in photos:
        rel = p.relative_to(UPLOADS_DIR).as_posix()
        url = f"{SUPABASE_URL}/storage/v1/object/rise-uploads/{rel}"
        result = subprocess.run(
            [
                "/usr/bin/curl", "-s", "-w", "%{http_code}",
                "-o", "/dev/null",
                "--max-time", "120",
                "-X", "POST",
                "-H", f"Authorization: Bearer {SERVICE_KEY}",
                "-H", "Content-Type: image/jpeg",
                "--data-binary", f"@{p}",
                url,
            ],
            capture_output=True, timeout=180,
        )
        try:
            status = int(result.stdout.decode("utf-8", "replace").strip())
        except ValueError:
            status = 0
        if status in (200, 201):
            uploaded += 1
        elif status in (409, 400):
            skipped += 1
        else:
            failed += 1
            print(f"  ! {rel} failed [{status}]")
    print(f"  photos: {uploaded} uploaded · {skipped} skipped · {failed} failed (total {len(photos)})")


def main():
    if not SQLITE_DB.exists():
        print(f"ERROR: {SQLITE_DB} not found")
        sys.exit(1)

    print(f"Source SQLite : {SQLITE_DB}")
    print(f"Target project : {PROJECT_REF} ({SUPABASE_URL})")
    print()

    con = sqlite3.connect(str(SQLITE_DB))
    con.row_factory = sqlite3.Row

    print("=== 1. Staff ===")

    def staff_xform(vals):
        # SQLite INTEGER (0/1) → Postgres BOOLEAN pour active (idx 9) et is_supervisor (idx 10)
        vals[9]  = bool(vals[9])  if vals[9]  is not None else False
        vals[10] = bool(vals[10]) if vals[10] is not None else False
        return vals

    migrate_table(
        con, "staff",
        columns=[
            "id", "name", "pin_hash", "pin_salt", "pin_length",
            "prefix_hash_4", "prefix_hash_5", "prefix_hash_6",
            "pdvs", "active", "is_supervisor", "onboarded_at",
            "created_at", "last_login",
        ],
        transform=staff_xform,
    )

    print("=== 2. Checkins ===")

    # Récupère les staff_ids présents pour nullifier les FK orphelines
    valid_staff_ids = {row[0] for row in con.execute("SELECT id FROM staff").fetchall()}

    def checkins_xform(vals):
        # Index dans la list : id=0, pdv=1, category=2, photo_path=3, photo_bytes=4,
        # note=5, staff_id=6, user_label=7, created_at=8, status=9, feedback=10, annotations=11
        if vals[6] is not None and vals[6] not in valid_staff_ids:
            vals[6] = None  # FK orpheline → NULL (le staff a été supprimé)
        return vals

    migrate_table(
        con, "checkins",
        columns=[
            "id", "pdv", "category", "photo_path", "photo_bytes",
            "note", "staff_id", "user_label",
            "created_at", "status", "feedback", "annotations",
        ],
        transform=checkins_xform,
    )

    print("=== 3. Staff notes ===")
    migrate_table(
        con, "staff_notes",
        columns=[
            "id", "staff_id", "pdv", "category", "note_date",
            "score", "mood", "remark",
            "created_at", "updated_at", "read_at", "checkin_id",
        ],
    )

    print("=== 4. Push subscriptions ===")
    migrate_table(
        con, "push_subscriptions",
        columns=[
            "id", "staff_id", "endpoint", "p256dh", "auth",
            "user_agent", "created_at", "last_used_at",
        ],
    )

    print("=== 5. App settings ===")
    migrate_app_settings(con)

    con.close()
    print()
    print("=== 6. Photos → Supabase Storage ===")
    upload_photos()
    print()
    print("✅ Migration done.")


if __name__ == "__main__":
    main()
