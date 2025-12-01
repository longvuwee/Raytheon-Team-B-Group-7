# Server.py
from __future__ import annotations

import math
import os
from dataclasses import dataclass
from typing import Tuple, Dict, Any

import psycopg2
from flask import Flask, request, jsonify
from flask_cors import CORS

from predictor import predict_fire_spread

app = Flask(__name__)
CORS(app)

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

        # Write per-request history
        cur.execute(
            """
            INSERT INTO fire_cell_state (
                block_id,
                T,
                T_burn,
                instant_spread_probability
            )
            VALUES (%s,%s,%s,%s)
            """,
            (block.block_id, new_T, new_T_burn, inst_prob),
        )

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


if __name__ == "__main__":
    # Render will run this with `python Server.py`
    app.run(host="0.0.0.0", port=10000, debug=True)
