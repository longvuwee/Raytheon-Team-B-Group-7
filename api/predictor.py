from __future__ import annotations

from pathlib import Path
from typing import Dict, Any

import joblib
import numpy as np
import pandas as pd

# --------------------------------------------------
# Model paths
# --------------------------------------------------
BASE_DIR = Path(__file__).resolve().parents[1]      # repo root
MODEL_DIR = BASE_DIR / "api" / "models"

FEATURE_COLS_PATH = MODEL_DIR / "feature_cols.joblib"
SCALER_PATH       = MODEL_DIR / "scaler.joblib"
RF_MODEL_PATH     = MODEL_DIR / "random_forest.joblib"
LR_MODEL_PATH     = MODEL_DIR / "logreg.joblib"

print("Loading feature_cols from:", FEATURE_COLS_PATH)
print("Loading scaler from:", SCALER_PATH)
print("Loading RF model from:", RF_MODEL_PATH)
print("Loading LR model from:", LR_MODEL_PATH)

feature_cols = joblib.load(FEATURE_COLS_PATH)   # list of feature names
scaler       = joblib.load(SCALER_PATH)
rf           = joblib.load(RF_MODEL_PATH)
lr           = joblib.load(LR_MODEL_PATH)


# --------------------------------------------------
# Helper: build feature vector in the correct order
# --------------------------------------------------
def _build_feature_vector(features: Dict[str, Any]) -> pd.DataFrame:
    """
    Build a 1×N DataFrame with columns in the same order as `feature_cols`.
    Returns a DataFrame to preserve feature names and avoid sklearn warnings.
    """
    vals = []
    for name in feature_cols:
        if name not in features:
            raise KeyError(f"Missing feature: {name}")
        vals.append(float(features[name]))

    # Return DataFrame with proper column names
    return pd.DataFrame([vals], columns=feature_cols)


# --------------------------------------------------
# Public API
# --------------------------------------------------
def predict_fire_spread(features: Dict[str, Any], model_name: str = "random_forest") -> Dict[str, Any]:
    """
    features: dict with raw numeric values for all feature_cols
    model_name: "random_forest" or "logistic_regression" (or "logreg")
    Returns: {"model": <used_model>, "spread_probability": float}
    """
    x = _build_feature_vector(features)
    m = (model_name or "random_forest").lower()

    if m == "random_forest":
        # IMPORTANT: RF was trained on **raw** features, so we DO NOT scale here.
        prob = rf.predict_proba(x)[0, 1]
        used_model = "random_forest"

    elif m in ("logistic_regression", "logreg"):
        # LR was trained on scaled features → apply scaler
        x_scaled = scaler.transform(x)
        prob = lr.predict_proba(x_scaled)[0, 1]
        used_model = "logistic_regression"

    else:
        # Fallback to RF on raw features
        prob = rf.predict_proba(x)[0, 1]
        used_model = "random_forest"

    return {
        "model": used_model,
        "spread_probability": float(prob),
    }
