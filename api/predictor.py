# predictor.py
"""
Model prediction utilities for Firecast-X.

Supports:
- Random Forest (scikit-learn)
- Logistic Regression (scikit-learn)
- PyTorch neural network

All models assume the same ordered feature vector:
    [
        'latitude', 'longitude', 'brightness', 'bright_t31', 'confidence',
        'daynight', 'elevation', 'slope', 'aspect',
        'temp', 'humidity', 'wind_speed', 'precip', 'month'
    ]

Each predict_* function returns a probability that the fire will spread.
"""

import os
import joblib
import numpy as np

import torch
import torch.nn as nn
import torch.nn.functional as F


# ---------------------------------
# 1) Feature order / config
# ---------------------------------

FEATURE_COLUMNS = [
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


def _feature_dict_to_array(feature_dict: dict) -> np.ndarray:
    """
    Convert incoming JSON dict into a 2D numpy array [1, n_features] in the
    exact order defined in FEATURE_COLUMNS.

    Missing features are treated as 0.0 (you can tighten this if you want).
    """
    values = []
    for key in FEATURE_COLUMNS:
        v = feature_dict.get(key, 0.0)
        try:
            v = float(v)
        except (TypeError, ValueError):
            v = 0.0
        values.append(v)
    arr = np.array(values, dtype=np.float32).reshape(1, -1)
    return arr


# ---------------------------------
# 2) PyTorch NN architecture
# ---------------------------------

class FireSpreadNN(nn.Module):
    """
    Feed-forward network used for the PyTorch model.

    IMPORTANT:
    This architecture must match what you used during training.
    If your training script used a different layer structure,
    adjust this class accordingly and re-deploy.
    """

    def __init__(self, input_dim: int):
        super().__init__()
        self.fc1 = nn.Linear(input_dim, 64)
        self.fc2 = nn.Linear(64, 32)
        self.fc3 = nn.Linear(32, 1)

    def forward(self, x):
        x = F.relu(self.fc1(x))
        x = F.relu(self.fc2(x))
        x = torch.sigmoid(self.fc3(x))  # output: probability in [0, 1]
        return x


# ---------------------------------
# 3) Lazy-loaded model globals
# ---------------------------------

_rf_model = None
_lr_model = None
_nn_model = None
_device = torch.device("cpu")


def _get_model_dir() -> str:
    """
    Directory where model files live. Defaults to current working directory.
    You can override with the MODEL_DIR environment variable.
    """
    return os.environ.get("MODEL_DIR", os.getcwd())


def _load_rf():
    global _rf_model
    if _rf_model is not None:
        return _rf_model

    model_path = os.path.join(_get_model_dir(), "random_forest.joblib")
    _rf_model = joblib.load(model_path)
    return _rf_model


def _load_lr():
    global _lr_model
    if _lr_model is not None:
        return _lr_model

    model_path = os.path.join(_get_model_dir(), "logreg.joblib")
    _lr_model = joblib.load(model_path)
    return _lr_model


def _load_nn():
    global _nn_model, _device
    if _nn_model is not None:
        return _nn_model

    input_dim = len(FEATURE_COLUMNS)
    model = FireSpreadNN(input_dim=input_dim)
    model_path = os.path.join(_get_model_dir(), "pytorch_nn.pt")

    # Map everything to CPU (Render free tier = no GPU)
    state = torch.load(model_path, map_location=_device)
    model.load_state_dict(state)
    model.eval()

    _nn_model = model
    return _nn_model


# ---------------------------------
# 4) Per-model prediction helpers
# ---------------------------------

def predict_with_random_forest(features: dict) -> float:
    """
    Returns probability of spread using the Random Forest model.
    """
    X = _feature_dict_to_array(features)
    model = _load_rf()

    # Assumes binary classification: model.predict_proba(...)[:, 1]
    if hasattr(model, "predict_proba"):
        proba = model.predict_proba(X)[0, 1]
    else:
        # fallback if it's a decision_function or something else
        pred = model.predict(X)[0]
        proba = float(pred)

    return float(proba)


def predict_with_logistic_regression(features: dict) -> float:
    """
    Returns probability of spread using the Logistic Regression model.
    """
    X = _feature_dict_to_array(features)
    model = _load_lr()

    if hasattr(model, "predict_proba"):
        proba = model.predict_proba(X)[0, 1]
    else:
        # fallback
        pred = model.predict(X)[0]
        proba = float(pred)

    return float(proba)


def predict_with_nn(features: dict) -> float:
    """
    Returns probability of spread using the PyTorch NN model.
    """
    X = _feature_dict_to_array(features)
    model = _load_nn()

    with torch.no_grad():
        x_t = torch.from_numpy(X).to(_device)
        out = model(x_t)  # shape: [1, 1]
        proba = float(out.item())

    # Ensure it's in [0, 1]
    proba = max(0.0, min(1.0, proba))
    return proba


# ---------------------------------
# 5) Unified prediction entry point
# ---------------------------------

def predict_fire_spread(input_features: dict, model_name: str = "random_forest") -> dict:
    """
    Unified prediction interface used by Server.py.

    input_features: dict with all numeric inputs (lat, lon, weather, etc.).
                    'model' key is ignored if present.

    model_name: one of "random_forest", "logistic_regression", "pytorch_nn".

    Returns:
        {
            "model": "...",
            "spread_probability": <float>,
            "features_used": [...],
        }
    """
    # Make sure we ignore any "model" key in the payload itself:
    features = {k: v for k, v in input_features.items() if k != "model"}

    model_name = (model_name or "").lower()

    if model_name == "random_forest":
        prob = predict_with_random_forest(features)
    elif model_name in ("logistic_regression", "logreg", "log_reg"):
        prob = predict_with_logistic_regression(features)
    elif model_name in ("pytorch_nn", "nn", "neural_network"):
        prob = predict_with_nn(features)
    else:
        # default fallback
        prob = predict_with_random_forest(features)
        model_name = "random_forest"

    return {
        "model": model_name,
        "spread_probability": float(prob),
        "features_used": FEATURE_COLUMNS,
    }


if __name__ == "__main__":
    # Quick manual test (you can run: python predictor.py locally)
    sample = {
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
        "month": 8,
    }
    out = predict_fire_spread(sample, model_name="random_forest")
    print(out)
