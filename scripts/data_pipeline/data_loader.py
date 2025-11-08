import pandas as pd

class FireDataLoader:
    def __init__(self, fire_csv: str):
        self.fire_csv = fire_csv

    def load(self) -> pd.DataFrame:
        df = pd.read_csv(self.fire_csv)
        if "acq_date" in df.columns:
            df["acq_date"] = pd.to_datetime(df["acq_date"])
            if "acq_time" in df.columns:
                df["acq_time"] = df["acq_time"].astype(str).str.zfill(4)
                df["datetime"] = pd.to_datetime(
                    df["acq_date"].dt.strftime("%Y-%m-%d") + " " +
                    df["acq_time"].str[:2] + ":" + df["acq_time"].str[2:],
                    errors="coerce"
                )
            else:
                df["datetime"] = df["acq_date"]
        elif "datetime" in df.columns:
            df["datetime"] = pd.to_datetime(df["datetime"])
        else:
            df["datetime"] = pd.Timestamp("2000-01-01")
        return df
