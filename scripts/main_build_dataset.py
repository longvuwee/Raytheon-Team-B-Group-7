import argparse
from data_pipeline.config import DataBuildConfig
from data_pipeline.build_dataset import DatasetBuilder

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--fire-csv", required=True)
    p.add_argument("--perimeter-geojson", required=True)
    p.add_argument("--weather-csv", required=True)
    p.add_argument("--output-path", default="outputs/data/unified_training_dataset.csv")
    p.add_argument("--acre-threshold", type=int, default=500)
    return p.parse_args()

if __name__ == "__main__":
    args = parse_args()
    cfg = DataBuildConfig(
        fire_csv=args.fire_csv,
        perimeter_geojson=args.perimeter_geojson,
        weather_csv=args.weather_csv,
        output_path=args.output_path,
        acre_threshold=args.acre_threshold,
    )
    DatasetBuilder(cfg).run()
