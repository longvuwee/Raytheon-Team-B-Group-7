import argparse
from training.config import TrainConfig
from training.trainer import ModelTrainer

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--dataset-csv", default="outputs/data/unified_with_weather.csv")
    p.add_argument("--output-dir", default="outputs/models")
    return p.parse_args()

if __name__ == "__main__":
    args = parse_args()
    cfg = TrainConfig(
        dataset_csv=args.dataset_csv,
        output_dir=args.output_dir,
    )
    ModelTrainer(cfg).train()
