# Server.py
"""
Flask API for Firecast-X

- Receives lat/lon + weather/FIRMS features from Vercel frontend
- Calls ML models via predictor.py (RF, LR, PyTorch NN)
- Maps every coordinate in California into a 200 ft x 200 ft block
- Maintains one row of state per block in Supabase (PostgreSQL):
    * T       : how many time steps the block has been burning (0–12)
    * T_burn  : fire state
        0 = no fire
        1 = fire burning
        2 = fire burned out
        3 = cannot burn (water, etc.)
    * prob_sum / prob_count : used to compute the BLOCK AVERAGE spread probability

On each /predict call:
    1) Compute a point-level probability with the selected model
    2) Snap (lat, lon) into a 200 ft block over California
    3) Update that block's running average probability
    4) Update T and T_burn based on the BLOCK AVERAGE (not just this sample)
    5) Return the block state + averaged probability to the caller
"""

import os
import math
import json

import psycopg2
from flask import Flask, request, jsonify

from predictor import predict_fire_spread  # uses all 3 models under the hood

app = Flask(__name__)

# -------------------------
# 1) Fire + block constants
# -------------------------

FIRE_THRESHOLD = 0.75   # probability threshold for "fire present"
T_MAX = 12              # after this many steps in state=1, mark as burned out (2)

# Rough bounds for California (not strict, just a reasonable box)
CALIFORNIA_MIN_LAT = 32.0
CALIFORNIA_MAX_LAT = 42.5
CALIFORNIA_MIN_LON = -125.0
CALIFORNIA_MAX_LON = -113.5

# Block size ~200 ft in both directions
BLOCK_SIZE_FT = 200.0
BLOCK_SIZE_M = BLOCK_SIZE_FT * 0.3048  # feet → meters

METERS_PER_DEG_LAT = 111_320.0
CALIFORNIA_MID_LAT = 37.0
METERS_PER_DEG_LON = METERS_PER_DEG_LAT * math.cos(math.radians(CALIFORNIA_MID_LAT))

DEG_LAT_PER_BLOCK = BLOCK_SIZE_M / METERS_PER_DEG_LAT
DEG_LON_PER_BLOCK = BLOCK_SIZE_M / METERS_PER_DEG_LON


def lat_lon_to_block(lat: float, lon: float):
    """
    Convert a lat/lon into a (block_row, block_col, block_id, block_center_lat, block_center_lon)
    using a fixed 200 ft grid over California.

    We don't pre-create all blocks in the DB. We just compute the row/col indices
    and lazily insert/update rows as calls come in.
    """
    # Clamp to the rough California box (so crazy outliers don't break indices)
    clamped_lat = max(min(lat, CALIFORNIA_MAX_LAT), CALIFORNIA_MIN_LAT)
    clamped_lon = max(min(lon, CALIFORNIA_MAX_LON), CALIFORNIA_MIN_LON)

    row = math.floor((clamped_lat - CALIFORNIA_MIN_LAT) / DEG_LAT_PER_BLOCK)
    col = math.floor((clamped_lon - CALIFORNIA_MIN_LON) / DEG_LON_PER_BLOCK)

    center_lat = CALIFORNIA_MIN_LAT + (row + 0.5) * DEG_LAT_PER_BLOCK
    center_lon = CALIFORNIA_MIN_LON + (col + 0.5) * DEG_LON_PER_BLOCK

    block_id = f"CA-{row}-{col}"
    return row, col, block_id, center_lat, center_lon


# -------------------------
# 2) DB connection
# -------------------------

def get_db_conn():
    """
    Prefer DATABASE_URL (for Supabase / Render), fallback to explicit env vars,
    and finally a local dev config.
    """
    url = os.environ.get("DATABASE_URL")
    if url:
        # Supabase typically requires SSL
        return psycopg2.connect(url, sslmode=os.environ.get("DB_SSLMODE", "require"))

    host = os.environ.get("DB_HOST")
    if host:
        return psycopg2.connect(
            host=host,
            port=os.environ.get("DB_PORT", 5432),
            dbname=os.environ.get("DB_NAME", "postgres"),
            user=os.environ.get("DB_USER", "postgres"),
            password=os.environ.get("DB_PASSWORD", ""),
            sslmode=os.environ.get("DB_SSLMODE", "require"),
        )

    # Local dev fallback (matches your earlier config)
    return psycopg2.connect(
        host="localhost",
        port=5433,
        dbname="firecast",
        user="postgres",
        password="SE4485!",
    )


# -------------------------
# 3) Fire state + averaging logic
# -------------------------

