# api/Server.py

import os
import json
from datetime import datetime
import math
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
# -------------------------
# Constants mapping
# -------------------------
BLOCK_FEET = 200.0
FEET_PER_DEG_LAT = 364000.0
BLOCK_DEG_LAT = BLOCK_FEET / FEET_PER_DEG_LAT  # ~0.00055

# choose a representative latitude for your area (e.g., 37 for California-ish)
REF_LAT_DEG = 37.0
BLOCK_DEG_LON = BLOCK_FEET / (FEET_PER_DEG_LAT * math.cos(math.radians(REF_LAT_DEG)))

def snap_to_block(latitude: float, longitude: float):
    """
    Snap raw (lat, lon) to a normalized block center of ~200 ft by 200 ft.
    All coordinates that fall in the same block produce the same snapped pair.
    """
    row = math.floor(latitude / BLOCK_DEG_LAT)
    col = math.floor(longitude / BLOCK_DEG_LON)

    block_lat = (row + 0.5) * BLOCK_DEG_LAT
    block_lon = (col + 0.5) * BLOCK_DEG_LON

    return block_lat, block_lon

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
        # Optional: also attach status into result for debugging
        result["db_log_error"] = str(e)

# -------------------------
# Helper: update T and T_burn per cell
# -------------------------
def update_fire_state_for_cell_blocked(latitude: float,
                                       longitude: float,
                                       prob: float,
                                       can_burn: bool = True):
    """
    Same logic as before, but:
      - Snaps (latitude, longitude) into a ~200ft block center.
      - Stores T/T_burn and probabilities per block.
    """
    # 1) Snap to 200ft block
    block_lat, block_lon = snap_to_block(latitude, longitude)

    conn = get_db_conn()
    cur = conn.cursor()

    # 2) Get previous state for this block, if any
    cur.execute(
        """
        SELECT t, t_burn, prob_sum, prob_count
        FROM fire_cell_state
        WHERE latitude = %s AND longitude = %s;
        """,
        (block_lat, block_lon),
    )
    row = cur.fetchone()
    if row:
        prev_t, prev_state, prev_sum, prev_count = row
    else:
        prev_t, prev_state, prev_sum, prev_count = 0, 0, 0.0, 0

    # 3) Fire logic (same as before)
    if not can_burn:
        new_t = 0
        new_state = 3  # cannot burn
    else:
        if prob >= FIRE_THRESHOLD:
            # There is a fire according to threshold
            if prev_state in (0, 2):  # starting a new fire
                new_t = 0
                new_state = 1
            elif prev_state == 1:
                new_t = min(prev_t + 1, T_MAX)
                new_state = 1
            elif prev_state == 3:
                # cannot burn, ignore probability
                new_t = prev_t
                new_state = 3
            else:
                new_t = 0
                new_state = 1
        else:
            # prob below threshold -> no active fire now
            if prev_state == 1:
                # was burning, now stopped -> burned out
                new_t = prev_t
                new_state = 2
            elif prev_state in (2, 3):
                # stay burned out or non-burnable
                new_t = prev_t
                new_state = prev_state
            else:
                new_t = 0
                new_state = 0

    # 4) Update running sum / count for averaging
    new_sum = prev_sum + prob
    new_count = prev_count + 1

    # 5) Upsert new state for this block
    cur.execute(
        """
        INSERT INTO fire_cell_state (latitude, longitude, t, t_burn, last_prob, prob_sum, prob_count, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (latitude, longitude)
        DO UPDATE SET
            t          = EXCLUDED.t,
            t_burn     = EXCLUDED.t_burn,
            last_prob  = EXCLUDED.last_prob,
            prob_sum   = fire_cell_state.prob_sum + EXCLUDED.prob_sum,
            prob_count = fire_cell_state.prob_count + EXCLUDED.prob_count,
            updated_at = NOW();
        """,
        (block_lat, block_lon, new_t, new_state, prob, prob, 1),
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

        # Run the model
        result = predict_fire_spread(data, model_name=model_name)
        prob = float(result.get("spread_probability", 0.0))

        # Compute / update T and T_burn for this cell
        latitude = float(data["latitude"])
        longitude = float(data["longitude"])
        # For now we assume can_burn=True; later you can add a mask to set False for water bodies
        T, T_burn = update_fire_state_for_cell_blocked(latitude, longitude, prob, can_burn=True)

        # Attach T and T_burn to API response
        result["T"] = T
        result["T_burn"] = T_burn

        # Log full prediction request & probability
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

        latitude = float(data["latitude"])
        longitude = float(data["longitude"])
        T, T_burn = update_fire_state_for_cell_blocked(latitude, longitude, prob, can_burn=True)

        result["T"] = T
        result["T_burn"] = T_burn

        log_prediction_to_db(model_name, data, result)

        return jsonify(result)

    except Exception as e:
        return jsonify({
            "error": "unexpected error in /predict-nn",
            "detail": str(e),
        }), 500
# -------------------------
# Convenience: predict horizon
# -------------------------    
@app.route("/predict-horizon", methods=["POST"])
def predict_horizon():
    """
    Simulate T, T+1, T+2, ... by reusing the same features.
    Body example:
    {
      "model": "random_forest",
      "horizon": 5,
      "latitude": 40,
      "longitude": -120,
      "brightness": 310,
      "bright_t31": 290,
      "confidence": 80,
      "daynight": 1,
      "elevation": 200,
      "slope": 5,
      "aspect": 0,
      "temp": 30,
      "humidity": 40,
      "wind_speed": 6,
      "precip": 0,
      "month": 8
    }
    """
    try:
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({"error": "Invalid or missing JSON body"}), 400

        model_name = data.get("model", "random_forest")
        allowed = ["random_forest", "logistic_regression", "pytorch_nn"]
        if model_name not in allowed:
            return jsonify({"error": "Invalid model", "allowed": allowed}), 400

        try:
            latitude = float(data["latitude"])
            longitude = float(data["longitude"])
        except (KeyError, ValueError):
            return jsonify({"error": "latitude and longitude are required and must be numeric"}), 400

        horizon = int(data.get("horizon", 5))  # default 5 steps if not given
        if horizon <= 0:
            return jsonify({"error": "horizon must be > 0"}), 400

        # Base feature set: everything except model & horizon
        base_features = {k: v for k, v in data.items() if k not in ("model", "horizon")}

        trajectory = []

        for step_index in range(horizon):
            # Build the input for this step (reuse same features)
            step_data = dict(base_features)
            step_data["model"] = model_name

            # 1) Run model
            result = predict_fire_spread(step_data, model_name=model_name)
            prob = float(result.get("spread_probability", 0.0))

            # 2) Update T / T_burn for this **block** (we'll hook blocks in next section)
            T, T_burn = update_fire_state_for_cell_blocked(latitude, longitude, prob)

            # 3) Log prediction if you want
            log_prediction_to_db(model_name, step_data, result)

            # 4) Append step info
            trajectory.append({
                "step_index": step_index,   # 0 = T, 1 = T+1, ...
                "spread_probability": prob,
                "prediction": result.get("prediction"),
                "T": T,
                "T_burn": T_burn
            })

        return jsonify({
            "latitude": latitude,
            "longitude": longitude,
            "model": model_name,
            "horizon": horizon,
            "trajectory": trajectory
        })

    except Exception as e:
        return jsonify({
            "error": "unexpected error in /predict-horizon",
            "detail": str(e),
        }), 500

    try:
        payload = request.get_json(silent=True)
        if payload is None:
            return jsonify({"error": "Invalid or missing JSON body"}), 400

        model_name = payload.get("model", "random_forest")
        allowed = ["random_forest", "logistic_regression", "pytorch_nn"]
        if model_name not in allowed:
            return jsonify({"error": "Invalid model", "allowed": allowed}), 400

        try:
            latitude = float(payload["latitude"])
            longitude = float(payload["longitude"])
        except (KeyError, ValueError):
            return jsonify({"error": "latitude and longitude are required and must be numeric"}), 400

        steps = payload.get("steps")
        if not isinstance(steps, list) or len(steps) == 0:
            return jsonify({"error": "steps must be a non-empty list of feature dicts"}), 400

        results = []

        # We will update T/T_burn in DB for this cell as we step forward
        for step_index, step_features in enumerate(steps):
            # Build the data dict expected by predictor.py
            data = dict(step_features)
            data["latitude"] = latitude
            data["longitude"] = longitude
            data["model"] = model_name

            # 1. Run model for this step
            result = predict_fire_spread(data, model_name=model_name)
            prob = float(result.get("spread_probability", 0.0))

            # 2. Update T and T_burn for this cell based on prob
            T, T_burn = update_fire_state_for_cell(
                latitude,
                longitude,
                prob,
                can_burn=True  # later you can set this False for water cells
            )

            # 3. Optionally log to firecast_predictions as well
            log_prediction_to_db(model_name, data, result)

            # 4. Collect per-step output
            results.append({
                "step_index": step_index,   # 0 = T, 1 = T+1, ...
                "spread_probability": prob,
                "prediction": result.get("prediction"),
                "T": T,
                "T_burn": T_burn
            })

        return jsonify({
            "latitude": latitude,
            "longitude": longitude,
            "model": model_name,
            "trajectory": results
        })

    except Exception as e:
        return jsonify({
            "error": "unexpected error in /predict-horizon",
            "detail": str(e),
        }), 500
# -------------------------
# Entry point
# -------------------------
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
