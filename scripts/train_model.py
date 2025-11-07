import os
import argparse
import json
import joblib
import numpy as np
import pandas as pd
import geopandas as gpd
from shapely.geometry import Point

from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    classification_report,
    roc_auc_score,
    accuracy_score,
    precision_score,
    recall_score
)
from sklearn.utils.class_weight import compute_class_weight

# optional torch section
try:
    import torch
    import torch.nn as nn
    import torch.optim as optim
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False


# ---------------------------------------------------------------------
# 1. LOAD AND ALIGN DATASETS
# ---------------------------------------------------------------------
def load_base_fire_dataset(csv_path):
    """
    Expected to be something like your CleanedCaliData.csv or FIRMS-like file
    with at least: latitude, longitude, acquisition_date/time or datetime, plus
    your topo columns if you already added them.
    """
    df = pd.read_csv(csv_path)
    # try to create a unified datetime column
    # adjust these to match your real column names
    if "acq_date" in df.columns:
        df["acq_date"] = pd.to_datetime(df["acq_date"])
        if "acq_time" in df.columns:
            # FIRMS time is often HHMM
            df["acq_time"] = df["acq_time"].astype(str).str.zfill(4)
            df["datetime"] = pd.to_datetime(
                df["acq_date"].dt.strftime("%Y-%m-%d") + " " +
                df["acq_time"].str.slice(0, 2) + ":" +
                df["acq_time"].str.slice(2, 4),
                errors="coerce"
            )
        else:
            df["datetime"] = df["acq_date"]
    elif "datetime" in df.columns:
        df["datetime"] = pd.to_datetime(df["datetime"])
    else:
        # fallback: no datetime, just create one
        df["datetime"] = pd.Timestamp("2000-01-01")

    return df


def attach_perimeter_labels(df, perim_geojson_path, acre_threshold=500):
    """
    Spatially joins points to fire perimeters and creates spread_label.
    This is adapted from your original script.
    """
    gdf_points = gpd.GeoDataFrame(
        df.copy(),
        geometry=gpd.points_from_xy(df["longitude"], df["latitude"]),
        crs="EPSG:4326"
    )

    perims = gpd.read_file(perim_geojson_path)
    if perims.crs is None:
        # many CA fire perimeters come in EPSG:3310
        perims.set_crs(epsg=3310, inplace=True)
    if perims.crs.to_epsg() != 4326:
        perims = perims.to_crs(epsg=4326)

    joined = gpd.sjoin(gdf_points, perims, how="left", predicate="within")

    # find any acreage column
    acre_col = None
    for c in perims.columns:
        if "ACRES" in c.upper():
            acre_col = c
            break

    joined["spread_label"] = 0
    if acre_col is not None:
        joined["spread_label"] = (joined[acre_col].fillna(0) >= acre_threshold).astype(int)

    # drop geometry for ML
    joined = pd.DataFrame(joined.drop(columns=["geometry"]))
    return joined


def load_weather_csv(weather_csv_path):
    """
    Example: CaliDrought14to25.csv
    We will assume it has at least a date/datetime and some weather cols.
    We will make the column names generic: temp, humidity, wind_speed, precip.
    """
    w = pd.read_csv(weather_csv_path)
    # try several common names
    datetime_cols = ["datetime", "date", "DATE", "time", "timestamp"]
    used = None
    for c in datetime_cols:
        if c in w.columns:
            w["datetime"] = pd.to_datetime(w[c])
            used = c
            break
    if used is None:
        # fallback if there is no time info
        w["datetime"] = pd.Timestamp("2000-01-01")

    # normalize lat/lon names if present
    if "lat" in w.columns and "latitude" not in w.columns:
        w.rename(columns={"lat": "latitude"}, inplace=True)
    if "lon" in w.columns and "longitude" not in w.columns:
        w.rename(columns={"lon": "longitude"}, inplace=True)

    return w


