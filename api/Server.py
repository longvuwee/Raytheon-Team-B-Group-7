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

# ---------------------------------------------------------------------
# Feature list (ONLY these go into the model)
# ---------------------------------------------------------------------
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

# ---------------------------------------------------------------------
# DB config
# ---------------------------------------------------------------------
DB_CONFIG = {
    "host": os.environ.get("DB_HOST"),
    "dbname": os.environ.get("DB_NAME", "postgres"),
    "user": os.environ.get("DB_USER", "postgres"),
    "password": os.environ.get("DB_PASSWORD"),
    "port": os.environ.get("DB_PORT", 5432),
}


def get_db_conn():
    return psycopg2.connect(**DB_CONFIG)


# ---------------------------------------------------------------------
# Grid snapping (~200 ft)
# ---------------------------------------------------------------------
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
    origin_lat = 25.0
    origin_lon = -125.0

    cell_lat = DEG_LAT_200FT
    cell_lon = DEG_LON_200FT_AT_EQ * max(math.cos(math.radians(lat)), 0.1)

    row = int((lat - origin_lat) / cell_lat)
    col = int((lon - origin_lon) / cell_lon)

    center_lat = origin_lat + (row + 0.5) * cell_lat
    center_lon = origin_lon + (col + 0.5) * cell_lon

    block_id = f"CA-{row}-{col}"
    return Block(
        block_id=block_id,
        row=row,
        col=col,
        center_lat=center_lat,
        center_lon=center_lon,
    )


# ---------------------------------------------------------------------
# Timeline logic
# ---------------------------------------------------------------------
SPREAD_THRESHOLD = 0.75
T_MAX = 12


def update_timeline(old_T: int, old_T_burn: int, prob: float, can_burn: bool) -> Tuple[int, int]:
    # 3 = cannot burn (water, etc.)
    if not can_burn:
        return 0, 3

    # once burned out or cannot burn, keep state
    if old_T_burn in (2, 3):
        return old_T, old_T_burn

    # high probability case
    if prob >= SPREAD_THRESHOLD:
        if old_T_burn == 0:          # newly igniting
            return 0, 1
        if old_T_burn == 1:          # continuing burn
            new_T = min(old_T + 1, T_MAX)
            if new_T >= T_MAX:
                return new_T, 2      # burned out
            return new_T, 1
        # default: ignite
        return 0, 1
    else:
        # low probability: if it was burning, it goes back to no fire
        if old_T_burn == 1:
            return 0, 0
        return old_T, old_T_burn


# ---------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------
@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


# ---------------------------------------------------------------------
# Predict route
# ---------------------------------------------------------------------
@app.route("/predict", methods=["POST"])
def predict():
    try:
        data = request.get_json(force=True) or {}

        # model name (default RF)
        model_name = (data.get("model") or "random_forest").lower()
        can_burn = bool(data.get("can_burn", True))

        # === build features dict with ONLY the physical features ===
        features: Dict[str, Any] = {}
        for key in FEATURE_KEYS:
            if key not in data:
                return jsonify(
                    {
                        "error": f"Missing required feature '{key}'",
                        "received_keys": list(data.keys()),
                    }
                ), 400
            features[key] = data[key]

        # sanity check lat/lon present
        if "latitude" not in features or "longitude" not in features:
            return jsonify({"error": "latitude and longitude are required"}), 400

        # === call the model (only 15 features go in) ===
        pred = predict_fire_spread(features, model_name=model_name)
        inst_prob = float(pred["spread_probability"])

        # === compute block from lat/lon ===
        lat = float(features["latitude"])
        lon = float(features["longitude"])
        block = snap_to_grid(lat, lon)

        # defaults
        old_T = 0
        old_T_burn = 0
        block_avg_prob = inst_prob

        conn = None
        try:
            conn = get_db_conn()
            conn.autocommit = False
            cur = conn.cursor()

            # pull existing block row, if any
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

            # update timeline
            new_T, new_T_burn = update_timeline(old_T, old_T_burn, inst_prob, can_burn)
            block_avg_prob = inst_prob  # for now just equal to instant prob

            # upsert into block_index
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

            # log each call in fire_cell_state
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
        except Exception as db_e:
            if conn:
                try:
                    conn.rollback()
                except Exception:
                    pass

            # still return useful info even if DB fails
            return jsonify({
                "error": f"Database error: {type(db_e).__name__}: {db_e}",
                "model": pred.get("model", model_name),
                "instant_spread_probability": inst_prob,
                "prediction": "Spread" if inst_prob >= SPREAD_THRESHOLD else "No Spread",
                "T": 0,
                "T_burn": 0,
                "block_id": block.block_id,
                "block_row": block.row,
                "block_col": block.col,
                "block_center_latitude": block.center_lat,
                "block_center_longitude": block.center_lon,
                "block_avg_spread_probability": inst_prob,
            }), 500
        finally:
            if conn is not None:
                conn.close()

        # === normal successful response ===
        return jsonify({
            "model": pred.get("model", model_name),
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
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Server error: {type(e).__name__}: {e}"}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=10000, debug=True)