def update_fire_block_state(
    cur,
    block_row: int,
    block_col: int,
    block_id: str,
    block_center_lat: float,
    block_center_lon: float,
    new_prob: float,
    can_burn: bool = True,
):
    """
    Given a point-level probability for a coordinate that belongs to this block,
    update the block's:
      - running average probability (prob_sum, prob_count)
      - T and T_burn based on the *new block-average* probability.

    Expected DB schema for fire_cell_state:

        CREATE TABLE IF NOT EXISTS fire_cell_state (
            id BIGSERIAL PRIMARY KEY,
            block_row      INTEGER NOT NULL,
            block_col      INTEGER NOT NULL,
            block_id       TEXT    NOT NULL,
            last_latitude  DOUBLE PRECISION,
            last_longitude DOUBLE PRECISION,
            t              INTEGER NOT NULL,
            t_burn         INTEGER NOT NULL,
            last_prob      DOUBLE PRECISION,
            prob_sum       DOUBLE PRECISION NOT NULL,
            prob_count     BIGINT NOT NULL,
            updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (block_row, block_col)
        );

    Returns (T, T_burn, avg_prob).
    """
    # 1) Load previous state (if any)
    cur.execute(
        """
        SELECT t, t_burn, prob_sum, prob_count
        FROM fire_cell_state
        WHERE block_row = %s AND block_col = %s;
        """,
        (block_row, block_col),
    )
    row = cur.fetchone()

    if row:
        prev_t, prev_state, prev_sum, prev_count = row
    else:
        prev_t, prev_state, prev_sum, prev_count = 0, 0, 0.0, 0

    # 2) If this block cannot burn, force state = 3
    if not can_burn:
        new_t = 0
        new_state = 3
        new_sum = prev_sum  # ignore this sample for avg
        new_count = prev_count
        avg_prob = (new_sum / new_count) if new_count > 0 else 0.0
    else:
        # Update running average with this new sample
        new_sum = float(prev_sum) + float(new_prob)
        new_count = prev_count + 1
        avg_prob = new_sum / new_count if new_count > 0 else 0.0

        # 3) State machine based on BLOCK-AVERAGE probability
        prev_state = int(prev_state)
        prev_t = int(prev_t)

        if prev_state == 3:
            # Cannot ever burn (water, etc.) – keep it locked
            new_state = 3
            new_t = 0
        elif prev_state == 0:
            # No fire yet
            if avg_prob >= FIRE_THRESHOLD:
                new_state = 1
                new_t = 1
            else:
                new_state = 0
                new_t = 0
        elif prev_state == 1:
            # Currently burning
            if avg_prob >= FIRE_THRESHOLD:
                if prev_t < T_MAX:
                    new_state = 1
                    new_t = prev_t + 1
                else:
                    # reached max burn time, mark as burned out
                    new_state = 2
                    new_t = T_MAX
            else:
                # dropped below threshold early → reset to "no fire"
                new_state = 0
                new_t = 0
        else:
            # prev_state == 2 (burned out) or any other value → stay burned out
            new_state = 2
            new_t = prev_t

    # --- Ensure block_index row exists ---
    cur.execute(
        """
        INSERT INTO block_index (
            block_id, block_row, block_col,
            center_lat, center_lon,
            min_lat, max_lat, min_lon, max_lon
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (block_id) DO NOTHING;
        """,
        (
            block_id,
            block_row,
            block_col,
            block_center_lat,
            block_center_lon,
            block_center_lat - (DEG_LAT_PER_BLOCK / 2),
            block_center_lat + (DEG_LAT_PER_BLOCK / 2),
            block_center_lon - (DEG_LON_PER_BLOCK / 2),
            block_center_lon + (DEG_LON_PER_BLOCK / 2),
        ),
    )

    # 4) Upsert the new state back into DB
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
            updated_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (block_row, block_col)
        DO UPDATE SET
            block_id       = EXCLUDED.block_id,
            last_latitude  = EXCLUDED.last_latitude,
            last_longitude = EXCLUDED.last_longitude,
            t              = EXCLUDED.t,
            t_burn         = EXCLUDED.t_burn,
            last_prob      = EXCLUDED.last_prob,
            prob_sum       = EXCLUDED.prob_sum,
            prob_count     = EXCLUDED.prob_count,
            updated_at     = NOW();
        """,
        (
            block_row,
            block_col,
            block_id,
            block_center_lat,
            block_center_lon,
            new_t,
            new_state,
            float(new_prob),
            float(new_sum),
            int(new_count),
        ),
    )

    return int(new_t), int(new_state), float(avg_prob)


def log_prediction_to_db(cur, model_name: str, request_data: dict, prob: float):
    """
    Log raw prediction request + single-sample probability into firecast_predictions.

    Expected DB schema:

        CREATE TABLE IF NOT EXISTS firecast_predictions (
            id BIGSERIAL PRIMARY KEY,
            model_name        TEXT    NOT NULL,
            input_json        JSONB   NOT NULL,
            prediction_value  DOUBLE PRECISION,
            created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    """
    cur.execute(
        """
        INSERT INTO firecast_predictions (model_name, input_json, prediction_value)
        VALUES (%s, %s, %s);
        """,
        (model_name, json.dumps(request_data), float(prob)),
    )


# -------------------------
# 4) Health endpoints
# -------------------------

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


@app.route("/db-test", methods=["GET"])
def db_test():
    try:
        conn = get_db_conn()
        with conn:
            with conn.cursor() as cur:
                cur.execute("SELECT NOW();")
                (ts,) = cur.fetchone()
        return jsonify({"status": "connected", "server_time": ts.isoformat()})
    except Exception as e:
        return jsonify({"status": "error", "detail": str(e)}), 500


# -------------------------
# 5) Prediction endpoint
# -------------------------

@app.route("/predict", methods=["POST"])
def predict():
    """
    Main prediction route.
    """
    try:
        if not request.data:
            return jsonify({"error": "no JSON body"}), 400

        payload = request.get_json(silent=True)
        if payload is None:
            return jsonify({"error": "invalid JSON"}), 400

        # Model choice (optional)
        model_name = payload.get("model", "random_forest")

        # Required coords
        try:
            lat = float(payload["latitude"])
            lon = float(payload["longitude"])
        except KeyError as e:
            return jsonify({"error": f"missing field: {e}"}), 400
        except (TypeError, ValueError):
            return jsonify({"error": "latitude/longitude must be numeric"}), 400

        can_burn = bool(payload.get("can_burn", True))

        # predictor.py should receive ONLY the feature dict, not "model"
        feature_input = {k: v for k, v in payload.items() if k != "model"}

        # 1) Single-sample prediction from ML model  <<< CHANGED BLOCK
        try:
            model_result = predict_fire_spread(feature_input, model_name=model_name)
        except Exception as e:
            # This is what’s causing your 500 right now – surfacing it makes it debuggable
            return jsonify({
                "error": "model_error",
                "detail": str(e),
                "model": model_name,
            }), 500

        instant_prob = float(model_result.get("spread_probability", 0.0))

        # 2) Map to 200 ft block
        block_row, block_col, block_id, block_center_lat, block_center_lon = lat_lon_to_block(
            lat, lon
        )

        # 3) Update DB: block state + prediction log
        db_error = None
        T = 0
        T_burn = 0
        avg_prob = instant_prob

        try:
            conn = get_db_conn()
            with conn:
                with conn.cursor() as cur:
                    # update block state (uses averaged probability)
                    T, T_burn, avg_prob = update_fire_block_state(
                        cur,
                        block_row,
                        block_col,
                        block_id,
                        block_center_lat,
                        block_center_lon,
                        instant_prob,
                        can_burn=can_burn,
                    )
                    # log raw prediction
                    log_prediction_to_db(cur, model_name, payload, instant_prob)
        except Exception as e:
            db_error = str(e)

        # 4) Build response back to caller
        response = {
            "model": model_name,
            "block_id": block_id,
            "block_row": block_row,
            "block_col": block_col,
            "block_center_latitude": block_center_lat,
            "block_center_longitude": block_center_lon,
            "T": T,
            "T_burn": T_burn,
            "instant_spread_probability": instant_prob,
            "block_avg_spread_probability": avg_prob,
            "prediction": "Spread" if avg_prob >= FIRE_THRESHOLD else "No Spread",
        }

        if db_error:
            response["db_log_error"] = db_error

        return jsonify(response)

    except Exception as e:
        return jsonify(
            {
                "error": "unexpected error in /predict",
                "detail": str(e),
            }
        ), 500


# -------------------------
# 6) Convenience route for just NN
# -------------------------

@app.route("/predict-nn", methods=["POST"])
def predict_nn():
    """
    Shortcut: same as /predict but forces model = "pytorch_nn".
    """
    try:
        if not request.data:
            return jsonify({"error": "no JSON body"}), 400

        payload = request.get_json(silent=True)
        if payload is None:
            return jsonify({"error": "invalid JSON"}), 400

        payload["model"] = "pytorch_nn"
        # Reuse /predict logic by calling the function directly
        with app.test_request_context(
            "/predict",
            method="POST",
            json=payload,
        ):
            return predict()

    except Exception as e:
        return jsonify(
            {
                "error": "unexpected error in /predict-nn",
                "detail": str(e),
            }
        ), 500


# -------------------------
# 7) Main
# -------------------------

if __name__ == "__main__":
    # Render injects PORT; default to 5000 for local dev
    port = int(os.environ.get("PORT", 5000))
    # IMPORTANT: debug must be False on Render so the reloader doesn't run
    app.run(host="0.0.0.0", port=port, debug=False)
