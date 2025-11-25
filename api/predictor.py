import joblib
import numpy as np
import torch
import torch.nn as nn
import pandas as pd
import os

# Paths
MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")

# Load feature list and scaler
feature_cols = joblib.load(os.path.join(MODELS_DIR, "feature_cols.joblib"))
scaler = joblib.load(os.path.join(MODELS_DIR, "scaler.joblib"))

# Load sklearn models
rf_model = joblib.load(os.path.join(MODELS_DIR, "random_forest.joblib"))
lr_model = joblib.load(os.path.join(MODELS_DIR, "logreg.joblib"))

# PyTorch model definition
class MLP(nn.Module):
    def __init__(self, in_dim):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_dim, 64),
            nn.ReLU(),
            nn.Linear(64, 32),
            nn.ReLU(),
            nn.Linear(32, 1),
            nn.Sigmoid()
        )
    def forward(self, x):
        return self.net(x)

# Load PyTorch model
nn_model = MLP(len(feature_cols))
nn_model.load_state_dict(torch.load(os.path.join(MODELS_DIR, "pytorch_nn.pt"), map_location="cpu"))
nn_model.eval()

# ------------------------------------------------------------
# Core prediction function
# ------------------------------------------------------------
def predict_fire_spread(data: dict, model_name="random_forest"):
    """
    data: dict of features, e.g.
      {
        "latitude": 37.5,
        "longitude": -120.4,
        "brightness": 335.1,
        "bright_t31": 295.2,
        "confidence": 85,
        "daynight": 1,
        "elevation": 120.3,
        "slope": 5.1,
        "aspect": 150.0,
        "temp": 30.0,
        "humidity": 45.0,
        "wind_speed": 3.5,
        "precip": 0.0,
        "month": 8
      }
    """
    # Create DataFrame with all expected columns
    x_df = pd.DataFrame([data])
    for col in feature_cols:
        if col not in x_df.columns:
            x_df[col] = 0.0
    x_df = x_df[feature_cols].astype(float)

    # Scale for models that need it
    x_scaled = scaler.transform(x_df)

    # Select and predict
    if model_name == "random_forest":
        prob = rf_model.predict_proba(x_df)[:, 1][0]
    elif model_name == "logistic_regression":
        prob = lr_model.predict_proba(x_scaled)[:, 1][0]
    elif model_name == "pytorch_nn":
        x_tensor = torch.tensor(x_scaled, dtype=torch.float32)
        with torch.no_grad():
            prob = nn_model(x_tensor).numpy().flatten()[0]
    else:
        raise ValueError(f"Unknown model: {model_name}")

    return {
        "model": model_name,
        "spread_probability": float(prob),
        "prediction": "Spread" if prob >= 0.5 else "No Spread"
    }
if __name__ == "__main__":
    sample = {
        "latitude": 37.2,
        "longitude": -120.5,
        "brightness": 340,
        "bright_t31": 295,
        "confidence": 80,
        "daynight": 1,
        "elevation": 100,
        "slope": 4,
        "aspect": 160,
        "temp": 32,
        "humidity": 40,
        "wind_speed": 6,
        "precip": 0,
        "month": 8
    }
    from pprint import pprint
    pprint(predict_fire_spread(sample, "random_forest"))
    pprint(predict_fire_spread(sample, "pytorch_nn"))
