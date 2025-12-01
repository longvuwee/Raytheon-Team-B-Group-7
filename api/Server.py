# Server.py

import os
import json
import math
from datetime import datetime

from flask import Flask, request, jsonify
from flask_cors import CORS
import psycopg2

from predictor import predict_fire_spread  # uses RF, LR, PyTorch NN

app = Flask(__name__)
CORS(app)

# -------------------------
# Constants
# -------------------------

FIRE_THRESHOLD = 0.75  # 75% probability to consider it "fire"
T_MAX = 12             # T goes from 0 to 12

# Grid settings (~200 ft blocks)
# Approximate: 200 ft ≈ 61 meters
# 1 degree latitude ≈ 111_320 m → ~0.000548 deg
GRID_LAT_MIN = 32.0      # rough min lat for region
GRID_LON_MIN = -125.0    # rough min lon for region
CELL_SIZE_METERS = 61.0
DEG_PER_M_LAT = 1.0 / 111320.0
CELL_SIZE_DEG_LAT = CELL_SIZE_METERS * DEG_PER_M_LAT

# For longitude, adjust by a mid-latitude cosine
MID_LAT_DEG = 37.0
MID_LAT_RAD = math.radians(MID_LAT_DEG)
DEG_PER_M_LON = 1.0 / (111320.0 * math.cos(MID_LAT_RAD))
CELL_SIZE_DEG_LON = CELL_SIZE_METERS * DEG_PER_M_LON

GRID_REGION_CODE = "CA"  # used in block_id like "CA-row-col"

# -------------------------
# Database connection (Supabase / Postgres)
# -------------------------

def get_db_conn():
    return psycopg2.connect(
        host=os.environ["DB_HOST"],
        port=os.environ.get("DB_PORT", "5432"),
        dbname=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        sslmode="require"
    )

# -------------------------
# Grid helper
# -------------------------

def snap_to_block(latitude: float, longitude: float):
    """
    Snap (lat, lon) into a ~200 ft × 200 ft grid cell.

    Returns:
      block_row, block_col, center_lat, center_lon, block_id
    """
    # Row index from latitude
    row = int(math.floor((latitude - GRID_LAT_MIN) / CELL_SIZE_DEG_LAT))
    # Column index from longitude
    col = int(math.floor((longitude - GRID_LON_MIN) / CELL_SIZE_DEG_LON))

    center_lat = GRID_LAT_MIN + (row + 0.5) * CELL_SIZE_DEG_LAT
    center_lon = GRID_LON_MIN + (col + 0.5) * CELL_SIZE_DEG_LON

    block_id = f"{GRID_REGION_CODE}-{row}-{col}"

    return row, col, center_lat, center_lon, block_id

# -------------------------
# Health check
# -------------------------

@app.route("/", methods=["GET"])
def home():
    return jsonify({
        "status": "Firecast API running",
        "endpoints": ["/predict", "/predict-nn", "/db-test"]
    })

# -------------------------
# DB connectivity test
# -------------------------

@app.route("/db-test", methods=["GET"])
def db_test():
    try:
        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("SELECT NOW();")
        (now_value,) = cur.fetchone()
        cur.close()
        conn.close()
        return jsonify({"status": "connected", "now": now_value.isoformat()})
    except Exception as e:
        return jsonify({"status": "error", "detail": str(e)}), 500

# -------------------------
# Helper: log prediction to DB (existing table)
# -------------------------

def log_prediction_to_db(model_name: str, request_data: dict, result: dict):
    """
    Insert a row into firecast_predictions:

      CREATE TABLE firecast_predictions (
          id SERIAL PRIMARY KEY,
          model_name TEXT NOT NULL,
          input_json JSONB NOT NULL,
          prediction_value DOUBLE PRECISION,
          created_at TIMESTAMPTZ DEFAULT NOW()
      );
    """
    try:
        conn = get_db_conn()
        cur = conn.cursor()

        prediction_value = result.get("spread_probability")

        insert_sql = """
            INSERT INTO firecast_predictions (model_name, input_json, prediction_value)
            VALUES (%s, %s, %s);
        """
        cur.execute(
            insert_sql,
            (
                model_name,
                json.dumps(request_data),
                prediction_value,
            ),
        )

        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        # Don't crash the API if logging fails; just print error on server
        print("DB insert error:", e)
        result["db_log_error"] = str(e)

