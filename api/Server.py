# server.py
from flask import Flask, request, jsonify
from flask_cors import CORS
import torch
import requests
import os

# --- Configuration ---
OPENWEATHER_KEY = os.environ.get("OPENWEATHER_KEY")
MODEL_PATH = "outputs/models/pytorch_fire_mlp.pt"  # adjust if needed

# --- Flask setup ---
app = Flask(__name__)
CORS(app)

# --- Load PyTorch model ---
class MLP(torch.nn.Module):
    def __init__(self, input_dim):
        super().__init__()
        self.net = torch.nn.Sequential(
            torch.nn.Linear(input_dim, 64),
            torch.nn.ReLU(),
            torch.nn.Linear(64, 32),
            torch.nn.ReLU(),
            torch.nn.Linear(32, 1),
            torch.nn.Sigmoid(),
        )

    def forward(self, x):
        return self.net(x)


# Load checkpoint
ckpt = torch.load(MODEL_PATH, map_location="cpu")
feature_cols = ckpt["feature_cols"]

model = MLP(len(feature_cols))
model.load_state_dict(ckpt["model_state_dict"])
model.eval()

# --- Weather Fetcher ---
def get_live_weather(lat, lon):
    if not OPENWEATHER_KEY:
        print("⚠️ No OPENWEATHER_KEY set, returning zeroed weather data")
        return {"wind_speed": 0.0, "wind_dir": 0.0, "temp": 0.0, "humidity": 0.0}

    url = (
        "https://api.openweathermap.org/data/2.5/weather"
        f"?lat={lat}&lon={lon}&appid={OPENWEATHER_KEY}&units=metric"
    )
    try:
        res = requests.get(url, timeout=5)
        res.raise_for_status()
        data = res.json()
        return {
            "wind_speed": data.get("wind", {}).get("speed", 0.0),
            "wind_dir": data.get("wind", {}).get("deg", 0.0),
            "temp": data.get("main", {}).get("temp", 0.0),
            "humidity": data.get("main", {}).get("humidity", 0.0),
        }
    except Exception as e:
        print(f"⚠️ Weather fetch failed: {e}")
        return {"wind_speed": 0.0, "wind_dir": 0.0, "temp": 0.0, "humidity": 0.0}


# --- Prediction Endpoint ---
@app.route("/predict", methods=["POST"])
def predict():
    body = request.get_json()
    feats = body.get("features", {})

    lat = feats.get("latitude")
    lon = feats.get("longitude")

    # Fetch weather data
    if lat is not None and lon is not None:
        wx = get_live_weather(lat, lon)
        feats.update(wx)

    # Build feature vector
    x_vals = [float(feats.get(c, 0.0)) for c in feature_cols]
    x_tensor = torch.tensor([x_vals], dtype=torch.float32)

    # Predict
    with torch.no_grad():
        prob = model(x_tensor).item()
    pred = 1 if prob > 0.5 else 0

    return jsonify({
        "prediction": pred,
        "probability": prob,
        "used_weather": {
            "wind_speed": feats.get("wind_speed"),
            "wind_dir": feats.get("wind_dir"),
            "temp": feats.get("temp"),
            "humidity": feats.get("humidity"),
        }
    })


if __name__ == "__main__":
    app.run(debug=True)
