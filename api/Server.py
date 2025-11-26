# api/Server.py

import os
import json
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
def update_fire_state_for_cell(latitude: float,
                               longitude: float,
                               prob: float,
                               can_burn: bool = True):
    """
    Maintain the fire_cell_state table with T and T_burn, using rules:

      - FIRE_THRESHOLD = 0.75
      - T starts at 0 the first time prob >= 0.75 for that cell.
      - While prob >= 0.75 and state is 'burning' (1), T increments until T_MAX.
      - If prob drops below 0.75 after being burning, state becomes 'burned out' (2)
        and T stays at its last value.
      - State 0: no fire yet.
      - State 1: currently burning.
      - State 2: burned out (was burning, now not).
      - State 3: cannot burn (water etc.), T is always 0.

    Table (run once in Supabase):

      CREATE TABLE IF NOT EXISTS fire_cell_state (
          latitude    DOUBLE PRECISION NOT NULL,
          longitude   DOUBLE PRECISION NOT NULL,
          t           SMALLINT NOT NULL DEFAULT 0 CHECK (t BETWEEN 0 AND 12),
          t_burn      SMALLINT NOT NULL DEFAULT 0 CHECK (t_burn BETWEEN 0 AND 3),
          last_prob   DOUBLE PRECISION,
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (latitude, longitude)
      );
    """
    conn = get_db_conn()
    cur = conn.cursor()

    # 1. Get previous state if it exists
    cur.execute(
        """
        SELECT t, t_burn
        FROM fire_cell_state
        WHERE latitude = %s AND longitude = %s;
        """,
        (latitude, longitude),
    )
    row = cur.fetchone()
    if row:
        prev_t, prev_state = row
    else:
        prev_t, prev_state = 0, 0  # default: no fire

    # 2. Apply rules
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

    # 3. Upsert new state
    cur.execute(
        """
        INSERT INTO fire_cell_state (latitude, longitude, t, t_burn, last_prob, updated_at)
        VALUES (%s, %s, %s, %s, %s, NOW())
        ON CONFLICT (latitude, longitude)
        DO UPDATE SET
            t         = EXCLUDED.t,
            t_burn    = EXCLUDED.t_burn,
            last_prob = EXCLUDED.last_prob,
            updated_at = NOW();
        """,
        (latitude, longitude, new_t, new_state, prob),
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
        T, T_burn = update_fire_state_for_cell(latitude, longitude, prob, can_burn=True)

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
        T, T_burn = update_fire_state_for_cell(latitude, longitude, prob, can_burn=True)

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
