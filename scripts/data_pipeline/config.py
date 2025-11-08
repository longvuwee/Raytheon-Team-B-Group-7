from dataclasses import dataclass

@dataclass
class DataBuildConfig:
    fire_csv: str
    perimeter_geojson: str
    weather_csv: str
    acre_threshold: int = 500
    spatial_precision: int = 2
    time_tolerance: str = "6h"
    output_path: str = "outputs/data/unified_training_dataset.csv"
