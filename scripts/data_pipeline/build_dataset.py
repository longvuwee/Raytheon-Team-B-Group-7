import os
from .config import DataBuildConfig
from .data_loader import FireDataLoader
from .labeler import PerimeterLabeler
from .weather import WeatherLoader, WeatherAttacher
from .features import FeatureNormalizer

class DatasetBuilder:
    def __init__(self, cfg: DataBuildConfig):
        self.cfg = cfg

    def run(self):
        fire_df = FireDataLoader(self.cfg.fire_csv).load()
        labeled_df = PerimeterLabeler(
            self.cfg.perimeter_geojson,
            self.cfg.acre_threshold
        ).label(fire_df)

        weather_df = WeatherLoader(self.cfg.weather_csv).load()
        unified_df = WeatherAttacher(
            time_tolerance=self.cfg.time_tolerance,
            spatial_precision=self.cfg.spatial_precision
        ).attach(labeled_df, weather_df)

        unified_df = FeatureNormalizer().clean(unified_df)

        os.makedirs(os.path.dirname(self.cfg.output_path), exist_ok=True)
        unified_df.to_csv(self.cfg.output_path, index=False)
        return self.cfg.output_path
