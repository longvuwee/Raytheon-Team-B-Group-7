"""Simple standalone script to test Supabase Postgres connectivity using psycopg (v3).
Run inside your virtual environment:
    python test_db_connection.py
Relies on environment variables in api/.env:
    DB_HOST, DB_HOSTADDR (optional), DB_NAME, DB_USER, DB_PASSWORD, DB_PORT, PGSSLMODE
"""
import os
from datetime import datetime

# Optional .env loading (python-dotenv must be installed)
try:
    from dotenv import load_dotenv
    load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))
except Exception:
    pass

try:
    import psycopg  # psycopg v3
except ImportError as e:
    print("psycopg not installed in current environment:", e)
    raise SystemExit(1)

def build_conninfo():
    host = os.getenv("DB_HOST")
    hostaddr = os.getenv("DB_HOSTADDR")  # Optional IPv4 override
    dbname = os.getenv("DB_NAME", "postgres")
    user = os.getenv("DB_USER", "postgres")
    password = os.getenv("DB_PASSWORD")
    port = os.getenv("DB_PORT", "5432")
    sslmode = os.getenv("PGSSLMODE", "require")
    timeout = os.getenv("DB_CONNECT_TIMEOUT", "5")

    if not password:
        raise RuntimeError("DB_PASSWORD is missing; check api/.env")
    if not host and not hostaddr:
        raise RuntimeError("DB_HOST (or DB_HOSTADDR) is missing; check api/.env")

    if hostaddr:
        # Use hostaddr to bypass DNS resolution when only IPv6 is returned or blocked
        return (
            f"hostaddr={hostaddr} dbname={dbname} user={user} password={password} "
            f"port={port} sslmode={sslmode} connect_timeout={timeout}"
        )
    return (
        f"host={host} dbname={dbname} user={user} password={password} "
        f"port={port} sslmode={sslmode} connect_timeout={timeout}"
    )


def main():
    print("[dbtest] Starting at", datetime.utcnow().isoformat(), "UTC")
    conninfo = build_conninfo()
    print("[dbtest] Conninfo (sanitized):", conninfo.replace(os.getenv("DB_PASSWORD", ""), "***"))
    try:
        with psycopg.connect(conninfo) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT version(), now();")
                version, now_ts = cur.fetchone()
                print("[dbtest] Server version:", version)
                print("[dbtest] Current time:", now_ts)
                # Simple latency check
                cur.execute("SELECT 1;")
                print("[dbtest] Basic query succeeded.")
        print("[dbtest] Connection closed cleanly.")
    except Exception as e:
        print("[dbtest] Connection failed:", type(e).__name__, str(e))
        print("[dbtest] Troubleshooting tips:")
        print("  - Verify IPv6 availability or supply DB_HOSTADDR with an IPv4.")
        print("  - Ensure port 5432 outbound is allowed (firewall/VPN).")
        print("  - Confirm credentials in api/.env match Supabase dashboard.")
        print("  - Try pooling host (pgbouncer) and set PGSSLMODE=require.")
        raise SystemExit(2)

if __name__ == "__main__":
    main()