# -------------------------
# Helper: update block_index (per-block average prob)
# -------------------------

def update_block_index(block_row: int,
                       block_col: int,
                       block_id: str,
                       prob: float) -> float:
    """
    Maintain a running average probability per block.

    Table:

      CREATE TABLE IF NOT EXISTS block_index (
          block_row    INTEGER NOT NULL,
          block_col    INTEGER NOT NULL,
          block_id     TEXT    NOT NULL,
          sample_count INTEGER NOT NULL DEFAULT 0,
          avg_prob     DOUBLE PRECISION NOT NULL DEFAULT 0,
          updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (block_row, block_col)
      );
    """
    conn = get_db_conn()
    cur = conn.cursor()

    # Get previous stats
    cur.execute(
        """
        SELECT sample_count, avg_prob
        FROM block_index
        WHERE block_row = %s AND block_col = %s;
        """,
        (block_row, block_col),
    )
    row = cur.fetchone()

    if row:
        prev_count, prev_avg = row
        new_count = prev_count + 1
        new_avg = (prev_avg * prev_count + prob) / float(new_count)
    else:
        new_count = 1
        new_avg = prob

    # Upsert
    cur.execute(
        """
        INSERT INTO block_index (block_row, block_col, block_id, sample_count, avg_prob, updated_at)
        VALUES (%s, %s, %s, %s, %s, NOW())
        ON CONFLICT (block_row, block_col)
        DO UPDATE SET
            block_id     = EXCLUDED.block_id,
            sample_count = EXCLUDED.sample_count,
            avg_prob     = EXCLUDED.avg_prob,
            updated_at   = NOW();
        """,
        (block_row, block_col, block_id, new_count, new_avg),
    )

    conn.commit()
    cur.close()
    conn.close()

    return float(new_avg)

# -------------------------
# Helper: update T and T_burn per block
# -------------------------

def update_fire_state_for_block(block_row: int,
                                block_col: int,
                                block_id: str,
                                instant_prob: float,
                                block_avg_prob: float,
                                can_burn: bool = True):
    """
    Maintain fire_cell_state per grid block with T and T_burn.

    States:
      0 = no fire at this block
      1 = currently burning
      2 = burned out (was burning, now stopped)
      3 = cannot burn (water, etc.)

    Rules:
      - If can_burn is False → state 3, T = 0 always.
      - If instant_prob >= FIRE_THRESHOLD:
            if previous state in (0, 2) → new fire: T=0, state=1
            if previous state == 1 → T = min(prev_T + 1, T_MAX)
            if previous state == 3 → stay 3, T unchanged
      - If instant_prob < FIRE_THRESHOLD:
            if previous state == 1 → state=2 (burned out), T stays same
            if previous state in (0, 2, 3) → keep T, keep state

    Table:

      CREATE TABLE IF NOT EXISTS fire_cell_state (
          block_row        INTEGER NOT NULL,
          block_col        INTEGER NOT NULL,
          block_id         TEXT    NOT NULL,
          t                SMALLINT NOT NULL DEFAULT 0 CHECK (t BETWEEN 0 AND 12),
          t_burn           SMALLINT NOT NULL DEFAULT 0 CHECK (t_burn BETWEEN 0 AND 3),
          instant_prob     DOUBLE PRECISION,
          block_avg_prob   DOUBLE PRECISION,
          updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (block_row, block_col)
      );
    """
    conn = get_db_conn()
    cur = conn.cursor()

    # 1. Fetch previous state
    cur.execute(
        """
        SELECT t, t_burn
        FROM fire_cell_state
        WHERE block_row = %s AND block_col = %s;
        """,
        (block_row, block_col),
    )
    row = cur.fetchone()
    if row:
        prev_t, prev_state = row
    else:
        prev_t, prev_state = 0, 0

    # 2. Apply rules
    if not can_burn:
        new_t = 0
        new_state = 3
    else:
        if instant_prob >= FIRE_THRESHOLD:
            if prev_state in (0, 2):
                new_t = 0
                new_state = 1
            elif prev_state == 1:
                new_t = min(prev_t + 1, T_MAX)
                new_state = 1
            elif prev_state == 3:
                new_t = prev_t
                new_state = 3
            else:
                new_t = 0
                new_state = 1
        else:
            if prev_state == 1:
                new_t = prev_t
                new_state = 2
            elif prev_state in (2, 3):
                new_t = prev_t
                new_state = prev_state
            else:
                new_t = 0
                new_state = 0

    # 3. Upsert
    cur.execute(
        """
        INSERT INTO fire_cell_state (
            block_row, block_col, block_id,
            t, t_burn,
            instant_prob, block_avg_prob,
            updated_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (block_row, block_col)
        DO UPDATE SET
            block_id       = EXCLUDED.block_id,
            t              = EXCLUDED.t,
            t_burn         = EXCLUDED.t_burn,
            instant_prob   = EXCLUDED.instant_prob,
            block_avg_prob = EXCLUDED.block_avg_prob,
            updated_at     = NOW();
        """,
        (block_row, block_col, block_id,
         new_t, new_state,
         instant_prob, block_avg_prob),
    )

    conn.commit()
    cur.close()
    conn.close()

    return new_t, new_state

