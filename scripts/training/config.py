from dataclasses import dataclass

@dataclass
class TrainConfig:
    dataset_csv: str = "outputs/data/unified_with_weather.csv"
    output_dir: str = "outputs/models"
    test_size: float = 0.25
    random_state: int = 42
