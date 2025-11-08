import pandas as pd

class FeatureNormalizer:
    DROP_COLS = [
        "lat_round", "lon_round", "indexright"
    ]

    def clean(self, df: pd.DataFrame) -> pd.DataFrame:
        return df.drop(columns=[c for c in self.DROP_COLS if c in df.columns], errors="ignore")
