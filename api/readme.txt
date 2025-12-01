Base URL
All requests go to:
https://firecast-x.onrender.com
All bodies are JSON. All responses are JSON.

Shared concepts - The backend works around three core ideas:
Models
"random_forest"
"logistic_regression"
"pytorch_nn"

Grid blocks (~200 ft)
The server snaps any (latitude, longitude) into a grid block about 200 ft × 200 ft.
All coordinates inside the same block share the same state (T, T_burn, avg probability).
So: if the frontend wants the same cell, it must send the same lat/lon each time.

Fire state over time
spread_probability = model probability that fire spreads.
Threshold: 0.75 (75%)
T (integer 0–12): number of time steps since that block first started burning.
T_burn (integer state):
0 → no fire at this block
1 → currently burning
2 → burned out (was burning, now stopped)
3 → cannot burn (future use; for water etc.)
The server stores per-block state in the database and updates it on every call.

Common input fields (per request)
Every prediction endpoint expects these base fields (except where noted):
{
  "model": "random_forest",  // optional for /predict; required for /predict-horizon
  "latitude": 40.0001,       // degrees
  "longitude": -120.0001,    // degrees
  "brightness": 310,         // FIRMS brightness-like
  "bright_t31": 290,
  "confidence": 80,          // 0–100
  "daynight": 1,             // 1 = day, 0 = night
  "elevation": 200,          // meters
  "slope": 5,                // degrees or %
  "aspect": 0,               // degrees (0–360)
  "temp": 30,                // temperature
  "humidity": 40,            // %
  "wind_speed": 6,           // m/s or similar
  "precip": 0,               // mm or similar
  "month": 8                 // 1–12
}
Front-end rule: always send every field above; don’t rely on defaults.

Endpoint: POST /predict
Purpose: single-step prediction at current conditions.
Request body
{
  "model": "random_forest",   // optional; default = "random_forest"
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
  "month": 8
}
If model is omitted, the backend uses "random_forest".

Allowed values:
"random_forest"
"logistic_regression"
"pytorch_nn"

Response body:
{
  "model": "random_forest",
  "spread_probability": 0.81,
  "prediction": "Spread",      // "Spread" if prob >= 0.75, else "No Spread"
  "T": 3,                      // time steps since this block started burning
  "T_burn": 1                  // 0/1/2/3 as defined above
}
Internally, calling /predict also:
snaps (lat, lon) to a block,
updates that block’s T and T_burn using the rules in section 5,
accumulates probability statistics in the DB.

Endpoint: POST /predict-nn
Purpose: convenience endpoint for the neural network (no need to pass model).

Request body
Same as /predict, without model:
{
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
  "month": 8
}

Response body
{
  "model": "pytorch_nn",
  "spread_probability": 0.76,
  "prediction": "Spread",
  "T": 0,
  "T_burn": 1
}

Endpoint: POST /predict-horizon
Purpose: simulate T, T+1, T+2, … using the same features for each step.
{
  "model": "random_forest",   // required here
  "horizon": 5,               // number of steps to simulate (integer > 0)

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
  "month": 8
}

The server:
reuses the same feature set for each step,
calls the model horizon times,
updates T / T_burn each time for that block,
returns a trajectory.

Response body
{
  "latitude": 40.0001,
  "longitude": -120.0001,
  "model": "random_forest",
  "horizon": 5,
  "trajectory": [
    {
      "step_index": 0,
      "spread_probability": 0.81,
      "prediction": "Spread",
      "T": 0,
      "T_burn": 1
    },
    {
      "step_index": 1,
      "spread_probability": 0.83,
      "prediction": "Spread",
      "T": 1,
      "T_burn": 1
    },
    {
      "step_index": 2,
      "spread_probability": 0.77,
      "prediction": "Spread",
      "T": 2,
      "T_burn": 1
    },
    {
      "step_index": 3,
      "spread_probability": 0.40,
      "prediction": "No Spread",
      "T": 2,
      "T_burn": 2
    },
    {
      "step_index": 4,
      "spread_probability": 0.20,
      "prediction": "No Spread",
      "T": 2,
      "T_burn": 2
    }
  ]
}

Backend rule set (how state evolves)
This is the logic the frontend should understand but does not need to implement.
Let prob = spread_probability, threshold = 0.75.
For a given block (snapped lat/lon):
No fire yet
If this block has never burned:
If prob < 0.75 → T = 0, T_burn = 0
If prob >= 0.75 → T = 0, T_burn = 1 (fire ignites)
Currently burning (T_burn = 1)
If prob >= 0.75:
T = min(T + 1, 12)
T_burn = 1
If prob < 0.75:
T stays the same
T_burn = 2 (burned out)
Burned out (T_burn = 2)
If prob < 0.75:
T unchanged
T_burn = 2 (remains burned out)
If prob >= 0.75:
considered a new fire event:
T = 0
T_burn = 1
Non-burnable (T_burn = 3)
This is reserved for blocks that cannot burn (e.g., large water bodies).
When can_burn=False is implemented, server will:
T = 0
T_burn = 3
ignore probability for state transitions.
The frontend doesn’t send T or T_burn; it only reads them from responses.