# -------------------------
# Main predict endpoint
# -------------------------

@app.route("/predict", methods=["POST"])
def predict_general():
    try:
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({"error": "Invalid or missing JSON body"}), 400

        # Which model? default: random_forest
        model_name = data.get("model", "random_forest")
        allowed = ["random_forest", "logistic_regression", "pytorch_nn"]

        if model_name not in allowed:
            return jsonify({
                "error": "Invalid model",
                "allowed": allowed
            }), 400

        # Run model (your original predictor)
        result = predict_fire_spread(data, model_name=model_name)
        prob = float(result.get("spread_probability", 0.0))

        # Snap to grid block
        latitude = float(data["latitude"])
        longitude = float(data["longitude"])
        block_row, block_col, center_lat, center_lon, block_id = snap_to_block(
            latitude, longitude
        )

        # Whether this block can burn (optional key; default True)
        can_burn = bool(data.get("can_burn", True))

        # Update average probability per block
        block_avg_prob = update_block_index(
            block_row=block_row,
            block_col=block_col,
            block_id=block_id,
            prob=prob
        )

        # Update timeline state (T, T_burn) for this block
        T, T_burn = update_fire_state_for_block(
            block_row=block_row,
            block_col=block_col,
            block_id=block_id,
            instant_prob=prob,
            block_avg_prob=block_avg_prob,
            can_burn=can_burn
        )

        # Attach grid + timeline info to API response
        result["instant_spread_probability"] = prob
        result["block_avg_spread_probability"] = block_avg_prob
        result["T"] = T
        result["T_burn"] = T_burn

        result["block_row"] = block_row
        result["block_col"] = block_col
        result["block_id"] = block_id
        result["block_center_latitude"] = center_lat
        result["block_center_longitude"] = center_lon

        # Log prediction
        log_prediction_to_db(model_name, data, result)

        return jsonify(result)

    except Exception as e:
        return jsonify({
            "error": "unexpected error in /predict",
            "detail": str(e),
        }), 500

# -------------------------
# Convenience: neural network only
# -------------------------

@app.route("/predict-nn", methods=["POST"])
def predict_nn():
    try:
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({"error": "Invalid or missing JSON body"}), 400

        model_name = "pytorch_nn"
        result = predict_fire_spread(data, model_name=model_name)
        prob = float(result.get("spread_probability", 0.0))

        # Snap to same grid as /predict
        latitude = float(data["latitude"])
        longitude = float(data["longitude"])
        block_row, block_col, center_lat, center_lon, block_id = snap_to_block(
            latitude, longitude
        )

        can_burn = bool(data.get("can_burn", True))

        block_avg_prob = update_block_index(
            block_row=block_row,
            block_col=block_col,
            block_id=block_id,
            prob=prob
        )

        T, T_burn = update_fire_state_for_block(
            block_row=block_row,
            block_col=block_col,
            block_id=block_id,
            instant_prob=prob,
            block_avg_prob=block_avg_prob,
            can_burn=can_burn
        )

        result["instant_spread_probability"] = prob
        result["block_avg_spread_probability"] = block_avg_prob
        result["T"] = T
        result["T_burn"] = T_burn

        result["block_row"] = block_row
        result["block_col"] = block_col
        result["block_id"] = block_id
        result["block_center_latitude"] = center_lat
        result["block_center_longitude"] = center_lon

        log_prediction_to_db(model_name, data, result)

        return jsonify(result)

    except Exception as e:
        return jsonify({
            "error": "unexpected error in /predict-nn",
            "detail": str(e),
        }), 500

# -------------------------
# Entry point
# -------------------------

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
