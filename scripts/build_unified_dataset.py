from data_pipeline.config import DataBuildConfig
from data_pipeline.build_dataset import DatasetBuilder

if __name__ == "__main__":
    cfg = DataBuildConfig()  # or override paths if needed
    path = DatasetBuilder(cfg).run()
    print("Wrote unified dataset to:", path)
