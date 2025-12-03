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

feature_cols = joblib.load(FEATURE_COLS_PATH)
scaler       = joblib.load(SCALER_PATH)
rf           = joblib.load(RF_MODEL_PATH)
lr           = joblib.load(LR_MODEL_PATH)


# --------------------------------------------------
# Helper: build feature vector in the correct order
# --------------------------------------------------
def _build_feature_arrays(features: Dict[str, Any]) -> tuple[np.ndarray, pd.DataFrame]:
    """
    Build both a 1×N numpy array (ordered by feature_cols) and
    a 1-row pandas DataFrame with named columns. Passing the DataFrame to
    scikit-learn models avoids the 'X does not have valid feature names' warnings
    that appear when estimators were trained on DataFrames with column names.
    """
    vals = []
    row_dict = {}
    for name in feature_cols:
        if name not in features:
            raise KeyError(f"Missing feature: {name}")
        v = float(features[name])
        vals.append(v)
        row_dict[name] = v

    x = np.array(vals, dtype=float).reshape(1, -1)
    x_df = pd.DataFrame([row_dict], columns=feature_cols)
    return x, x_df


# --------------------------------------------------
# Public API
# --------------------------------------------------
def predict_fire_spread(features: Dict[str, Any], model_name: str = "random_forest") -> Dict[str, Any]:
    """
    features: dict with raw numeric values for all feature_cols
    model_name: "random_forest" or "logistic_regression" (or "logreg")
    Returns: {"model": <used_model>, "spread_probability": float}
    """
    x, x_df = _build_feature_arrays(features)
    m = (model_name or "random_forest").lower()

    if m == "random_forest":
        prob = rf.predict_proba(x_df)[0, 1]
        used_model = "random_forest"

    elif m in ("logistic_regression", "logreg"):
        x_scaled = scaler.transform(x_df)
        prob = lr.predict_proba(x_scaled)[0, 1]
        used_model = "logistic_regression"

    else:
        # Fallback to RF
        prob = rf.predict_proba(x_df)[0, 1]
        used_model = "random_forest"

    return {
        "model": used_model,
        "spread_probability": float(prob),
    }


def predict_fire_spread_batch(feature_dicts: list[Dict[str, Any]], model_name: str = "random_forest") -> list[float]:
    """Vectorized batch prediction.
    feature_dicts: list of feature dictionaries containing all feature_cols.
    Returns list of spread probabilities (floats) in the same order.
    Falls back to per-row zero probability if a failure occurs.
    """
    m = (model_name or "random_forest").lower()
    if not feature_dicts:
        return []
def predict_fire_spread_batch(feature_dicts: list[Dict[str, Any]], model_name: str = "random_forest") -> list[float]:
    """Vectorized batch prediction.
    feature_dicts: list of feature dictionaries containing all feature_cols.
    Returns list of spread probabilities (floats) in the same order.
    Falls back to per-row zero probability if a failure occurs.
    """
    m = (model_name or "random_forest").lower()
    if not feature_dicts:
        return []
    try:
        # Build DataFrame with ordered columns
        rows = []
        for f in feature_dicts:
            row = []
            for name in feature_cols:
                if name not in f:
                    raise KeyError(f"Missing feature: {name}")
                row.append(float(f[name]))
            rows.append(row)
        df = pd.DataFrame(rows, columns=feature_cols)

        if m == "random_forest":
            probs = rf.predict_proba(df)[:, 1]
        elif m in ("logistic_regression", "logreg"):
            scaled = scaler.transform(df)
            probs = lr.predict_proba(scaled)[:, 1]
        else:
            probs = rf.predict_proba(df)[:, 1]
        return [float(p) for p in probs]
    except Exception:
        # Conservative fallback
        return [0.0 for _ in feature_dicts]