def attach_weather_by_spatiotemporal_nearest(df, weather_df, time_tolerance="6h", spatial_precision=2):
    """
    Simple approach:
    - round lat/lon in both to N decimals
    - merge on rounded lat/lon
    - for each location, asof-merge on time to get closest weather record within tolerance
    """

    # make copies so we don't mutate caller
    df = df.copy()
    weather_df = weather_df.copy()

    # ensure both are the SAME dtype
    df["datetime"] = pd.to_datetime(df["datetime"]).astype("datetime64[ns]")
    weather_df["datetime"] = pd.to_datetime(weather_df["datetime"]).astype("datetime64[ns]")

    # round coordinates
    df["lat_round"] = df["latitude"].round(spatial_precision)
    df["lon_round"] = df["longitude"].round(spatial_precision)

    if "latitude" in weather_df.columns and "longitude" in weather_df.columns:
        weather_df["lat_round"] = weather_df["latitude"].round(spatial_precision)
        weather_df["lon_round"] = weather_df["longitude"].round(spatial_precision)
    else:
        # if weather has no spatial info, just give it the current point’s rounded coords
        weather_df["lat_round"] = df["lat_round"].iloc[0]
        weather_df["lon_round"] = df["lon_round"].iloc[0]

    merged_list = []

    for (la, lo), sub_fire in df.groupby(["lat_round", "lon_round"]):
        sub_weather = weather_df[
            (weather_df["lat_round"] == la) &
            (weather_df["lon_round"] == lo)
        ].copy()

        if sub_weather.empty:
            merged_list.append(sub_fire)
            continue

        sub_fire = sub_fire.sort_values("datetime")
        sub_weather = sub_weather.sort_values("datetime")

        # asof merge to nearest record within tolerance
        tmp = pd.merge_asof(
            sub_fire,
            sub_weather,
            on="datetime",
            direction="nearest",
            tolerance=pd.Timedelta(time_tolerance),
            suffixes=("", "_wx")
        )
        merged_list.append(tmp)

    out = pd.concat(merged_list, ignore_index=True)

    # optional: normalize common weather names
    rename_map = {}
    for c in out.columns:
        lc = c.lower()
        if "temp" in lc and "temp" not in rename_map:
            rename_map[c] = "temp"
        if ("humid" in lc or lc == "rh") and "humidity" not in rename_map:
            rename_map[c] = "humidity"
        if ("wind" in lc and "speed" in lc) and "wind_speed" not in rename_map:
            rename_map[c] = "wind_speed"
        if "precip" in lc and "precip" not in rename_map:
            rename_map[c] = "precip"
    out = out.rename(columns=rename_map)

    return out

    """
    Simple approach:
    - round lat/lon in both to N decimals
    - merge on rounded lat/lon
    - for each location, asof-merge on time to get closest weather record within tolerance
    This assumes weather_df has decent spatial coverage.
    """
    # round coordinates
    df["lat_round"] = df["latitude"].round(spatial_precision)
    df["lon_round"] = df["longitude"].round(spatial_precision)

    if "latitude" in weather_df.columns and "longitude" in weather_df.columns:
        weather_df["lat_round"] = weather_df["latitude"].round(spatial_precision)
        weather_df["lon_round"] = weather_df["longitude"].round(spatial_precision)
    else:
        # if weather has no spatial info, just duplicate cols later
        weather_df["lat_round"] = df["lat_round"].iloc[0]
        weather_df["lon_round"] = df["lon_round"].iloc[0]

    merged_list = []

    # group by rounded lat/lon for asof
    for (la, lo), sub_fire in df.groupby(["lat_round", "lon_round"]):
        sub_weather = weather_df[
            (weather_df["lat_round"] == la) &
            (weather_df["lon_round"] == lo)
        ].copy()

        if sub_weather.empty:
            # no weather for this cell, just fill NaNs later
            sub_fire = sub_fire.copy()
            merged_list.append(sub_fire)
            continue

        sub_fire = sub_fire.sort_values("datetime")
        sub_weather = sub_weather.sort_values("datetime")

        # asof merge to nearest past record
        tmp = pd.merge_asof(
            sub_fire,
            sub_weather,
            on="datetime",
            direction="nearest",
            tolerance=pd.Timedelta(time_tolerance),
            suffixes=("", "_wx")
        )
        merged_list.append(tmp)

    out = pd.concat(merged_list, ignore_index=True)

    # standardize expected weather column names
    rename_map = {}
    for c in out.columns:
        cu = c.lower()
        if "temp" in cu and "temp" not in rename_map:
            rename_map[c] = "temp"
        if ("humid" in cu or "rh" == cu) and "humidity" not in rename_map:
            rename_map[c] = "humidity"
        if ("wind" in cu and "speed" in cu) and "wind_speed" not in rename_map:
            rename_map[c] = "wind_speed"
        if "precip" in cu and "precip" not in rename_map:
            rename_map[c] = "precip"

    out = out.rename(columns=rename_map)

    return out


