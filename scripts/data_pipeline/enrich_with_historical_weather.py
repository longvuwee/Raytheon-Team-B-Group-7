import os
import math
import requests
import pandas as pd
from datetime import datetime, time

INPUT_CSV = "data/datasets/fires_with_topo_full.csv"   # your current fire csv
OUT_CSV = "outputs/features/fires_with_hist_weather.csv"
os.makedirs("outputs/features", exist_ok=True)

# open-meteo base
BASE_URL = "https://archive-api.open-meteo.com/v1/archive"

def fetch_day_weather(lat, lon, date_str):
    """Fetch one day's hourly weather for a point."""
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": date_str,
        "end_date": date_str,
        "hourly": ",".join([
            "temperature_2m",
            "relative_humidity_2m",
            "windspeed_10m",
            "winddirection_10m"
        ]),
        "timezone": "UTC",
    }
    r = requests.get(BASE_URL, params=params, timeout=10)
    r.raise_for_status()
    return r.json()

def pick_hour(data, target_hour):
    """Pick the hour in the response closest to target_hour (0-23)."""
    times = data.get("hourly", {}).get("time", [])
    temps = data.get("hourly", {}).get("temperature_2m", [])
    hums  = data.get("hourly", {}).get("relative_humidity_2m", [])
    winds = data.get("hourly", {}).get("windspeed_10m", [])
    wdirs = data.get("hourly", {}).get("winddirection_10m", [])

    if not times:
        return None

    # times come like "2024-11-06T00:00"
    best_idx = None
    best_diff = 999
    for i, t in enumerate(times):
        hour = int(t.split("T")[1].split(":")[0])
        diff = abs(hour - target_hour)
        if diff < best_diff:
            best_diff = diff
            best_idx = i

    return {
        "hist_temp": temps[best_idx] if best_idx is not None else None,
        "hist_humidity": hums[best_idx] if best_idx is not None else None,
        "hist_wind_speed": winds[best_idx] if best_idx is not None else None,
        "hist_wind_dir": wdirs[best_idx] if best_idx is not None else None,
    }

def main():
    df = pd.read_csv(INPUT_CSV)

    # make sure columns exist
    for col in ["hist_temp", "hist_humidity", "hist_wind_speed", "hist_wind_dir"]:
        if col not in df.columns:
            df[col] = None

    for idx, row in df.iterrows():
        lat = float(row["latitude"])
        lon = float(row["longitude"])
        date_str = row["acq_date"]  # should be YYYY-MM-DD already; if not, parse
        acq_time = row.get("acq_time", None)

        # convert acq_time like 1830 -> hour 18
        if pd.isna(acq_time):
            target_hour = 0
        else:
            target_hour = int(int(acq_time) // 100)

        try:
            day_data = fetch_day_weather(lat, lon, date_str)
            picked = pick_hour(day_data, target_hour)
        except Exception as e:
            print(f"row {idx} failed: {e}")
            picked = {
                "hist_temp": None,
                "hist_humidity": None,
                "hist_wind_speed": None,
                "hist_wind_dir": None,
            }

        df.at[idx, "hist_temp"] = picked["hist_temp"]
        df.at[idx, "hist_humidity"] = picked["hist_humidity"]
        df.at[idx, "hist_wind_speed"] = picked["hist_wind_speed"]
        df.at[idx, "hist_wind_dir"] = picked["hist_wind_dir"]

        if idx % 50 == 0:
            print(f"processed {idx}/{len(df)}")

    df.to_csv(OUT_CSV, index=False)
    print(f"✅ wrote {OUT_CSV}")

if __name__ == "__main__":
    main()
