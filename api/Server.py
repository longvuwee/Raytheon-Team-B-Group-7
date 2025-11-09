# api/Server.py
import os
from flask import Flask, request, jsonify
import joblib
import psycopg2
import numpy as np

app = Flask(__name__)

# -------------------------
# 1) Paths
# -------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(BASE_DIR, "models")

SCALER_PATH = os.path.join(MODEL_DIR, "scaler.joblib")
RF_PATH     = os.path.join(MODEL_DIR, "random_forest.joblib")

# -------------------------
# 2) Load ML artifacts
# -------------------------
scaler = joblib.load(SCALER_PATH)
rf_model = joblib.load(RF_PATH)

# figure out feature order
if hasattr(scaler, "feature_names_in_"):
    feature_cols = list(scaler.feature_names_in_)
else:
    feature_cols = [
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

print("Scaler expects these features (in order):")
for i, col in enumerate(feature_cols, start=1):
    print(f"{i:2d}. {col}")

# -------------------------
# 3) DB config
# -------------------------
DB_CONFIG = {
    "host": "localhost",
    "port": 5433,
    "dbname": "firecast",
    "user": "postgres",
    "password": "SE4485!",
}

def get_db_conn():
    return psycopg2.connect(**DB_CONFIG)

@app.route("/db-test", methods=["GET"])
def db_test():
    try:
        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM firms_with_perimeter_labels;")
        (count,) = cur.fetchone()
        cur.close()
        conn.close()
        return jsonify({"status": "connected", "rows": int(count)})
    except Exception as e:
        return jsonify({"status": "error", "detail": str(e)}), 500

# -------------------------
# RF debug
# -------------------------
@app.route("/rf-debug", methods=["GET"])
def rf_debug():
    info = {
        "classes_": (
            rf_model.classes_.tolist()
            if hasattr(rf_model, "classes_")
            else None
        ),
        "n_estimators": int(getattr(rf_model, "n_estimators", 0)),
    }
    return jsonify(info)

# -------------------------
# helper: make things JSON-safe
# -------------------------
def to_py(x):
    if isinstance(x, np.generic):
        return x.item()
    if isinstance(x, np.ndarray):
        return x.tolist()
    return x

# -------------------------
# 4) Predict
# -------------------------
@app.route("/predict", methods=["POST"])
def predict():
    try:
        if not request.data:
            return jsonify({"error": "no JSON body"}), 400

        data = request.get_json(silent=True)
        if data is None:
            return jsonify({"error": "invalid JSON"}), 400

        # build input in correct order
        row = []
        for col in feature_cols:
            val = data.get(col, 0)
            try:
                val = float(val)
            except (TypeError, ValueError):
                val = 0.0
            row.append(val)

        # scale
        try:
            X_scaled = scaler.transform([row])
        except Exception as e:
            return jsonify({
                "error": "scaler.transform failed",
                "detail": str(e),
                "expected_features": feature_cols,
                "input_used": row,
            }), 400

        # predict
        y_pred = rf_model.predict(X_scaled)[0]
        y_pred = to_py(y_pred)

        proba = None
        if hasattr(rf_model, "predict_proba"):
            proba = rf_model.predict_proba(X_scaled)[0]
            proba = to_py(proba)

        return jsonify({
            "prediction": y_pred,
            "probabilities": proba,
            "used_features": feature_cols,
            "input_used": row,
        })

    except Exception as e:
        # catch absolutely everything so Flask doesn't return None
        return jsonify({
            "error": "unexpected error in /predict",
            "detail": str(e),
        }), 500

# -------------------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