# ---------------------------------------------------------------------
# 2. BUILD FEATURE MATRIX
# ---------------------------------------------------------------------
def build_feature_matrix(df):
    # drop unused junk columns first
    drop_cols = [
        "OBJECTID","YEAR","STATE","AGENCY","UNIT_ID","FIRE_NAME","INC_NUM","ALARM_DATE",
        "CONT_DATE","CAUSE","C_METHOD","OBJECTIVE","GIS_ACRES","COMMENTS","COMPLEX_NAME",
        "IRWINID","FIRE_NUM","COMPLEX_ID","DECADES","lat_round","lon_round",
        "lat_round_wx","lon_round_wx","indexright","MapDate","StateAbbreviation","None",
        "ValidStart","ValidEnd","StatisticFormatID"
    ]
    df = df.drop(columns=[c for c in drop_cols if c in df.columns], errors="ignore")

    # create month from acq_date if present
    if "acq_date" in df.columns:
        df["month"] = pd.to_datetime(df["acq_date"], errors="coerce").dt.month.fillna(0)

    feature_cols = [
        "latitude","longitude","brightness","bright_t31","confidence",
        "daynight","elevation","slope","aspect","temp","humidity",
        "wind_speed","precip","month"
    ]

    for c in feature_cols:
        if c not in df.columns:
            df[c] = 0.0

    # Convert categorical day/night
    if df["daynight"].dtype == object:
        df["daynight"] = (df["daynight"].str.lower() == "d").astype(int)

    X = df[feature_cols].astype(float).fillna(0.0)
    y = df["spread_label"].astype(int)

    return X, y, feature_cols

    """
    Pick out the columns we care about. If a column is missing, create it.
    """
    feature_cols = [
        # fire/FIRMS
        "brightness",
        "confidence",
        "bright_t31",
        "latitude",
        "longitude",
        # topo that might already be in your CSV
        "elevation",
        "slope",
        "aspect",
        # weather
        "temp",
        "humidity",
        "wind_speed",
        "precip",
    ]

    for c in feature_cols:
        if c not in df.columns:
            df[c] = 0.0

    X = df[feature_cols].astype(float).fillna(0.0)
    y = df["spread_label"].astype(int)

    return X, y, feature_cols


# ---------------------------------------------------------------------
# 3. MODEL TRAINING
# ---------------------------------------------------------------------
def train_sklearn_models(X_train, X_test, y_train, y_test, feature_cols, out_dir):
    # handle imbalance
    class_weights = compute_class_weight(
        class_weight="balanced",
        classes=np.unique(y_train),
        y=y_train
    )
    cw_dict = dict(zip(np.unique(y_train), class_weights))

    # scaler for LR and NN
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)

    # Logistic Regression
    lr = LogisticRegression(max_iter=2000, class_weight=cw_dict)
    lr.fit(X_train_scaled, y_train)
    y_pred_lr = lr.predict(X_test_scaled)
    y_proba_lr = lr.predict_proba(X_test_scaled)[:, 1]
    lr_metrics = {
        "accuracy": accuracy_score(y_test, y_pred_lr),
        "precision": precision_score(y_test, y_pred_lr, zero_division=0),
        "recall": recall_score(y_test, y_pred_lr, zero_division=0),
        "roc_auc": roc_auc_score(y_test, y_proba_lr),
        "report": classification_report(y_test, y_pred_lr, output_dict=True),
    }

    # Random Forest
    rf = RandomForestClassifier(
        n_estimators=300,
        random_state=42,
        class_weight=cw_dict,
        n_jobs=-1
    )
    rf.fit(X_train, y_train)
    y_pred_rf = rf.predict(X_test)
    y_proba_rf = rf.predict_proba(X_test)[:, 1]
    rf_metrics = {
        "accuracy": accuracy_score(y_test, y_pred_rf),
        "precision": precision_score(y_test, y_pred_rf, zero_division=0),
        "recall": recall_score(y_test, y_pred_rf, zero_division=0),
        "roc_auc": roc_auc_score(y_test, y_proba_rf),
        "report": classification_report(y_test, y_pred_rf, output_dict=True),
    }

    # save models
    os.makedirs(out_dir, exist_ok=True)
    joblib.dump(lr, os.path.join(out_dir, "logreg.joblib"))
    joblib.dump(rf, os.path.join(out_dir, "random_forest.joblib"))
    joblib.dump(scaler, os.path.join(out_dir, "scaler.joblib"))
    joblib.dump(feature_cols, os.path.join(out_dir, "feature_cols.joblib"))

    return lr_metrics, rf_metrics


