# predictor.py
from __future__ import annotations

from pathlib import Path
from typing import Dict, Any

import joblib
import numpy as np

# ---------------------------------------------------
# Locate model files under api/models
# ---------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent          # .../Raytheon-Team-B-Group-7/api
MODEL_DIR = BASE_DIR / "models"

FEATURE_COLS_PATH = MODEL_DIR / "feature_cols.joblib"
SCALER_PATH       = MODEL_DIR / "scaler.joblib"

RF_MODEL_PATH     = MODEL_DIR / "random_forest.joblib"
LR_MODEL_PATH     = MODEL_DIR / "logreg.joblib"          # logistic regression

print("Loading feature_cols from:", FEATURE_COLS_PATH)
print("Loading scaler from:", SCALER_PATH)
print("Loading RF model from:", RF_MODEL_PATH)
print("Loading LR model from:", LR_MODEL_PATH)

feature_cols = joblib.load(FEATURE_COLS_PATH)
scaler = joblib.load(SCALER_PATH)
rf_model = joblib.load(RF_MODEL_PATH)
lr_model = joblib.load(LR_MODEL_PATH)


# ---------------------------------------------------
# Build feature vector in the SAME order as training
# ---------------------------------------------------
def _build_feature_vector(features: Dict[str, Any]) -> np.ndarray:
    """
    Turn a dict of features into a 2D numpy array with columns ordered
    exactly as in feature_cols.
    """
    values = []
    for name in feature_cols:
        if name not in features:
            raise KeyError(f"Missing feature '{name}' for prediction")
        values.append(float(features[name]))
    return np.array([values], dtype=float)   # shape (1, n_features)


# ---------------------------------------------------
# Main prediction function used by Server.py
# ---------------------------------------------------
def predict_fire_spread(features: Dict[str, Any], model_name: str = "random_forest") -> Dict[str, Any]:
    """
    features: dict containing ALL required numeric features
              (latitude, longitude, brightness, ..., month)
    model_name: "random_forest" or "logistic_regression"
    """
    model_name = (model_name or "random_forest").lower()

    # Build feature vector in correct order
    X = _build_feature_vector(features)

    # Scale features once, using the same scaler from training
    X_scaled = scaler.transform(X)

    # Choose model
    if model_name == "logistic_regression":
        prob = float(lr_model.predict_proba(X_scaled)[0, 1])
    else:
        # default: random forest
        prob = float(rf_model.predict_proba(X_scaled)[0, 1])
        model_name = "random_forest"

    return {
        "model": model_name,
        "spread_probability": prob,
    }
