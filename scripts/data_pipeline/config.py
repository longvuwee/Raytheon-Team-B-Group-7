from dataclasses import dataclass

@dataclass
class DataBuildConfig:
    fire_csv: str = "data/datasets/CaliforniaFireModis20_21.csv"
    perimeter_geojson: str = "data/datasets/California_Historic_Fire_Perimeters.geojson"
    weather_csv: str = "data/datasets/<YOUR_WEATHER_DATA>.csv"
    acre_threshold: int = 500
    spatial_precision: int = 2
    time_tolerance: str = "6h"
    output_path: str = "outputs/data/unified_training_dataset.csv"