def train_pytorch_model(X_train_scaled, X_test_scaled, y_train, y_test, out_dir, epochs=50, lr=1e-3):
    if not TORCH_AVAILABLE:
        return {"error": "torch not installed"}

    X_train_t = torch.tensor(X_train_scaled, dtype=torch.float32)
    y_train_t = torch.tensor(y_train.values, dtype=torch.float32).view(-1, 1)
    X_test_t = torch.tensor(X_test_scaled, dtype=torch.float32)
    y_test_t = torch.tensor(y_test.values, dtype=torch.float32).view(-1, 1)

    input_dim = X_train_scaled.shape[1]

    class MLP(nn.Module):
        def __init__(self, in_dim):
            super().__init__()
            self.net = nn.Sequential(
                nn.Linear(in_dim, 64),
                nn.ReLU(),
                nn.Linear(64, 32),
                nn.ReLU(),
                nn.Linear(32, 1),
                nn.Sigmoid()
            )

        def forward(self, x):
            return self.net(x)

    model = MLP(input_dim)
    criterion = nn.BCELoss()
    optimizer = optim.Adam(model.parameters(), lr=lr)

    model.train()
    for epoch in range(epochs):
        optimizer.zero_grad()
        outputs = model(X_train_t)
        loss = criterion(outputs, y_train_t)
        loss.backward()
        optimizer.step()

    model.eval()
    with torch.no_grad():
        preds = model(X_test_t)
    y_proba = preds.numpy().flatten()
    y_pred = (y_proba >= 0.5).astype(int)

    metrics = {
        "accuracy": accuracy_score(y_test, y_pred),
        "precision": precision_score(y_test, y_pred, zero_division=0),
        "recall": recall_score(y_test, y_pred, zero_division=0),
        "roc_auc": roc_auc_score(y_test, y_proba),
        "report": classification_report(y_test, y_pred, output_dict=True),
    }

    os.makedirs(out_dir, exist_ok=True)
    torch.save(model.state_dict(), os.path.join(out_dir, "pytorch_nn.pt"))

    return metrics


# ---------------------------------------------------------------------
# 4. MAIN
# ---------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fire-csv", required=True, help="Cleaned fire/FIRMS/topo CSV, e.g. CleanedCaliData.csv")
    parser.add_argument("--perimeter-geojson", required=True, help="Fire perimeter file, e.g. California_Historic_Fire_Perimeters.geojson")
    parser.add_argument("--weather-csv", required=True, help="Historical weather CSV, e.g. CaliDrought14to25.csv")
    parser.add_argument("--acre-threshold", type=int, default=500)
    parser.add_argument("--output-dir", default="outputs")
    args = parser.parse_args()

    # 1) load main fire dataset
    base_df = load_base_fire_dataset(args.fire_csv)

    # 2) attach perimeter labels
    labeled_df = attach_perimeter_labels(base_df, args.perimeter_geojson, acre_threshold=args.acre_threshold)

    # 3) load weather and attach
    weather_df = load_weather_csv(args.weather_csv)
    unified_df = attach_weather_by_spatiotemporal_nearest(labeled_df, weather_df)

    # 4) build feature matrix
    X, y, feature_cols = build_feature_matrix(unified_df)

    # filter rows without labels
    mask = y.isin([0, 1])
    X = X[mask]
    y = y[mask]

    # 5) train/test split
    X_train, X_test, y_train, y_test = train_test_split(
        X, y,
        test_size=0.25,
        random_state=42,
        stratify=y
    )

    # 6) sklearn models
    models_dir = os.path.join(args.output_dir, "models")
    lr_metrics, rf_metrics = train_sklearn_models(X_train, X_test, y_train, y_test, feature_cols, models_dir)

    # 7) PyTorch model (on scaled features)
    scaler = joblib.load(os.path.join(models_dir, "scaler.joblib"))
    X_train_scaled = scaler.transform(X_train)
    X_test_scaled = scaler.transform(X_test)
    torch_metrics = train_pytorch_model(X_train_scaled, X_test_scaled, y_train, y_test, models_dir)

    # 8) save metrics
    metrics = {
        "logistic_regression": lr_metrics,
        "random_forest": rf_metrics,
        "pytorch_nn": torch_metrics,
    }
    os.makedirs(args.output_dir, exist_ok=True)
    with open(os.path.join(args.output_dir, "metrics.json"), "w") as f:
        json.dump(metrics, f, indent=2)

    # also save the unified dataset we actually trained on
    unified_path = os.path.join(args.output_dir, "unified_training_dataset.csv")
    unified_df.to_csv(unified_path, index=False)


if __name__ == "__main__":
    main()
