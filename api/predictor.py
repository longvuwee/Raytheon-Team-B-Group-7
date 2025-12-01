# predictor.py
"""
Model prediction utilities for Firecast-X.

- Supports three models:
    * random_forest.joblib
    * logreg.joblib
    * pytorch_nn.pt

- All model files are expected to live in:
      ./models
  next to this file, unless the environment variable MODEL_DIR
  is set, in which case that directory is used instead.

- Optionally uses:
    * scaler.joblib  : sklearn-style scaler with .transform()
"""

import os
from pathlib import Path
from typing import Dict, Any

import numpy as np
import joblib
import torch

# ---------------------------------------------------------------------
# Paths / directories
# ---------------------------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent


def _get_model_dir() -> Path:
    """
    Directory containing model artifacts.
    Default: ./models next to this file.
    Override with MODEL_DIR env var if desired.
    """
    env_dir = os.environ.get("MODEL_DIR")
    if env_dir:
        return Path(env_dir)

    return BASE_DIR / "models"


MODEL_DIR = _get_model_dir()

# ---------------------------------------------------------------------
# FIXED FEATURE ORDER  (must match training!)
# ---------------------------------------------------------------------

FEATURE_COLS = [
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

# ---------------------------------------------------------------------
# Lazy-loaded artifacts
# ---------------------------------------------------------------------

# sklearn models
_rf_model = None
_lr_model = None

# PyTorch model
_nn_model = None
_nn_device = "cpu"

# Optional scaler
_scaler = None


def _load_scaler():
    global _scaler
    if _scaler is None:
        path = MODEL_DIR / "scaler.joblib"
        if path.exists():
            _scaler = joblib.load(path)
        else:
            _scaler = None
    return _scaler


def _load_random_forest():
    global _rf_model
    if _rf_model is None:
        path = MODEL_DIR / "random_forest.joblib"
        _rf_model = joblib.load(path)
    return _rf_model


def _load_logreg():
    global _lr_model
    if _lr_model is None:
        path = MODEL_DIR / "logreg.joblib"
        _lr_model = joblib.load(path)
    return _lr_model


def _load_pytorch_nn():
    """
    Loads the PyTorch neural network model.
    Always runs on CPU (safest for Render / most backends).
    """
    global _nn_model, _nn_device
    if _nn_model is None:
        path = MODEL_DIR / "pytorch_nn.pt"
        _nn_device = "cpu"
        _nn_model = torch.load(path, map_location=_nn_device)
        _nn_model.eval()
    return _nn_model, _nn_device


# ---------------------------------------------------------------------
# Feature preparation
# ---------------------------------------------------------------------

def _prepare_feature_vector(features: Dict[str, Any]) -> np.ndarray:
    """
    Convert input feature dict into a 2D numpy array (1, n_features)
    in the FIXED order defined by FEATURE_COLS.
    """
    values = []
    for name in FEATURE_COLS:
        if name not in features:
            raise KeyError(f"Missing required feature: {name}")
        values.append(float(features[name]))

    x = np.array(values, dtype=np.float32).reshape(1, -1)

    scaler = _load_scaler()
    if scaler is not None:
        x = scaler.transform(x)

    return x


# ---------------------------------------------------------------------
# Model-specific prediction helpers
# ---------------------------------------------------------------------

def _predict_rf(x: np.ndarray) -> float:
    model = _load_random_forest()
    # predict_proba returns [ [p0, p1] ]
    proba = model.predict_proba(x)[0][1]
    return float(proba)


def _predict_lr(x: np.ndarray) -> float:
    model = _load_logreg()
    proba = model.predict_proba(x)[0][1]
    return float(proba)


def _predict_nn(x: np.ndarray) -> float:
    model, device = _load_pytorch_nn()

    # Convert numpy → torch
    xt = torch.from_numpy(x).float().to(device)

    with torch.no_grad():
        out = model(xt)

    # Handle various output shapes:
    #   - scalar
    #   - (1, 1)
    #   - (1, 2) logits
    out_np = out.cpu().numpy()

    if out_np.ndim == 0:
        # single logit → sigmoid
        prob = 1.0 / (1.0 + np.exp(-out_np))
    elif out_np.shape == (1,) or out_np.shape == (1, 1):
        logit = float(out_np.reshape(-1)[0])
        prob = 1.0 / (1.0 + np.exp(-logit))
    else:
        # assume last dim is [p0, p1] or logits for 2 classes
        vec = out_np.reshape(-1)
        if vec.size == 2:
            # apply softmax if these are logits
            e = np.exp(vec - np.max(vec))
            probs = e / e.sum()
            prob = float(probs[1])
        else:
            # best-effort fallback: just take last value and sigmoid
            logit = float(vec[-1])
            prob = 1.0 / (1.0 + np.exp(-logit))

    return float(prob)


# ---------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------

def predict_fire_spread(features: Dict[str, Any], model_name: str = "random_forest") -> Dict[str, Any]:
    """
    Main entry point used by Server.py

    inputs: dict with keys in FEATURE_COLS
    output: { "model": str, "spread_probability": float }
    """
    # Prepare numeric feature vector in the fixed order
    x = _prepare_feature_vector(features)

    model_name = (model_name or "random_forest").lower()

    if model_name == "random_forest":
        prob = _predict_rf(x)
    elif model_name in ("logistic_regression", "logreg", "lr"):
        prob = _predict_lr(x)
    elif model_name in ("pytorch_nn", "nn", "neural_net", "neural_network"):
        prob = _predict_nn(x)
    else:
        raise ValueError(f"Unknown model name: {model_name}")

    return {
        "model": model_name,
        "spread_probability": float(prob),
    }


# Simple local test hook
if __name__ == "__main__":
    # Example dummy call
    example = {
        "latitude": 37.1,
        "longitude": -121.9,
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
        "month": 7,
    }
    print(predict_fire_spread(example, model_name="random_forest"))
