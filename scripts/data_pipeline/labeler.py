import pandas as pd
import geopandas as gpd

class PerimeterLabeler:
    def __init__(self, perim_path: str, acre_threshold: int = 500):
        self.perim_path = perim_path
        self.acre_threshold = acre_threshold

    def label(self, df: pd.DataFrame) -> pd.DataFrame:
        gdf_points = gpd.GeoDataFrame(
            df.copy(),
            geometry=gpd.points_from_xy(df["longitude"], df["latitude"]),
            crs="EPSG:4326"
        )

        perims = gpd.read_file(self.perim_path)
        if perims.crs is None:
            perims.set_crs(epsg=3310, inplace=True)
        if perims.crs.to_epsg() != 4326:
            perims = perims.to_crs(epsg=4326)

        joined = gpd.sjoin(gdf_points, perims, how="left", predicate="within")

        acre_col = None
        for c in perims.columns:
            if "ACRES" in c.upper():
                acre_col = c
                break

        joined["spread_label"] = 0
        if acre_col is not None:
            joined["spread_label"] = (
                joined[acre_col].fillna(0) >= self.acre_threshold
            ).astype(int)

        return pd.DataFrame(joined.drop(columns=["geometry"]))
