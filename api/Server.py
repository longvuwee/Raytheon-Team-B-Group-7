# Server.py
from __future__ import annotations

import math
import os
try:
    # Load environment variables from .env if python-dotenv is installed
    from dotenv import load_dotenv
    load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))
except Exception:
    # Dotenv is optional; environment variables can be provided by the shell
    pass
from dataclasses import dataclass
import random
from typing import Tuple, Dict, Any

# Optional Postgres support: prefer psycopg v3, fallback off
try:
    import psycopg  # type: ignore
    from psycopg.types.json import Json  # type: ignore
    HAS_PG = True
except Exception:
    psycopg = None  # type: ignore
    # Fallback: simple passthrough if Json import fails (will still error if DB is used without psycopg)
    try:
        def Json(x):  # type: ignore
            return x
    except Exception:
        pass
    HAS_PG = False
from flask import Flask, request, jsonify
from flask import Response
from flask import stream_with_context
from werkzeug.exceptions import HTTPException
from flask_cors import CORS

from predictor import predict_fire_spread, predict_fire_spread_batch

app = Flask(__name__)
# Robust CORS for browser clients (Render + local dev)
CORS(
    app,
    resources={r"/*": {"origins": "*"}},
    methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
    expose_headers=["Content-Type"],
    supports_credentials=False,
)

# Ensure CORS headers on uncaught exceptions too
@app.errorhandler(Exception)
def handle_exception(e):
    try:
        print(f"[server] Unhandled error: {type(e).__name__}: {e}")
    except Exception:
        pass
    if isinstance(e, HTTPException):
        # Preserve original HTTP status codes like 404
        return jsonify({"ok": False, "error": e.description}), e.code
    resp = jsonify({"ok": False, "error": f"{type(e).__name__}: {str(e)}"})
    return resp, 500

# Handle 404 errors with logging
@app.errorhandler(404)
def not_found(e):
    print(f"[server] 404 Not Found: {request.method} {request.path}")
    return jsonify({"ok": False, "error": "Endpoint not found", "path": request.path}), 404

# Catch-all OPTIONS handler for CORS preflight on any route
@app.route('/', defaults={'path': ''}, methods=['OPTIONS'])
@app.route('/<path:path>', methods=['OPTIONS'])
def handle_options(path):
    return '', 200

# ---- MODEL FEATURE KEYS (ONLY THESE GO TO THE MODEL) ----
FEATURE_KEYS = [
    "latitude",
    "longitude",
    "brightness",
    "bright_t31",
    "confidence",
    "daynight",
    "elevation",
    "slope",
    "aspect",
    "temp",
    "humidity",
    "wind_speed",
    "precip",
    "month",
]

# ---- DB CONFIG ----
USE_DB = os.environ.get("USE_DB", "true").lower() in ("1", "true", "yes")

DB_CONFIG = {
    "host": os.environ.get("DB_HOST"),
    # Optional IPv4 override to bypass DNS (use when corporate DNS returns IPv6-only)
    "hostaddr": os.environ.get("DB_HOSTADDR"),
    "dbname": os.environ.get("DB_NAME", "postgres"),
    "user": os.environ.get("DB_USER", "postgres"),
    "password": os.environ.get("DB_PASSWORD"),
    "port": os.environ.get("DB_PORT", 5432),
    # Supabase Postgres typically requires SSL
    "sslmode": os.environ.get("PGSSLMODE", "require"),
    # Avoid hanging on unreachable hosts
    "connect_timeout": 5,
}


def get_db_conn():
    if not HAS_PG or not USE_DB:
        raise RuntimeError("psycopg not installed; DB features are disabled")
    # Prefer hostaddr when provided to bypass DNS resolution
    hostaddr = DB_CONFIG.get("hostaddr")
    if hostaddr:
        # Build explicit conninfo to avoid using hostname
        conninfo = (
            f"hostaddr={hostaddr} "
            f"dbname={DB_CONFIG.get('dbname')} "
            f"user={DB_CONFIG.get('user')} "
            f"password={DB_CONFIG.get('password')} "
            f"port={DB_CONFIG.get('port')} "
            f"sslmode={DB_CONFIG.get('sslmode', 'require')} "
            f"connect_timeout={DB_CONFIG.get('connect_timeout', 5)}"
        )
        return psycopg.connect(conninfo)  # type: ignore
    return psycopg.connect(**DB_CONFIG)  # type: ignore


# ~200 ft grid
DEG_LAT_200FT = 61.0 / 111_320.0
DEG_LON_200FT_AT_EQ = 61.0 / 111_320.0


@dataclass
class Block:
    block_id: str
    row: int
    col: int
    center_lat: float
    center_lon: float


def snap_to_grid(lat: float, lon: float) -> Block:
    # Simple origin (tuned for CONUS)
    origin_lat = 25.0
    origin_lon = -125.0

    cell_lat = DEG_LAT_200FT
    cell_lon = DEG_LON_200FT_AT_EQ * max(math.cos(math.radians(lat)), 0.1)

    row = int((lat - origin_lat) / cell_lat)
    col = int((lon - origin_lon) / cell_lon)

    center_lat = origin_lat + (row + 0.5) * cell_lat
    center_lon = origin_lon + (col + 0.5) * cell_lon

    block_id = f"CA-{row}-{col}"
    return Block(block_id=block_id, row=row, col=col, center_lat=center_lat, center_lon=center_lon)


SPREAD_THRESHOLD = 0.55  # Lowered from 0.75 to classify more fires as spreading
T_MAX = 12


def update_timeline(old_T: int, old_T_burn: int, prob: float, can_burn: bool) -> Tuple[int, int]:
    """
    Timeline logic:
      - T_burn = 0: no fire
      - T_burn = 1: burning
      - T_burn = 2: burned out
      - T_burn = 3: cannot burn
    """
    if not can_burn:
        return 0, 3  # cannot burn

    # Once burned out or cannot burn, we don't change
    if old_T_burn in (2, 3):
        return old_T, old_T_burn

    # Fire spreads above threshold
    if prob >= SPREAD_THRESHOLD:
        if old_T_burn == 0:
            # first ignition
            return 0, 1
        if old_T_burn == 1:
            new_T = min(old_T + 1, T_MAX)
            if new_T >= T_MAX:
                # finished burning
                return new_T, 2
            return new_T, 1
        # Fallback
        return 0, 1
    else:
        # Below threshold stops burning if it was burning
        if old_T_burn == 1:
            return 0, 0
        return old_T, old_T_burn


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})

@app.route("/", methods=["GET"]) 
def root():
    return jsonify({"status": "ok", "routes": ["/health", "/predict", "/predict-spread-animation", "/db-check", "/db-check-fire-inputs", "/spread-front"]})


@app.route("/environmental-data", methods=["POST"])
def environmental_data():
    """
    Lightweight stub that returns reasonable environmental defaults so the
    frontend can enrich missing features without failing. This avoids noisy
    warnings in the UI when external data sources are unavailable.
    Body: { latitude, longitude, datetime }
    """
    try:
        payload = request.get_json(force=True) or {}
    except Exception:
        payload = {}

    lat = float(payload.get("latitude") or 0)
    # Simple lat-dependent defaults to add slight variation
    base_temp = 25.0 - max(0, (abs(lat) - 30) * 0.1)
    out = {
        "temperature": base_temp,
        "humidity": 40.0,
        "wind_speed": 8.0,
        "wind_direction": 180,
        "vegetation_index": 0.3,
        "elevation": 500.0,
        "slope": 10.0,
    }
    return jsonify(out)


