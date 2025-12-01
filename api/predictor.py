# predictor.py
"""
Firecast-X predictor module.

Loads:
  - models/random_forest.joblib
  - models/logreg.joblib   (optional)
  - models/feature_cols.joblib (list of feature names, in training order)
  - models/scaler.joblib       (sklearn scaler, optional)
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Dict, Any

import numpy as np
import joblib

# ---------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent
MODEL_DIR = BASE_DIR / "models"

RF_PATH = MODEL_DIR / "random_forest.joblib"
LR_PATH = MODEL_DIR / "logreg.joblib"
FEATURE_COLS_PATH = MODEL_DIR / "feature_cols.joblib"
SCALER_PATH = MODEL_DIR / "scaler.joblib"

_rf_model = None
_lr_model = None
_feature_cols = None
_scaler = None


def _load_feature_cols():
    global _feature_cols
    if _feature_cols is None:
        if not FEATURE_COLS_PATH.exists():
            raise RuntimeError(f"Missing feature_cols.joblib at {FEATURE_COLS_PATH}")
        _feature_cols = joblib.load(FEATURE_COLS_PATH)
        if not isinstance(_feature_cols, (list, tuple)):
            raise RuntimeError("feature_cols.joblib must contain a list/tuple of feature names.")
    return _feature_cols


def _load_scaler():
    global _scaler
    if _scaler is None:
        if SCALER_PATH.exists():
            _scaler = joblib.load(SCALER_PATH)
        else:
            _scaler = None
    return _scaler


def _load_rf():
    global _rf_model
    if _rf_model is None:
        if not RF_PATH.exists():
            raise RuntimeError(f"Missing random_forest.joblib at {RF_PATH}")
        _rf_model = joblib.load(RF_PATH)
    return _rf_model


def _load_lr():
    global _lr_model
    if _lr_model is None:
        if not LR_PATH.exists():
            raise RuntimeError(f"Missing logreg.joblib at {LR_PATH}")
        _lr_model = joblib.load(LR_PATH)
    return _lr_model


def _build_feature_vector(features: Dict[str, Any]) -> np.ndarray:
    """
    Build 2D numpy array (1, n_features) in the *training* order.

    We rely on feature_cols.joblib for the correct order.
    Every name in feature_cols must be present in the incoming dict.
    """
    cols = _load_feature_cols()
    values = []
    for name in cols:
        if name not in features:
            raise KeyError(f"Missing required feature: {name}")
        values.append(float(features[name]))

    x = np.asarray(values, dtype=np.float32).reshape(1, -1)

    scaler = _load_scaler()
    if scaler is not None:
        x = scaler.transform(x)

    return x


def predict_fire_spread(features: Dict[str, Any], model_name: str = "random_forest") -> Dict[str, Any]:
    """
    Core prediction API used by Server.py.
    """
    x = _build_feature_vector(features)
    name = (model_name or "random_forest").lower()

    if name == "random_forest":
        model = _load_rf()
        p = float(model.predict_proba(x)[0][1])
        resolved = "random_forest"
    elif name in ("logistic_regression", "logreg", "lr"):
        model = _load_lr()
        p = float(model.predict_proba(x)[0][1])
        resolved = "logistic_regression"
    else:
        raise ValueError(f"Unsupported model '{model_name}'. Use 'random_forest' or 'logistic_regression'.")

    return {
        "model": resolved,
        "spread_probability": p,
    }


if __name__ == "__main__":
    dummy = {
        "latitude": 40.0001,
        "longitude": -120.0001,
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
        "month": 8,
    }
    print(predict_fire_spread(dummy, "random_forest"))
