# api/Server.py

import os
import json
from datetime import datetime

from flask import Flask, request, jsonify
from flask_cors import CORS
import psycopg2

from predictor import predict_fire_spread  # uses RF, LR, PyTorch NN

# -------------------------
# Flask app setup
# -------------------------
app = Flask(__name__)
CORS(app)

# -------------------------
# Database connection (Supabase / Postgres)
# -------------------------
def get_db_conn():
    """
    Connect to Postgres using environment variables.
    Expected env vars (set in Render):
      DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
    """
    return psycopg2.connect(
        host=os.environ["DB_HOST"],
        port=os.environ.get("DB_PORT", "5432"),
        dbname=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
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
        # Simple test query; you can change this to count from your dataset table
        cur.execute("SELECT NOW();")
        (now_value,) = cur.fetchone()
        cur.close()
        conn.close()
        return jsonify({"status": "connected", "now": now_value.isoformat()})
    except Exception as e:
        return jsonify({"status": "error", "detail": str(e)}), 500

# -------------------------
# Helper: log prediction to DB
# -------------------------
def log_prediction_to_db(model_name: str, request_data: dict, result: dict):
    """
    Insert a row into firecast_predictions.

    Table (run in Supabase):
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

        # Run the model (predictor.py handles feature order & scaling)
        result = predict_fire_spread(data, model_name=model_name)

        # Log to DB (Supabase)
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

        # Log to DB (Supabase)
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