@app.route("/debug-block-avg", methods=["GET"])
def debug_block_avg():
    """
    Inspect per-block probability aggregation.
    Query params:
      - block_id: e.g., CA-26460-8279
      - row, col: numeric indices as alternative to block_id

    Returns combined view from fire_cell_state and block_index.
    """
    block_id = request.args.get("block_id")
    row_param = request.args.get("row")
    col_param = request.args.get("col")
    row = int(row_param) if row_param is not None and row_param != "" else None
    col = int(col_param) if col_param is not None and col_param != "" else None

    if (row is None or col is None) and not block_id:
        return jsonify({"ok": False, "error": "Provide block_id or row & col"}), 400

    try:
        conn = get_db_conn()
        cur = conn.cursor()

        fcs = None
        # Prefer row/col if provided
        if row is not None and col is not None:
            cur.execute(
                """
                SELECT block_row, block_col, block_id, prob_sum, prob_count, last_prob, instant_spread_probability, updated_at
                FROM fire_cell_state
                WHERE block_row = %s AND block_col = %s
                """,
                (row, col),
            )
            rec = cur.fetchone()
            if rec:
                rrow, rcol, bid, prob_sum, prob_count, last_prob, inst_prob, updated_at = rec
                avg = float(prob_sum) / prob_count if prob_count else None
                fcs = {
                    "block_row": rrow,
                    "block_col": rcol,
                    "block_id": bid,
                    "prob_sum": float(prob_sum) if prob_sum is not None else None,
                    "prob_count": int(prob_count) if prob_count is not None else None,
                    "avg": float(avg) if avg is not None else None,
                    "last_prob": float(last_prob) if last_prob is not None else None,
                    "instant_spread_probability": float(inst_prob) if inst_prob is not None else None,
                    "updated_at": str(updated_at) if updated_at is not None else None,
                }
                # Use resolved block_id for index fetch
                if not block_id:
                    block_id = bid

        if fcs is None and block_id:
            cur.execute(
                """
                SELECT block_row, block_col, block_id, prob_sum, prob_count, last_prob, instant_spread_probability, updated_at
                FROM fire_cell_state
                WHERE block_id = %s
                ORDER BY updated_at DESC
                LIMIT 1
                """,
                (block_id,),
            )
            rec = cur.fetchone()
            if rec:
                rrow, rcol, bid, prob_sum, prob_count, last_prob, inst_prob, updated_at = rec
                avg = float(prob_sum) / prob_count if prob_count else None
                fcs = {
                    "block_row": rrow,
                    "block_col": rcol,
                    "block_id": bid,
                    "prob_sum": float(prob_sum) if prob_sum is not None else None,
                    "prob_count": int(prob_count) if prob_count is not None else None,
                    "avg": float(avg) if avg is not None else None,
                    "last_prob": float(last_prob) if last_prob is not None else None,
                    "instant_spread_probability": float(inst_prob) if inst_prob is not None else None,
                    "updated_at": str(updated_at) if updated_at is not None else None,
                }
                # Also populate row/col for consistent response
                row, col = rrow, rcol

        # Pull block_index snapshot if we have a block_id
        bindex = None
        if block_id:
            cur.execute(
                """
                SELECT block_row, block_col, block_center_latitude, block_center_longitude,
                       T, T_burn, block_avg_spread_probability, updated_at
                FROM block_index
                WHERE block_id = %s
                """,
                (block_id,),
            )
            bi = cur.fetchone()
            if bi:
                bi_row, bi_col, clat, clon, T, T_burn, avg_prob, updated_at = bi
                bindex = {
                    "block_row": bi_row,
                    "block_col": bi_col,
                    "block_center_latitude": float(clat) if clat is not None else None,
                    "block_center_longitude": float(clon) if clon is not None else None,
                    "T": int(T) if T is not None else None,
                    "T_burn": int(T_burn) if T_burn is not None else None,
                    "block_avg_spread_probability": float(avg_prob) if avg_prob is not None else None,
                    "updated_at": str(updated_at) if updated_at is not None else None,
                }

        cur.close()
        conn.close()

        return jsonify({
            "ok": True,
            "query": {"block_id": block_id, "row": row, "col": col},
            "fire_cell_state": fcs,
            "block_index": bindex,
        })
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/db-check", methods=["GET"])
def db_check():
    """
    Connectivity and schema sanity check:
    - Attempts a simple upsert into block_index
    - Attempts an upsert into fire_cell_state
    Returns first error encountered with details
    """
    if not HAS_PG or not USE_DB:
        return jsonify({
            "ok": False,
            "stage": "import",
            "error": "DB disabled in this environment; set USE_DB=true to enable"
        }), 200
    try:
        conn = get_db_conn()
        conn.autocommit = False
        cur = conn.cursor()

        # Create tables if missing (idempotent)
        try:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS block_index (
                    block_id TEXT PRIMARY KEY,
                    block_row INT,
                    block_col INT,
                    block_center_latitude DOUBLE PRECISION,
                    block_center_longitude DOUBLE PRECISION,
                    T INT,
                    T_burn INT,
                    block_avg_spread_probability DOUBLE PRECISION,
                    updated_at TIMESTAMPTZ DEFAULT now()
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS fire_cell_state (
                    block_row INT,
                    block_col INT,
                    block_id TEXT,
                    last_latitude DOUBLE PRECISION,
                    last_longitude DOUBLE PRECISION,
                    t INT,
                    t_burn INT,
                    last_prob DOUBLE PRECISION,
                    prob_sum DOUBLE PRECISION,
                    prob_count INT,
                    instant_spread_probability DOUBLE PRECISION,
                    updated_at TIMESTAMPTZ DEFAULT now(),
                    PRIMARY KEY (block_row, block_col)
                )
                """
            )
        except Exception as e:
            conn.rollback()
            return jsonify({"ok": False, "stage": "create_tables", "error": str(e)}), 500

        # Test upsert block_index
        try:
            cur.execute(
                """
                INSERT INTO block_index (
                    block_id, block_row, block_col, block_center_latitude,
                    block_center_longitude, T, T_burn, block_avg_spread_probability
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (block_id) DO UPDATE SET
                    block_row = EXCLUDED.block_row,
                    block_col = EXCLUDED.block_col,
                    block_center_latitude = EXCLUDED.block_center_latitude,
                    block_center_longitude = EXCLUDED.block_center_longitude,
                    T = EXCLUDED.T,
                    T_burn = EXCLUDED.T_burn,
                    block_avg_spread_probability = EXCLUDED.block_avg_spread_probability,
                    updated_at = now()
                """,
                ("DBCHECK-0-0", 0, 0, 0.0, 0.0, 0, 0, 0.0),
            )
        except Exception as e:
            conn.rollback()
            return jsonify({"ok": False, "stage": "upsert_block_index", "error": str(e)}), 500

        # Test upsert fire_cell_state
        try:
            cur.execute(
                """
                INSERT INTO fire_cell_state (
                    block_row, block_col, block_id, last_latitude, last_longitude,
                    t, t_burn, last_prob, prob_sum, prob_count, instant_spread_probability
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (block_row, block_col)
                DO UPDATE SET
                    block_id = EXCLUDED.block_id,
                    last_latitude = EXCLUDED.last_latitude,
                    last_longitude = EXCLUDED.last_longitude,
                    t = EXCLUDED.t,
                    t_burn = EXCLUDED.t_burn,
                    last_prob = EXCLUDED.last_prob,
                    prob_sum = fire_cell_state.prob_sum + EXCLUDED.last_prob,
                    prob_count = fire_cell_state.prob_count + 1,
                    instant_spread_probability = EXCLUDED.instant_spread_probability,
                    updated_at = now()
                """,
                (0, 0, "DBCHECK-0-0", 0.0, 0.0, 0, 0, 0.0, 0.0, 1, 0.0),
            )
        except Exception as e:
            conn.rollback()
            return jsonify({"ok": False, "stage": "upsert_fire_cell_state", "error": str(e)}), 500

        conn.commit()
        cur.close()
        conn.close()
        return jsonify({"ok": True, "message": "DB writes succeeded"})
    except Exception as e:
        # Return 200 with ok:false to avoid client exceptions during local dev
        return jsonify({"ok": False, "stage": "connect", "error": str(e)}), 200


@app.route("/db-check-fire-inputs", methods=["GET"])
def db_check_fire_inputs():
    """
    Check fire_inputs upsert path specifically to surface schema mismatches.
    """
    if not HAS_PG:
        return jsonify({
            "ok": False,
            "stage": "import",
            "error": "psycopg2 not installed; DB checks disabled in this environment"
        }), 503
    sample = {
        "input_id": "DBCHECK-FI-1",
        "model": "random_forest",
        "latitude": 35.25,
        "longitude": -120.60,
        "brightness": 310.2,
        "bright_t31": 290.1,
        "confidence": 8,
        "daynight": 0,
        "elevation": 450.0,
        "slope": 5.2,
        "aspect": 180.0,
        "temp": 27.0,
        "humidity": 32.0,
        "wind_speed": 4.5,
        "precip": 0.0,
        "month": 7,
        "instant_spread_probability": 0.5,
        "prediction": "No Spread",
        "t": 0,
        "t_burn": 0,
        "block_id": "CA-0-0",
        "block_row": 0,
        "block_col": 0,
    }
    try:
        conn = get_db_conn()
        conn.autocommit = False
        cur = conn.cursor()
        try:
            cur.execute(
                """
                INSERT INTO fire_inputs (
                    input_id, model, latitude, longitude, brightness, bright_t31, confidence, daynight,
                    elevation, slope, aspect, temp, humidity, wind_speed, precip, month,
                    instant_spread_probability, prediction, t, t_burn, block_id, block_row, block_col
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (input_id) DO UPDATE SET
                    model = EXCLUDED.model,
                    latitude = EXCLUDED.latitude,
                    longitude = EXCLUDED.longitude,
                    brightness = EXCLUDED.brightness,
                    bright_t31 = EXCLUDED.bright_t31,
                    confidence = EXCLUDED.confidence,
                    daynight = EXCLUDED.daynight,
                    elevation = EXCLUDED.elevation,
                    slope = EXCLUDED.slope,
                    aspect = EXCLUDED.aspect,
                    temp = EXCLUDED.temp,
                    humidity = EXCLUDED.humidity,
                    wind_speed = EXCLUDED.wind_speed,
                    precip = EXCLUDED.precip,
                    month = EXCLUDED.month,
                    instant_spread_probability = EXCLUDED.instant_spread_probability,
                    prediction = EXCLUDED.prediction,
                    t = EXCLUDED.t,
                    t_burn = EXCLUDED.t_burn,
                    block_id = EXCLUDED.block_id,
                    block_row = EXCLUDED.block_row,
                    block_col = EXCLUDED.block_col
                """,
                (
                    sample["input_id"], sample["model"], sample["latitude"], sample["longitude"],
                    sample["brightness"], sample["bright_t31"], sample["confidence"], int(sample["daynight"]),
                    sample["elevation"], sample["slope"], sample["aspect"], sample["temp"], sample["humidity"],
                    sample["wind_speed"], sample["precip"], int(sample["month"]), sample["instant_spread_probability"],
                    sample["prediction"], sample["t"], sample["t_burn"], sample["block_id"], sample["block_row"], sample["block_col"],
                ),
            )
        except Exception as e:
            conn.rollback()
            return jsonify({"ok": False, "stage": "upsert_fire_inputs", "error": str(e)}), 500
        conn.commit()
        cur.close()
        conn.close()
        return jsonify({"ok": True, "message": "fire_inputs upsert succeeded"})
    except Exception as e:
        return jsonify({"ok": False, "stage": "connect", "error": str(e)}), 500


@app.route("/predict", methods=["POST"])
def predict():
    # ---- Parse JSON body ----
    try:
        data = request.get_json(force=True) or {}
    except Exception as e:
        return jsonify({"error": f"Invalid JSON body: {e}"}), 400

    if not isinstance(data, dict):
        return jsonify({"error": "JSON body must be an object"}), 400

    # Model selection + can_burn flag
    model_name = (data.get("model") or "random_forest").lower()
    can_burn = bool(data.get("can_burn", True))

    # Optional input identifier from the client (persisted to fire_inputs)
    input_id = data.get("input_id")

    # ---- Build features dict (ONLY the 15 physical features) ----
    missing = [k for k in FEATURE_KEYS if k not in data]
    if missing:
        return jsonify(
            {
                "error": "Missing required features",
                "missing": missing,
                "received_keys": list(data.keys()),
            }
        ), 400

    # Keep types as-is; predictor will handle conversion via feature_cols
    features: Dict[str, Any] = {k: data[k] for k in FEATURE_KEYS}

    # ---- Call model ----
    try:
        # Debug: log features being sent to model
        print(f"[predict] Features: lat={features.get('latitude')}, lon={features.get('longitude')}, "
              f"brightness={features.get('brightness')}, bright_t31={features.get('bright_t31')}, "
              f"confidence={features.get('confidence')}, temp={features.get('temp')}, "
              f"humidity={features.get('humidity')}, wind_speed={features.get('wind_speed')}")
        
        pred = predict_fire_spread(features, model_name=model_name)
        inst_prob = float(pred["spread_probability"])
        
        print(f"[predict] Model '{model_name}' returned probability: {inst_prob:.4f}")
    except Exception as e:
        # Log model errors with minimal noise
        print(f"[predict] Model prediction failed: {type(e).__name__}: {e}")
        return jsonify(
            {
                "error": f"Model prediction failed: {type(e).__name__}: {e}",
            }
        ), 500

    # ---- Snap to grid and update timeline in DB ----
    try:
        lat = float(features["latitude"])
        lon = float(features["longitude"])
    except Exception as e:
        return jsonify({"error": f"Invalid latitude/longitude: {e}"}), 400

    block = snap_to_grid(lat, lon)

    new_T = 0
    new_T_burn = 0
    block_avg_prob = inst_prob

    try:
        conn = get_db_conn()
        conn.autocommit = False
        cur = conn.cursor()

        # Ensure the fire_inputs table exists to record input rows
        try:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS fire_inputs (
                    id SERIAL PRIMARY KEY,
                    input_id TEXT,
                    model TEXT,
                    latitude DOUBLE PRECISION,
                    longitude DOUBLE PRECISION,
                    brightness DOUBLE PRECISION,
                    bright_t31 DOUBLE PRECISION,
                    confidence DOUBLE PRECISION,
                    daynight INT,
                    elevation DOUBLE PRECISION,
                    slope DOUBLE PRECISION,
                    aspect DOUBLE PRECISION,
                    temp DOUBLE PRECISION,
                    humidity DOUBLE PRECISION,
                    wind_speed DOUBLE PRECISION,
                    precip DOUBLE PRECISION,
                    month INT,
                    instant_spread_probability DOUBLE PRECISION,
                    prediction TEXT,
                    t INT,
                    t_burn INT,
                    block_id TEXT,
                    block_row INT,
                    block_col INT,
                    processed BOOLEAN DEFAULT FALSE,
                    processed_at TIMESTAMPTZ,
                    last_status TEXT,
                    last_response JSONB,
                    created_at TIMESTAMPTZ DEFAULT now()
                )
                """
            )
            # Ensure helpful indexes / constraints
            cur.execute("CREATE INDEX IF NOT EXISTS idx_fire_inputs_input_id ON fire_inputs(input_id)")
            # Add unique constraint on input_id only if missing (avoids aborting the transaction)
            cur.execute(
                """
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint WHERE conname = 'fire_inputs_input_id_unique'
                    ) THEN
                        ALTER TABLE fire_inputs ADD CONSTRAINT fire_inputs_input_id_unique UNIQUE (input_id);
                    END IF;
                END$$;
                """
            )

            # Ensure block_index table exists (used for per-block timeline state)
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS block_index (
                    block_id TEXT PRIMARY KEY,
                    block_row INT,
                    block_col INT,
                    block_center_latitude DOUBLE PRECISION,
                    block_center_longitude DOUBLE PRECISION,
                    T INT,
                    T_burn INT,
                    block_avg_spread_probability DOUBLE PRECISION,
                    updated_at TIMESTAMPTZ DEFAULT now()
                )
                """
            )

            # Ensure fire_cell_state table exists (upserted per prediction)
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS fire_cell_state (
                    block_row INT,
                    block_col INT,
                    block_id TEXT,
                    last_latitude DOUBLE PRECISION,
                    last_longitude DOUBLE PRECISION,
                    t INT,
                    t_burn INT,
                    last_prob DOUBLE PRECISION,
                    prob_sum DOUBLE PRECISION,
                    prob_count INT,
                    instant_spread_probability DOUBLE PRECISION,
                    updated_at TIMESTAMPTZ DEFAULT now(),
                    PRIMARY KEY (block_row, block_col)
                )
                """
            )
        except Exception:
            # If any DDL fails, rollback to clear aborted state and continue
            conn.rollback()
            cur = conn.cursor()

        # Read existing block state if present
        cur.execute(
            """
            SELECT T, T_burn, block_avg_spread_probability
            FROM block_index
            WHERE block_id = %s
            """,
            (block.block_id,),
        )
        row = cur.fetchone()
        if row:
            old_T, old_T_burn, old_avg = row
        else:
            old_T, old_T_burn, old_avg = 0, 0, inst_prob

        # Update T and T_burn
        new_T, new_T_burn = update_timeline(old_T, old_T_burn, inst_prob, can_burn)

        # Derive running average from fire_cell_state if available; fallback to instant prob
        block_avg_prob = inst_prob

        # Upsert block_index
        if row:
            cur.execute(
                """
                UPDATE block_index
                SET block_row = %s,
                    block_col = %s,
                    block_center_latitude = %s,
                    block_center_longitude = %s,
                    T = %s,
                    T_burn = %s,
                    block_avg_spread_probability = %s
                WHERE block_id = %s
                """,
                (
                    block.row,
                    block.col,
                    block.center_lat,
                    block.center_lon,
                    new_T,
                    new_T_burn,
                    block_avg_prob,
                    block.block_id,
                ),
            )
        else:
            cur.execute(
                """
                INSERT INTO block_index (
                    block_id,
                    block_row,
                    block_col,
                    block_center_latitude,
                    block_center_longitude,
                    T,
                    T_burn,
                    block_avg_spread_probability
                )
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    block.block_id,
                    block.row,
                    block.col,
                    block.center_lat,
                    block.center_lon,
                    new_T,
                    new_T_burn,
                    block_avg_prob,
                ),
            )

        # Write per-block state (upsert on block_row, block_col)
        cur.execute(
            """
            INSERT INTO fire_cell_state (
                block_row,
                block_col,
                block_id,
                last_latitude,
                last_longitude,
                t,
                t_burn,
                last_prob,
                prob_sum,
                prob_count,
                instant_spread_probability
            )
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (block_row, block_col)
            DO UPDATE SET
                block_id                   = EXCLUDED.block_id,
                last_latitude              = EXCLUDED.last_latitude,
                last_longitude             = EXCLUDED.last_longitude,
                t                          = EXCLUDED.t,
                t_burn                     = EXCLUDED.t_burn,
                last_prob                  = EXCLUDED.last_prob,
                prob_sum                   = fire_cell_state.prob_sum + EXCLUDED.instant_spread_probability,
                prob_count                 = fire_cell_state.prob_count + 1,
                instant_spread_probability = EXCLUDED.instant_spread_probability,
                updated_at                 = now()
            """,
            (
                block.row,
                block.col,
                block.block_id,
                lat,
                lon,
                new_T,
                new_T_burn,
                inst_prob,   # last_prob
                inst_prob,   # prob_sum initial (only used on first insert)
                1,           # prob_count initial
                inst_prob,   # instant_spread_probability
            ),
        )

        # Update block_avg_spread_probability based on accumulated samples
        cur.execute(
            """
            UPDATE block_index b
            SET block_avg_spread_probability = COALESCE(f.prob_sum / NULLIF(f.prob_count, 0), %s),
                updated_at = now()
            FROM fire_cell_state f
            WHERE b.block_id = %s AND f.block_row = %s AND f.block_col = %s
            """,
            (
                inst_prob,
                block.block_id,
                block.row,
                block.col,
            ),
        )

        # Upsert original input/prediction (avoid duplicate rows if input_id already present)
        if input_id is not None:
            try:
                # Isolate potential errors so they don't abort the whole transaction
                cur.execute("SAVEPOINT sp_upsert_fire_inputs")
                cur.execute(
                    """
                    INSERT INTO fire_inputs (
                        input_id, model, latitude, longitude, brightness, bright_t31, confidence, daynight,
                        elevation, slope, aspect, temp, humidity, wind_speed, precip, month,
                        instant_spread_probability, prediction, t, t_burn, block_id, block_row, block_col
                    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (input_id) DO UPDATE SET
                        model = EXCLUDED.model,
                        latitude = EXCLUDED.latitude,
                        longitude = EXCLUDED.longitude,
                        brightness = EXCLUDED.brightness,
                        bright_t31 = EXCLUDED.bright_t31,
                        confidence = EXCLUDED.confidence,
                        daynight = EXCLUDED.daynight,
                        elevation = EXCLUDED.elevation,
                        slope = EXCLUDED.slope,
                        aspect = EXCLUDED.aspect,
                        temp = EXCLUDED.temp,
                        humidity = EXCLUDED.humidity,
                        wind_speed = EXCLUDED.wind_speed,
                        precip = EXCLUDED.precip,
                        month = EXCLUDED.month,
                        instant_spread_probability = EXCLUDED.instant_spread_probability,
                        prediction = EXCLUDED.prediction,
                        t = EXCLUDED.t,
                        t_burn = EXCLUDED.t_burn,
                        block_id = EXCLUDED.block_id,
                        block_row = EXCLUDED.block_row,
                        block_col = EXCLUDED.block_col
                    """,
                    (
                        input_id,
                        model_name,
                        lat,
                        lon,
                        features.get("brightness"),
                        features.get("bright_t31"),
                        features.get("confidence"),
                        int(features.get("daynight")),
                        features.get("elevation"),
                        features.get("slope"),
                        features.get("aspect"),
                        features.get("temp"),
                        features.get("humidity"),
                        features.get("wind_speed"),
                        features.get("precip"),
                        int(features.get("month")),
                        inst_prob,
                        "Spread" if inst_prob >= SPREAD_THRESHOLD else "No Spread",
                        new_T,
                        new_T_burn,
                        block.block_id,
                        block.row,
                        block.col,
                    ),
                )
            except Exception:
                # Non-fatal: rollback to savepoint and continue
                try:
                    cur.execute("ROLLBACK TO SAVEPOINT sp_upsert_fire_inputs")
                except Exception:
                    pass

        # If this prediction came from a fire_inputs row, mark it processed
        if input_id is not None:
            try:
                cur.execute("SAVEPOINT sp_mark_processed")
                cur.execute(
                    """
                    UPDATE fire_inputs
                    SET processed    = TRUE,
                        processed_at = now(),
                        last_status  = %s,
                        last_response = %s
                    WHERE input_id = %s
                    """,
                    (
                        "ok",
                        Json({
                            "model": model_name,
                            "instant_spread_probability": inst_prob,
                            "T": new_T,
                            "T_burn": new_T_burn,
                            "block_id": block.block_id,
                            "block_row": block.row,
                            "block_col": block.col,
                            "block_center_latitude": block.center_lat,
                            "block_center_longitude": block.center_lon,
                        }),
                        input_id,
                    ),
                )
            except Exception:
                try:
                    cur.execute("ROLLBACK TO SAVEPOINT sp_mark_processed")
                except Exception:
                    pass

        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        # Don't spam stack traces when DB is offline in local dev
        print(f"[predict] DB error: {type(e).__name__}: {e}")
        try:
            conn.rollback()
        except Exception:
            pass
        # Fail-open: return a 200 with a db_error flag so clients can proceed locally
        return jsonify(
            {
                "db_error": f"Database error: {type(e).__name__}: {e}",
                "model": model_name,
                "instant_spread_probability": inst_prob,
                "prediction": "Spread" if inst_prob >= SPREAD_THRESHOLD else "No Spread",
                "T": new_T,
                "T_burn": new_T_burn,
                "block_id": block.block_id,
                "block_row": block.row,
                "block_col": block.col,
                "block_center_latitude": block.center_lat,
                "block_center_longitude": block.center_lon,
                "block_avg_spread_probability": block_avg_prob,
            }
        ), 200

    # ---- Success response ----
    return jsonify(
        {
            "model": model_name,
            "instant_spread_probability": inst_prob,
            "prediction": "Spread" if inst_prob >= SPREAD_THRESHOLD else "No Spread",
            "T": new_T,
            "T_burn": new_T_burn,
            "block_id": block.block_id,
            "block_row": block.row,
            "block_col": block.col,
            "block_center_latitude": block.center_lat,
            "block_center_longitude": block.center_lon,
            "block_avg_spread_probability": block_avg_prob,
        }
    )


@app.route("/predict-spread-animation", methods=["POST"])
def predict_spread_animation():
    """
    Simple cellular simulation wrapper that expands fire from initial cluster points.
    Accepts JSON:
      { cluster: [ {latitude, longitude, ...features} ], time_steps: int, model_name: str }

    Returns JSON: { predictions: [ { time: int, lat: float, lon: float, spread_probability: float, block_id: str }, ... ] }
    """
    try:
        body = request.get_json(force=True) or {}
        # Debug request size and keys
        try:
            size = len(request.data or b"")
            print(f"[sim] request received: bytes={size}, keys={list(body.keys())}")
            if isinstance(body.get("cluster"), list):
                print(f"[sim] cluster size={len(body['cluster'])}, time_steps={body.get('time_steps')} model={body.get('model_name') or body.get('model')}")
            else:
                print("[sim] cluster missing or not a list")
        except Exception:
            pass
    except Exception as e:
        return jsonify({"error": f"Invalid JSON body: {e}"}), 400

    cluster = body.get("cluster") or []
    time_steps = int(body.get("time_steps", 24))
    model_name = (body.get("model_name") or body.get("model") or "random_forest").lower()
    # Allow caller to tune spread threshold (default to global if not provided)
    try:
        threshold = float(body.get("spread_threshold", SPREAD_THRESHOLD))
    except Exception:
        threshold = SPREAD_THRESHOLD

    # Performance / behavior tuning parameters
    fast_mode = bool(body.get("fast_mode", False))            # skips DB weighting & limits candidates
    max_cells = int(body.get("max_cells", 1500))              # hard cap on total tracked blocks
    max_candidates_per_step = int(body.get("max_candidates_per_step", 300))  # per-step prediction cap

    if not isinstance(cluster, list) or len(cluster) == 0:
        return jsonify({"error": "cluster must be a non-empty array of points"}), 400

    # Simulation limits
    MAX_CELLS = 10000
    MAX_TIME_STEPS = 168
    time_steps = min(time_steps, MAX_TIME_STEPS)

    # Helper to compute block center from row/col (same logic as snap_to_grid)
    origin_lat = 25.0
    origin_lon = -125.0
    cell_lat = DEG_LAT_200FT
    def block_center(row: int, col: int):
        center_lat = origin_lat + (row + 0.5) * cell_lat
        # cell_lon depends on latitude
        cell_lon = DEG_LON_200FT_AT_EQ * max(math.cos(math.radians(center_lat)), 0.1)
        center_lon = origin_lon + (col + 0.5) * cell_lon
        return center_lat, center_lon

    # Seed blocks from cluster points
    blocks = {}  # block_id -> {row,col,center_lat,center_lon, T, T_burn, last_prob}

    for pt in cluster:
        try:
            lat = float(pt.get("latitude"))
            lon = float(pt.get("longitude"))
        except Exception:
            continue
        b = snap_to_grid(lat, lon)
        blocks[b.block_id] = {
            "row": b.row,
            "col": b.col,
            "center_lat": b.center_lat,
            "center_lon": b.center_lon,
            "T": 0,
            "T_burn": 1,  # ignition
            "last_prob": 1.0,
        }

    # NOTE: DB frontier seeding moved below after connection establishment to avoid UnboundLocalError on 'cur'.

    # Use first cluster point as template for non-location features
    template = cluster[0]

    predictions_out = []

    # Prepare DB connection for persisting per-cell state across the animation
    conn = None
    cur = None
    try:
        conn = get_db_conn()
        conn.autocommit = False
        cur = conn.cursor()
        # Ensure tables exist (idempotent)
        try:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS block_index (
                    block_id TEXT PRIMARY KEY,
                    block_row INT,
                    block_col INT,
                    block_center_latitude DOUBLE PRECISION,
                    block_center_longitude DOUBLE PRECISION,
                    T INT,
                    T_burn INT,
                    block_avg_spread_probability DOUBLE PRECISION,
                    updated_at TIMESTAMPTZ DEFAULT now()
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS fire_cell_state (
                    block_row INT,
                    block_col INT,
                    block_id TEXT,
                    last_latitude DOUBLE PRECISION,
                    last_longitude DOUBLE PRECISION,
                    t INT,
                    t_burn INT,
                    last_prob DOUBLE PRECISION,
                    prob_sum DOUBLE PRECISION,
                    prob_count INT,
                    instant_spread_probability DOUBLE PRECISION,
                    updated_at TIMESTAMPTZ DEFAULT now(),
                    PRIMARY KEY (block_row, block_col)
                )
                """
            )
        except Exception:
            # Ignore DDL failures; we'll still attempt to run simulation
            conn.rollback()
            cur = conn.cursor()
    except Exception:
        # If we cannot connect, proceed with simulation-only (no persistence)
        conn = None
        cur = None

    # If DB connection succeeded, merge in currently burning frontier from block_index (T_burn=1)
    if conn is not None and cur is not None:
        try:
            cur.execute(
                """
                SELECT block_id, block_row, block_col, block_center_latitude, block_center_longitude, T, T_burn
                FROM block_index
                WHERE T_burn = 1
                """
            )
            rows = cur.fetchall() or []
            for (bid, r, c, clat, clon, tval, tburn) in rows:
                blocks[bid] = {
                    "row": int(r),
                    "col": int(c),
                    "center_lat": float(clat),
                    "center_lon": float(clon),
                    "T": int(tval or 0),
                    "T_burn": int(tburn or 1),
                    "last_prob": 1.0,
                }
            try:
                print(f"[sim] seeded from DB frontier: {len(rows)} burning cells")
            except Exception:
                pass
        except Exception as seed_e:
            try:
                print(f"[sim] frontier seed failed: {type(seed_e).__name__}: {seed_e}")
            except Exception:
                pass

    # Local timeline update using request threshold
    def local_update(old_T: int, old_T_burn: int, prob: float, can_burn: bool) -> Tuple[int, int]:
        if not can_burn:
            return 0, 3
        if old_T_burn in (2, 3):
            return old_T, old_T_burn
        if prob >= threshold:
            if old_T_burn == 0:
                return 0, 1
            if old_T_burn == 1:
                new_T = min(old_T + 1, T_MAX)
                if new_T >= T_MAX:
                    return new_T, 2
                return new_T, 1
            return 0, 1
        else:
            if old_T_burn == 1:
                return 0, 0
            return old_T, old_T_burn

    # Simulation loop
    for t in range(time_steps):
        try:
            print(f"[sim] step {t+1}/{time_steps} starting; active_blocks={len(blocks)}")
        except Exception:
            pass
        if len(blocks) > MAX_CELLS or len(blocks) > max_cells:
            break

        # Gather candidates: neighbors of currently burning cells + the burning cells themselves
        candidates = {}
        for b_id, st in list(blocks.items()):
            if st.get("T_burn") == 1:
                r = st["row"]
                c = st["col"]
                for dr in (-1, 0, 1):
                    for dc in (-1, 0, 1):
                        nr = r + dr
                        nc = c + dc
                        nb_id = f"CA-{nr}-{nc}"
                        center_lat, center_lon = block_center(nr, nc)
                        if nb_id in candidates:
                            candidates[nb_id]["burning_neighbors"] += 1
                        else:
                            candidates[nb_id] = {
                                "row": nr,
                                "col": nc,
                                "center_lat": center_lat,
                                "center_lon": center_lon,
                                "burning_neighbors": 1,
                            }

        try:
            print(f"[sim] step {t+1}: predicting candidates={len(candidates)}")
        except Exception:
            pass

        # In fast_mode, cap candidate count for performance (approximate frontier expansion)
        if fast_mode and len(candidates) > max_candidates_per_step:
            # Simple selection strategy: prioritize those with more burning neighbors
            sorted_items = sorted(candidates.items(), key=lambda kv: kv[1].get("burning_neighbors", 0), reverse=True)
            trimmed = dict(sorted_items[:max_candidates_per_step])
            candidates = trimmed
            try:
                print(f"[sim] fast_mode trim: capped candidates to {len(candidates)}")
            except Exception:
                pass
        # Batch build feature dicts
        feature_batch = []
        meta_order = []  # keep order to map back probabilities
        for nb_id, meta in candidates.items():
            if nb_id in blocks:
                old_T = blocks[nb_id]["T"]
                old_T_burn = blocks[nb_id]["T_burn"]
            else:
                old_T, old_T_burn = 0, 0
            feat = {}
            for k in FEATURE_KEYS:
                if k == "latitude":
                    feat["latitude"] = meta["center_lat"]
                elif k == "longitude":
                    feat["longitude"] = meta["center_lon"]
                else:
                    feat[k] = template.get(k, template.get(k.lower(), 0))
            seed_base = f"{nb_id}-{t}"
            rnd = random.Random(seed_base)
            feat["temp"] = float(feat.get("temp", 0)) + rnd.uniform(-2.0, 2.0)
            feat["humidity"] = float(feat.get("humidity", 0)) + rnd.uniform(-5.0, 5.0)
            feat["wind_speed"] = float(feat.get("wind_speed", 0)) + rnd.uniform(-1.5, 1.5)
            feat["slope"] = float(feat.get("slope", 0)) + rnd.uniform(-3.0, 3.0)
            feat["brightness"] = float(feat.get("brightness", 0)) + 8.0 * float(meta.get("burning_neighbors", 1))
            feat["humidity"] = max(0.0, min(100.0, feat["humidity"]))
            feat["wind_speed"] = max(0.0, feat["wind_speed"])
            feature_batch.append(feat)
            meta_order.append((nb_id, meta, old_T, old_T_burn))

        probs = []
        try:
            probs = predict_fire_spread_batch(feature_batch, model_name=model_name)
        except Exception:
            probs = [0.0] * len(feature_batch)

        for (nb_id, meta, old_T, old_T_burn), prob in zip(meta_order, probs):
            if cur is not None and not fast_mode:
                try:
                    cur.execute(
                        """
                        SELECT prob_sum, prob_count
                        FROM fire_cell_state
                        WHERE block_row = %s AND block_col = %s
                        """,
                        (meta["row"], meta["col"]),
                    )
                    rec = cur.fetchone()
                    if rec:
                        ps, pc = rec
                        avg = (float(ps) / pc) if (ps is not None and pc and pc > 0) else None
                    else:
                        avg = None
                except Exception as db_e:
                    avg = None
                    try:
                        print(f"[sim] db avg fetch failed for {meta['row']},{meta['col']}: {type(db_e).__name__}: {db_e}")
                    except Exception:
                        pass
                bn = float(meta.get("burning_neighbors", 1))
                w_neighbors = 0.08
                w_avg = 0.5
                combined = prob + (w_neighbors * bn) + (w_avg * (avg if avg is not None else 0.0))
                prob = max(0.0, min(1.0, combined))

            new_T, new_T_burn = local_update(old_T, old_T_burn, prob, True)
            blocks[nb_id] = {
                "row": meta["row"],
                "col": meta["col"],
                "center_lat": meta["center_lat"],
                "center_lon": meta["center_lon"],
                "T": new_T,
                "T_burn": new_T_burn,
                "last_prob": prob,
            }
            predictions_out.append({
                "time": t,
                "lat": meta["center_lat"],
                "lon": meta["center_lon"],
                "spread_probability": prob,
                "block_id": nb_id,
            })
            if cur is not None:
                try:
                    cur.execute(
                        """
                        INSERT INTO block_index (
                            block_id, block_row, block_col, block_center_latitude, block_center_longitude,
                            T, T_burn, block_avg_spread_probability
                        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                        ON CONFLICT (block_id) DO UPDATE SET
                            block_row = EXCLUDED.block_row,
                            block_col = EXCLUDED.block_col,
                            block_center_latitude = EXCLUDED.block_center_latitude,
                            block_center_longitude = EXCLUDED.block_center_longitude,
                            T = EXCLUDED.T,
                            T_burn = EXCLUDED.T_burn,
                            block_avg_spread_probability = block_index.block_avg_spread_probability,
                            updated_at = now()
                        """,
                        (
                            nb_id,
                            meta["row"],
                            meta["col"],
                            meta["center_lat"],
                            meta["center_lon"],
                            new_T,
                            new_T_burn,
                            prob,
                        ),
                    )
                    cur.execute(
                        """
                        INSERT INTO fire_cell_state (
                            block_row, block_col, block_id, last_latitude, last_longitude,
                            t, t_burn, last_prob, prob_sum, prob_count, instant_spread_probability
                        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                        ON CONFLICT (block_row, block_col) DO UPDATE SET
                            block_id = EXCLUDED.block_id,
                            last_latitude = EXCLUDED.last_latitude,
                            last_longitude = EXCLUDED.last_longitude,
                            t = EXCLUDED.t,
                            t_burn = EXCLUDED.t_burn,
                            last_prob = EXCLUDED.last_prob,
                            prob_sum = fire_cell_state.prob_sum + EXCLUDED.instant_spread_probability,
                            prob_count = fire_cell_state.prob_count + 1,
                            instant_spread_probability = EXCLUDED.instant_spread_probability,
                            updated_at = now()
                        """,
                        (
                            meta["row"],
                            meta["col"],
                            nb_id,
                            meta["center_lat"],
                            meta["center_lon"],
                            new_T,
                            new_T_burn,
                            prob,
                            prob,
                            1,
                            prob,
                        ),
                    )
                    cur.execute(
                        """
                        UPDATE block_index b
                        SET block_avg_spread_probability = COALESCE(f.prob_sum / NULLIF(f.prob_count, 0), %s),
                            updated_at = now()
                        FROM fire_cell_state f
                        WHERE b.block_id = %s AND f.block_row = %s AND f.block_col = %s
                        """,
                        (
                            prob,
                            nb_id,
                            meta["row"],
                            meta["col"],
                        ),
                    )
                except Exception as db_u:
                    if conn is not None:
                        try:
                            conn.rollback()
                            cur = conn.cursor()
                        except Exception:
                            cur = None
                    try:
                        print(f"[sim] db upsert failed: {type(db_u).__name__}: {db_u}")
                    except Exception:
                        pass

        # Optional: prune blocks that are burned out and not relevant
        # (keep them; rendering may want historical burned cells)

    # Commit DB changes if any
    if conn is not None and cur is not None:
        try:
            conn.commit()
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
        finally:
            try:
                cur.close()
                conn.close()
            except Exception:
                pass

    try:
        print(f"[sim] complete: time_steps={time_steps}, total_predictions={len(predictions_out)}, unique_blocks={len(blocks)}")
    except Exception:
        pass
    return jsonify({"predictions": predictions_out, "time_steps": time_steps})
    
@app.route("/spread-front", methods=["GET"])
def spread_front():
    """
    Inspect current burning frontier and immediate neighbor candidates without running the full simulation.
    Query params:
      - max_neighbors: optional cap per frontier cell (default 8)
    Returns JSON with `front` (burning cells) and `candidates` (neighbors with historical avg and burning_neighbors).
    """
    if not HAS_PG or not USE_DB:
        return jsonify({"ok": False, "error": "DB disabled in this environment; set USE_DB=true to enable"}), 200

    try:
        max_neighbors = int(request.args.get("max_neighbors", 8))
    except Exception:
        max_neighbors = 8

    conn = None
    cur = None
    try:
        conn = get_db_conn()
        cur = conn.cursor()

        # Fetch frontier: currently burning cells
        cur.execute(
            """
            SELECT block_id, block_row, block_col, block_center_latitude, block_center_longitude, T, T_burn
            FROM block_index
            WHERE T_burn = 1
            """
        )
        front_rows = cur.fetchall() or []
        front = []
        for (bid, r, c, clat, clon, tval, tburn) in front_rows:
            front.append({
                "block_id": bid,
                "row": int(r),
                "col": int(c),
                "center_lat": float(clat) if clat is not None else None,
                "center_lon": float(clon) if clon is not None else None,
                "T": int(tval or 0),
                "T_burn": int(tburn or 1),
            })

        # Build neighbor candidates around frontier
        candidates = {}
        for f in front:
            r = f["row"]
            c = f["col"]
            count = 0
            for dr in (-1, 0, 1):
                for dc in (-1, 0, 1):
                    nr = r + dr
                    nc = c + dc
                    nb_id = f"CA-{nr}-{nc}"
                    if nb_id in candidates:
                        candidates[nb_id]["burning_neighbors"] += 1
                        continue
                    # Compute neighbor center
                    center_lat, center_lon = (
                        (25.0 + (nr + 0.5) * DEG_LAT_200FT),
                        None,
                    )
                    cell_lon = DEG_LON_200FT_AT_EQ * max(math.cos(math.radians(center_lat)), 0.1)
                    center_lon = -125.0 + (nc + 0.5) * cell_lon
                    candidates[nb_id] = {
                        "block_id": nb_id,
                        "row": nr,
                        "col": nc,
                        "center_lat": center_lat,
                        "center_lon": center_lon,
                        "burning_neighbors": 1,
                    }
                    count += 1
                    if count >= max_neighbors:
                        break
                if count >= max_neighbors:
                    break

        # Enrich candidates with historical averages
        out_candidates = []
        for nb_id, meta in candidates.items():
            try:
                cur.execute(
                    """
                    SELECT prob_sum, prob_count, last_prob, t, t_burn, instant_spread_probability
                    FROM fire_cell_state
                    WHERE block_row = %s AND block_col = %s
                    """,
                    (meta["row"], meta["col"]),
                )
                rec = cur.fetchone()
                if rec:
                    ps, pc, last_p, tval, tburn, inst = rec
                    avg = (float(ps) / pc) if (ps is not None and pc and pc > 0) else None
                else:
                    avg = None
                    last_p = None
                    tval = None
                    tburn = None
                    inst = None
            except Exception:
                avg = None
                last_p = None
                tval = None
                tburn = None
                inst = None

            out_candidates.append({
                **meta,
                "avg": avg,
                "last_prob": (float(last_p) if last_p is not None else None),
                "t": (int(tval) if tval is not None else None),
                "t_burn": (int(tburn) if tburn is not None else None),
                "instant_spread_probability": (float(inst) if inst is not None else None),
            })

        try:
            cur.close()
            conn.close()
        except Exception:
            pass

        return jsonify({"front": front, "candidates": out_candidates, "count": len(out_candidates)})
    except Exception as e:
        try:
            cur and cur.close()
            conn and conn.close()
        except Exception:
            pass
        # Return 200 with ok:false for friendlier local dev behavior
        return jsonify({"ok": False, "error": f"{type(e).__name__}: {e}"}), 200


@app.route("/predict-spread-stream", methods=["GET"])
def predict_spread_stream():
    """
    Server-Sent Events (SSE) endpoint that streams per-step predictions as they are computed.
    Query params:
      - cluster: JSON-encoded array of points [{latitude, longitude, ...}]
      - time_steps, model_name, spread_threshold, fast_mode, max_cells, max_candidates_per_step
    """
    import json
    import math
    import random
    import time
    # Parse query params
    try:
        cluster_json = request.args.get("cluster", "[]")
        cluster = json.loads(cluster_json)
    except Exception as e:
        return jsonify({"ok": False, "error": f"Invalid cluster: {e}"}), 400
    try:
        time_steps = int(request.args.get("time_steps", 24))
    except Exception:
        time_steps = 24
    model_name = (request.args.get("model_name") or request.args.get("model") or "random_forest").lower()
    try:
        threshold = float(request.args.get("spread_threshold", SPREAD_THRESHOLD))
    except Exception:
        threshold = SPREAD_THRESHOLD
    fast_mode = (request.args.get("fast_mode", "false").lower() in ("1", "true", "yes"))
    try:
        max_cells = int(request.args.get("max_cells", 1500))
    except Exception:
        max_cells = 1500
    try:
        max_candidates_per_step = int(request.args.get("max_candidates_per_step", 300))
    except Exception:
        max_candidates_per_step = 300

    if not isinstance(cluster, list) or not cluster:
        return jsonify({"ok": False, "error": "cluster must be a non-empty array"}), 400

    def sse_gen():
        # Preface headers hints for proxies
        # Stream simulation similar to predict_spread_animation, yielding per step
        origin_lat = 25.0
        origin_lon = -125.0
        cell_lat = DEG_LAT_200FT
        def block_center(row: int, col: int):
            center_lat = origin_lat + (row + 0.5) * cell_lat
            cell_lon = DEG_LON_200FT_AT_EQ * max(math.cos(math.radians(center_lat)), 0.1)
            center_lon = origin_lon + (col + 0.5) * cell_lon
            return center_lat, center_lon

        # Seed from cluster
        blocks = {}
        for pt in cluster:
            try:
                lat = float(pt.get("latitude")); lon = float(pt.get("longitude"))
            except Exception:
                continue
            b = snap_to_grid(lat, lon)
            blocks[b.block_id] = {"row": b.row, "col": b.col, "center_lat": b.center_lat, "center_lon": b.center_lon, "T": 0, "T_burn": 1, "last_prob": 1.0, "exposure": 0.0}

        # DB setup (optional)
        conn = None; cur = None
        try:
            conn = get_db_conn(); conn.autocommit = False; cur = conn.cursor()
        except Exception:
            conn = None; cur = None

        # Template
        template = cluster[0]
        # Tunables for CA-style transition
        KW = 0.017; KS = 0.012  # wind/slope coefficient scales
        ALPHA = 1.0; BETA = 0.6 # random threshold parameters
        NOISE = 0.15            # stochastic jitter magnitude (increased to reduce linearity)

        # Realism controls for spread threshold dynamics
        BASE_SPREAD_THRESHOLD = 0.75       # starting ignition threshold at hour 0
        THRESHOLD_DECAY_RATE = 0.60        # reduces threshold by 60% by final hour
        NEIGHBOR_THRESHOLD_BONUS = 0.05    # -5% per burning neighbor
        MIN_THRESHOLD = 0.20               # minimum threshold regardless of decay/neighbors
        EXPOSURE_IGNITION_THRESHOLD = 1.0  # accumulated exposure needed for auto-ignition
        T_MAX = 12                         # maximum burn stage before considered burned

        def local_update(old_T: int, old_T_burn: int, prob: float, can_burn: bool):
            if not can_burn: return 0, 3
            if old_T_burn in (2,3): return old_T, old_T_burn
            if prob >= threshold:
                if old_T_burn == 0: return 0, 1
                if old_T_burn == 1:
                    new_T = min(old_T+1, T_MAX)
                    if new_T >= T_MAX: return new_T, 2
                    return new_T, 1
                return 0, 1
            else:
                if old_T_burn == 1: return 0, 0
                return old_T, old_T_burn

        def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
            # Approximate bearing using equirectangular projection
            dlat = math.radians(lat2 - lat1)
            dlon = math.radians(lon2 - lon1)
            x = math.cos(math.radians((lat1 + lat2) * 0.5)) * dlon
            ang = math.degrees(math.atan2(x, dlat))
            if ang < 0: ang += 360.0
            return ang

        def angle_diff(a: float, b: float) -> float:
            d = abs(a - b) % 360.0
            return d if d <= 180.0 else 360.0 - d

        avg_ms = None
        for t in range(time_steps):
            step_start = time.time()
            try:
                yield f"event: log\ndata:{json.dumps({'msg': f'step {t+1}/{time_steps}', 'active_blocks': len(blocks)})}\n\n"
            except Exception:
                pass
            if len(blocks) > max_cells:
                break
            # Build candidates (Moore neighborhood with direction indices)
            candidates = {}
            for b_id, st in list(blocks.items()):
                if st.get("T_burn") == 1:
                    r = st["row"]; c = st["col"]
                    for dr in (-1,0,1):
                        for dc in (-1,0,1):
                            nr = r+dr; nc = c+dc
                            nb_id = f"CA-{nr}-{nc}"
                            clat, clon = block_center(nr,nc)
                            # Base neighbor weight
                            w = 1.0
                            # Wind/slope directional bias (if available in template)
                            try:
                                src_lat = st["center_lat"]; src_lon = st["center_lon"]
                                brg = bearing_deg(src_lat, src_lon, clat, clon)
                                wind_dir = float(template.get("wind_direction", template.get("wind_dir", 0)))
                                # add per-candidate directional jitter to reduce straight-line bias
                                wind_dir = (wind_dir + (random.random() * 40.0 - 20.0)) % 360.0
                                wind_speed = float(template.get("wind_speed", 0))
                                slope = float(template.get("slope", 0))
                                aspect = float(template.get("aspect", 0))
                                # CA-style projection: v*cos(theta) scaled by KW/KS
                                if wind_speed > 0:
                                    d = angle_diff(brg, wind_dir)
                                    w += KW * wind_speed * max(0.0, math.cos(math.radians(d)))
                                if abs(slope) > 0:
                                    d2 = angle_diff(brg, aspect)
                                    w += KS * abs(slope) * max(0.0, math.cos(math.radians(d2)))
                                # Clamp weight
                                w = max(0.2, min(2.0, w))
                            except Exception:
                                w = max(0.8, w)

                            if nb_id in candidates:
                                candidates[nb_id]["burning_neighbors"] += w
                            else:
                                candidates[nb_id] = {"row": nr, "col": nc, "center_lat": clat, "center_lon": clon, "burning_neighbors": w}
            if fast_mode and len(candidates) > max_candidates_per_step:
                items = sorted(candidates.items(), key=lambda kv: kv[1].get("burning_neighbors",0), reverse=True)
                candidates = dict(items[:max_candidates_per_step])

            # Batch-fetch DB averages for enriched runs (non-fast mode)
            avg_map = {}
            if cur is not None and not fast_mode and candidates:
                pairs = [(meta["row"], meta["col"]) for meta in candidates.values()]
                # Limit to 1000 to avoid huge queries
                pairs = pairs[:1000]
                # Build dynamic placeholders for row-wise IN
                in_clause = ",".join(["(%s,%s)" for _ in pairs])
                try:
                    cur.execute(
                        f"SELECT block_row, block_col, prob_sum, prob_count FROM fire_cell_state WHERE (block_row, block_col) IN ({in_clause})",
                        tuple([x for pair in pairs for x in pair])
                    )
                    for r in cur.fetchall() or []:
                        br, bc, ps, pc = r
                        avg = (float(ps)/pc) if (ps is not None and pc and pc>0) else None
                        avg_map[(br, bc)] = avg
                except Exception:
                    avg_map = {}

            # Build batch
            feature_batch = []; meta_order = []
            for nb_id, meta in candidates.items():
                old_T = blocks.get(nb_id, {}).get("T", 0)
                old_T_burn = blocks.get(nb_id, {}).get("T_burn", 0)
                feat = {}
                for k in FEATURE_KEYS:
                    if k == "latitude": feat["latitude"] = meta["center_lat"]
                    elif k == "longitude": feat["longitude"] = meta["center_lon"]
                    else: feat[k] = template.get(k, template.get(k.lower(), 0))
                seed_base = f"{nb_id}-{t}"; rnd = random.Random(seed_base)
                feat["temp"] = float(feat.get("temp",0)) + rnd.uniform(-2.0,2.0)
                feat["humidity"] = max(0.0, min(100.0, float(feat.get("humidity",0)) + rnd.uniform(-5.0,5.0)))
                feat["wind_speed"] = max(0.0, float(feat.get("wind_speed",0)) + rnd.uniform(-1.5,1.5))
                feat["slope"] = float(feat.get("slope",0)) + rnd.uniform(-3.0,3.0)
                feat["brightness"] = float(feat.get("brightness",0)) + 8.0 * float(meta.get("burning_neighbors",1))
                feature_batch.append(feat); meta_order.append((nb_id, meta, old_T, old_T_burn))

            try:
                probs = predict_fire_spread_batch(feature_batch, model_name=model_name)
            except Exception:
                probs = [0.0]*len(feature_batch)

            step_out = []
            for (nb_id, meta, old_T, old_T_burn), base_prob in zip(meta_order, probs):
                # Internal ignition probability (softened): Pc from model
                Pc = max(0.0, min(1.0, base_prob))
                
                # Adjacent wind/slope effect θ from burning neighbors (already encoded in burning_neighbors weight)
                bn = float(meta.get("burning_neighbors", 0.0))
                # Normalize θ to [0,1] via tanh to avoid explosion
                theta = math.tanh(0.5 * bn)
                # Include historical avg in enriched mode
                if cur is not None and not fast_mode:
                    avg = avg_map.get((meta["row"], meta["col"])) or 0.0
                    theta = max(0.0, min(1.0, theta + 0.5 * avg))

                # Final ignition probability with stochastic jitter
                rnd = random.random()
                Pc_adj = max(0.0, min(1.0, Pc * theta + NOISE * (rnd - 0.5)))

                prob = Pc_adj

                # Dynamic ignition threshold: decays over horizon and is reduced by burning neighbors
                decay_factor = 1.0 - THRESHOLD_DECAY_RATE * min(1.0, t / max(1, time_steps))
                threshold_t = BASE_SPREAD_THRESHOLD * decay_factor
                threshold_t = threshold_t - NEIGHBOR_THRESHOLD_BONUS * bn
                threshold_t = max(MIN_THRESHOLD, threshold_t)

                # Accumulate exposure (bounded) and allow auto-ignition when sufficient
                prev_state = blocks.get(nb_id, {})
                prev_exposure = float(prev_state.get("exposure", 0.0))
                exposure = max(0.0, min(10.0, prev_exposure + prob))
                auto_ignite = (exposure >= EXPOSURE_IGNITION_THRESHOLD)

                # Use dynamic threshold or exposure auto-ignite
                threshold = threshold_t  # used by local_update
                ignite = auto_ignite or (prob >= threshold_t)
                # If not igniting and was burning, may cool to unburned; else retain
                if ignite:
                    new_T, new_T_burn = local_update(old_T, old_T_burn, 1.0, True)
                else:
                    new_T, new_T_burn = local_update(old_T, old_T_burn, 0.0, True)
                blocks[nb_id] = {"row": meta["row"], "col": meta["col"], "center_lat": meta["center_lat"], "center_lon": meta["center_lon"], "T": new_T, "T_burn": new_T_burn, "last_prob": prob, "exposure": exposure}
                step_out.append({
                    "time": t,
                    "lat": meta["center_lat"],
                    "lon": meta["center_lon"],
                    "spread_probability": prob,
                    "block_id": nb_id,
                    "t": new_T,
                    "t_burn": new_T_burn,
                    "state": ("burned" if new_T_burn == 2 else ("burning" if new_T_burn == 1 else "unburned"))
                })

                if cur is not None:
                    try:
                        cur.execute(
                            """
                            INSERT INTO block_index (block_id, block_row, block_col, block_center_latitude, block_center_longitude, T, T_burn, block_avg_spread_probability)
                            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                            ON CONFLICT (block_id) DO UPDATE SET
                                block_row=EXCLUDED.block_row, block_col=EXCLUDED.block_col,
                                block_center_latitude=EXCLUDED.block_center_latitude, block_center_longitude=EXCLUDED.block_center_longitude,
                                T=EXCLUDED.T, T_burn=EXCLUDED.T_burn, updated_at=now()
                            """,
                            (nb_id, meta["row"], meta["col"], meta["center_lat"], meta["center_lon"], new_T, new_T_burn, prob)
                        )
                        cur.execute(
                            """
                            INSERT INTO fire_cell_state (block_row, block_col, block_id, last_latitude, last_longitude, t, t_burn, last_prob, prob_sum, prob_count, instant_spread_probability)
                            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                            ON CONFLICT (block_row, block_col) DO UPDATE SET
                                block_id=EXCLUDED.block_id, last_latitude=EXCLUDED.last_latitude, last_longitude=EXCLUDED.last_longitude,
                                t=EXCLUDED.t, t_burn=EXCLUDED.t_burn, last_prob=EXCLUDED.last_prob,
                                prob_sum=fire_cell_state.prob_sum + EXCLUDED.instant_spread_probability,
                                prob_count=fire_cell_state.prob_count + 1,
                                instant_spread_probability=EXCLUDED.instant_spread_probability, updated_at=now()
                            """,
                            (meta["row"], meta["col"], nb_id, meta["center_lat"], meta["center_lon"], new_T, new_T_burn, prob, prob, 1, prob)
                        )
                        cur.execute("UPDATE block_index b SET block_avg_spread_probability = COALESCE(f.prob_sum / NULLIF(f.prob_count,0), %s), updated_at=now() FROM fire_cell_state f WHERE b.block_id=%s AND f.block_row=%s AND f.block_col=%s", (prob, nb_id, meta["row"], meta["col"]))
                    except Exception:
                        try:
                            conn.rollback(); cur = conn.cursor()
                        except Exception:
                            cur = None

            # Yield this step
            yield f"event: step\ndata:{json.dumps({'time': t, 'predictions': step_out})}\n\n"

            # Timing and ETA metrics
            step_ms = int((time.time() - step_start) * 1000)
            if avg_ms is None:
                avg_ms = step_ms
            else:
                avg_ms = int(0.6 * avg_ms + 0.4 * step_ms)
            remaining = max(0, time_steps - (t + 1))
            eta_ms = avg_ms * remaining
            try:
                yield f"event: log\ndata:{json.dumps({'step_ms': step_ms, 'avg_ms': avg_ms, 'eta_ms': eta_ms, 'step': t+1, 'remaining_steps': remaining})}\n\n"
            except Exception:
                pass

        # Finalize
        if conn is not None and cur is not None:
            try:
                conn.commit(); cur.close(); conn.close()
            except Exception:
                pass
        yield f"event: done\ndata:{json.dumps({'status': 'complete', 'time_steps': time_steps})}\n\n"

    headers = {"Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    return Response(stream_with_context(sse_gen()), headers=headers)
    


if __name__ == "__main__":
    # Render will run this with `python Server.py`
    # Use PORT environment variable when available (Render sets this)
    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port, debug=True)
