import joblib
import numpy as np
from pathlib import Path

# ---------------------------------------------
# Auto-locate model directory (one level above /api)
# ---------------------------------------------
BASE_DIR = Path(__file__).resolve().parents[1]
MODEL_DIR = BASE_DIR / "api" / "models"

FEATURE_COLS_PATH = MODEL_DIR / "feature_cols.joblib"
RF_MODEL_PATH = MODEL_DIR / "random_forest.joblib"

print("Loading feature_cols from:", FEATURE_COLS_PATH)
print("Loading RF model from:", RF_MODEL_PATH)

# ---------------------------------------------
# Load files
# ---------------------------------------------
feature_cols = joblib.load(FEATURE_COLS_PATH)
rf = joblib.load(RF_MODEL_PATH)

print("\nfeature_cols:", feature_cols)

# ---------------------------------------------
# Helper to build feature vector
# ---------------------------------------------
def build_vector(features: dict) -> np.ndarray:
    values = []
    for name in feature_cols:
        if name not in features:
            raise KeyError(f"Missing feature {name}")
        values.append(float(features[name]))
    return np.array([values])


# ---------------------------------------------
# Test inputs
# ---------------------------------------------
x1 = {
    "latitude": 37.1234,
    "longitude": -121.9876,
    "brightness": 350,
    "bright_t31": 300,
    "confidence": 90,
    "daynight": 1,
    "elevation": 250,
    "slope": 10,
    "aspect": 180,
    "temp": 35,
    "humidity": 20,
    "wind_speed": 12,
    "precip": 0,
    "month": 7
}

x2 = {
    "latitude": 40.5000,
    "longitude": -105.0000,
    "brightness": 500,
    "bright_t31": 500,
    "confidence": 300,
    "daynight": 1,
    "elevation": 0,
    "slope": 0,
    "aspect": 0,
    "temp": 64,
    "humidity": 0,
    "wind_speed": 100,
    "precip": 0,
    "month": 8
}

# ---------------------------------------------
# Build vectors
# ---------------------------------------------
X1 = build_vector(x1)
X2 = build_vector(x2)

print("\nX1:", X1)
print("X2:", X2)

# ---------------------------------------------
# Predictions
# ---------------------------------------------
p1 = rf.predict_proba(X1)[0, 1]
p2 = rf.predict_proba(X2)[0, 1]

print("\nRF p1 =", p1)
print("RF p2 =", p2)
