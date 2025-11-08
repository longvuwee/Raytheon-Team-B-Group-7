import pandas as pd

class WeatherLoader:
    def __init__(self, weather_csv: str):
        self.weather_csv = weather_csv

    def load(self) -> pd.DataFrame:
        w = pd.read_csv(self.weather_csv)
        for c in ["datetime", "date", "DATE", "time", "timestamp"]:
            if c in w.columns:
                w["datetime"] = pd.to_datetime(w[c])
                break
        else:
            w["datetime"] = pd.Timestamp("2000-01-01")

        if "lat" in w.columns and "latitude" not in w.columns:
            w = w.rename(columns={"lat": "latitude"})
        if "lon" in w.columns and "longitude" not in w.columns:
            w = w.rename(columns={"lon": "longitude"})
        return w


class WeatherAttacher:
    def __init__(self, time_tolerance="6h", spatial_precision=2):
        self.time_tolerance = time_tolerance
        self.spatial_precision = spatial_precision

    def attach(self, df: pd.DataFrame, weather_df: pd.DataFrame) -> pd.DataFrame:
        df = df.copy()
        weather_df = weather_df.copy()

        df["datetime"] = pd.to_datetime(df["datetime"])
        weather_df["datetime"] = pd.to_datetime(weather_df["datetime"])

        df["lat_round"] = df["latitude"].round(self.spatial_precision)
        df["lon_round"] = df["longitude"].round(self.spatial_precision)

        if "latitude" in weather_df.columns and "longitude" in weather_df.columns:
            weather_df["lat_round"] = weather_df["latitude"].round(self.spatial_precision)
            weather_df["lon_round"] = weather_df["longitude"].round(self.spatial_precision)
        else:
            weather_df["lat_round"] = df["lat_round"].iloc[0]
            weather_df["lon_round"] = df["lon_round"].iloc[0]

        parts = []
        for (la, lo), sub_fire in df.groupby(["lat_round", "lon_round"]):
            sub_weather = weather_df[
                (weather_df["lat_round"] == la) &
                (weather_df["lon_round"] == lo)
            ].copy()

            if sub_weather.empty:
                parts.append(sub_fire)
                continue

            sub_fire = sub_fire.sort_values("datetime")
            sub_weather = sub_weather.sort_values("datetime")

            tmp = pd.merge_asof(
                sub_fire,
                sub_weather,
                on="datetime",
                direction="nearest",
                tolerance=pd.Timedelta(self.time_tolerance),
                suffixes=("", "_wx"),
            )
            parts.append(tmp)

        out = pd.concat(parts, ignore_index=True)
        return out
