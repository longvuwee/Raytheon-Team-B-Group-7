# Server.py
from __future__ import annotations

import math
import os
from dataclasses import dataclass
from typing import Tuple, Dict, Any

import psycopg2
from psycopg2.extras import Json
from flask import Flask, request, jsonify
from flask_cors import CORS

from predictor import predict_fire_spread

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

# Explicit OPTIONS handler to ensure 200 OK on preflight
@app.route("/predict", methods=["OPTIONS"])
def predict_options():
    return ("", 200)

@app.route("/predict-spread-animation", methods=["OPTIONS"])
def predict_spread_animation_options():
    return ("", 200)

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
DB_CONFIG = {
    "host": os.environ.get("DB_HOST"),
    "dbname": os.environ.get("DB_NAME", "postgres"),
    "user": os.environ.get("DB_USER", "postgres"),
    "password": os.environ.get("DB_PASSWORD"),
    "port": os.environ.get("DB_PORT", 5432),
}


def get_db_conn():
    return psycopg2.connect(**DB_CONFIG)


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


SPREAD_THRESHOLD = 0.75
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


@app.route("/db-check", methods=["GET"])
def db_check():
    """
    Connectivity and schema sanity check:
    - Attempts a simple upsert into block_index
    - Attempts an upsert into fire_cell_state
    Returns first error encountered with details
    """
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
        return jsonify({"ok": False, "stage": "connect", "error": str(e)}), 500


@app.route("/db-check-fire-inputs", methods=["GET"])
def db_check_fire_inputs():
    """
    Check fire_inputs upsert path specifically to surface schema mismatches.
    """
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
        pred = predict_fire_spread(features, model_name=model_name)
        inst_prob = float(pred["spread_probability"])
    except Exception as e:
        import traceback
        traceback.print_exc()
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

        # For now we just overwrite avg with this instant prob
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
                prob_sum                   = fire_cell_state.prob_sum + EXCLUDED.last_prob,
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
        import traceback
        traceback.print_exc()
        try:
            conn.rollback()
        except Exception:
            pass
        # Still return something useful but mark DB failure
        return jsonify(
            {
                "error": f"Database error: {type(e).__name__}: {e}",
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
        ), 500

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
    except Exception as e:
        return jsonify({"error": f"Invalid JSON body: {e}"}), 400

    cluster = body.get("cluster") or []
    time_steps = int(body.get("time_steps", 24))
    model_name = (body.get("model_name") or body.get("model") or "random_forest").lower()

    if not isinstance(cluster, list) or len(cluster) == 0:
        return jsonify({"error": "cluster must be a non-empty array of points"}), 400

    # Simulation limits
    MAX_CELLS = 5000
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

    # Simulation loop
    for t in range(time_steps):
        if len(blocks) > MAX_CELLS:
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
                        if nb_id in candidates:
                            continue
                        center_lat, center_lon = block_center(nr, nc)
                        candidates[nb_id] = {"row": nr, "col": nc, "center_lat": center_lat, "center_lon": center_lon}

        # Build features for each candidate and predict
        for nb_id, meta in candidates.items():
            if nb_id in blocks:
                old_T = blocks[nb_id]["T"]
                old_T_burn = blocks[nb_id]["T_burn"]
            else:
                old_T, old_T_burn = 0, 0

            # Build feature dict: reuse template for non-location fields
            feat = {}
            for k in FEATURE_KEYS:
                if k == "latitude":
                    feat["latitude"] = meta["center_lat"]
                elif k == "longitude":
                    feat["longitude"] = meta["center_lon"]
                else:
                    # fall back to template values or zeros
                    feat[k] = template.get(k, template.get(k.lower(), 0))

            try:
                pred = predict_fire_spread(feat, model_name=model_name)
                prob = float(pred.get("spread_probability", 0.0))
            except Exception:
                prob = 0.0

            # Update timeline rules (use can_burn True)
            new_T, new_T_burn = update_timeline(old_T, old_T_burn, prob, True)

            # Update block state (in-memory)
            blocks[nb_id] = {
                "row": meta["row"],
                "col": meta["col"],
                "center_lat": meta["center_lat"],
                "center_lon": meta["center_lon"],
                "T": new_T,
                "T_burn": new_T_burn,
                "last_prob": prob,
            }

            # Record this prediction for the current time-step
            predictions_out.append({
                "time": t,
                "lat": meta["center_lat"],
                "lon": meta["center_lon"],
                "spread_probability": prob,
                "block_id": nb_id,
            })

            # Persist per-cell state if DB available
            if cur is not None:
                try:
                    # Upsert block_index with latest T/T_burn and average prob (use current prob)
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
                            block_avg_spread_probability = EXCLUDED.block_avg_spread_probability,
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

                    # Upsert fire_cell_state accumulating probability samples and last state
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
                            prob_sum = fire_cell_state.prob_sum + EXCLUDED.last_prob,
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
                except Exception:
                    # Keep simulation running; defer commit and continue
                    if conn is not None:
                        try:
                            conn.rollback()
                            cur = conn.cursor()
                        except Exception:
                            cur = None

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

    return jsonify({"predictions": predictions_out, "time_steps": time_steps})
    
    


if __name__ == "__main__":
    # Render will run this with `python Server.py`
    # Use PORT environment variable when available (Render sets this)
    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port, debug=True)
