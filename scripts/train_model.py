# scripts/fire_spread/train_model.py
# Fire Spread Probability — FIRMS + Fire Perimeters (GeoJSON or Shapefile compatible, Shapely-only)

import os
import argparse
import json
import struct
import numpy as np
import pandas as pd
from datetime import timedelta
from math import radians, sin, cos, sqrt, atan2
from shapely.geometry import Point, shape
from shapely.strtree import STRtree
from shapely import wkb

from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import classification_report, roc_auc_score, precision_recall_curve, fbeta_score
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.utils.class_weight import compute_class_weight
from joblib import dump


# --------------------------------
# Helper functions
# --------------------------------
def ensure_dirs():
    os.makedirs("outputs/models", exist_ok=True)
    os.makedirs("outputs/features", exist_ok=True)


def to_datetime(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["acq_time"] = df["acq_time"].astype(str).str.zfill(4)
    df["datetime"] = pd.to_datetime(
        df["acq_date"].astype(str)
        + " "
        + df["acq_time"].str[:2]
        + ":"
        + df["acq_time"].str[2:],
        errors="coerce",
    )
    return df.sort_values("datetime").reset_index(drop=True)


def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    phi1, phi2 = radians(lat1), radians(lat2)
    dphi = radians(lat2 - lat1)
    dl = radians(lon2 - lon1)
    a = sin(dphi / 2) ** 2 + cos(phi1) * cos(phi2) * sin(dl / 2) ** 2
    return 2 * R * atan2(sqrt(a), sqrt(1 - a))


def add_time_features(df):
    df = df.copy()
    dt = df["datetime"]
    df["hour"] = dt.dt.hour
    df["month"] = dt.dt.month
    df["dayofyear"] = dt.dt.dayofyear
    df["hour_sin"] = np.sin(2 * np.pi * df["hour"] / 24)
    df["hour_cos"] = np.cos(2 * np.pi * df["hour"] / 24)
    df["month_sin"] = np.sin(2 * np.pi * df["month"] / 12)
    df["month_cos"] = np.cos(2 * np.pi * df["month"] / 12)
    df["is_day"] = (df["daynight"].astype(str).str.upper() == "D").astype(int)
    return df


def add_intensity_deltas(df):
    df = df.copy()
    lat_bucket = (df["latitude"] * 10).round().astype(int)
    lon_bucket = (df["longitude"] * 10).round().astype(int)
    df["_key"] = lat_bucket.astype(str) + "_" + lon_bucket.astype(str)
    df = df.sort_values(["_key", "datetime"])
    df["brightness_delta_prev"] = df.groupby("_key")["brightness"].diff().fillna(0.0)
    df["t31_delta_prev"] = df.groupby("_key")["bright_t31"].diff().fillna(0.0)
    return df.drop(columns=["_key"]).sort_values("datetime").reset_index(drop=True)


def add_local_density(df, lookback_hours=24, radius_km=10):
    df = df.copy()
    lb = timedelta(hours=lookback_hours)
    density = np.zeros(len(df), dtype=int)
    for i in range(len(df)):
        lat1 = df.at[i, "latitude"]
        lon1 = df.at[i, "longitude"]
        t1 = df.at[i, "datetime"]
        j = i - 1
        c = 0
        while j >= 0:
            t2 = df.at[j, "datetime"]
            if t1 - t2 > lb:
                break
            if (
                haversine_km(lat1, lon1, df.at[j, "latitude"], df.at[j, "longitude"])
                <= radius_km
            ):
                c += 1
            j -= 1
        density[i] = c
    df["local_density"] = density
    return df


def time_split(df, test_size=0.2):
    df = df.sort_values("datetime")
    n = len(df)
    split = int(np.floor((1 - test_size) * n))
    return df.iloc[:split].copy(), df.iloc[split:].copy()


def threshold_sweep(y_true, proba, name, beta=0.5):
    print(f"\n-- Threshold sweep for {name} --")
    for thr in [0.5, 0.6, 0.7, 0.8]:
        preds = (proba >= thr).astype(int)
        tp = np.sum((preds == 1) & (y_true == 1))
        pp = max(np.sum(preds == 1), 1)
        p = tp / pp
        r = tp / max(np.sum(y_true == 1), 1)
        f = fbeta_score(y_true, preds, beta=beta)
        print(f"thr={thr:.2f}  precision={p:.3f}  recall={r:.3f}  F{beta}={f:.3f}")
    precision, recall, thresholds = precision_recall_curve(y_true, proba)
    best_thr, best_f = 0.5, -1.0
    for thr in thresholds:
        preds = (proba >= thr).astype(int)
        f = fbeta_score(y_true, preds, beta=beta)
        if f > best_f:
            best_f, best_thr = f, float(thr)
    print(f"Best threshold by F{beta}: {best_thr:.3f} (F{beta}={best_f:.3f})")
    return best_thr


# --------------------------------
# Perimeter loading (GeoJSON or Shapefile)
# --------------------------------
def load_perimeters_auto(path):
    """Load GeoJSON or Shapefile using only standard libs + shapely."""
    if not os.path.exists(path):
        raise FileNotFoundError(f"File not found: {path}")

    ext = os.path.splitext(path)[1].lower()

    # GeoJSON
    if ext in [".geojson", ".json"]:
        print(f"Loading GeoJSON perimeters: {path}")
        with open(path, "r") as f:
            text = f.read().strip()
        if not text.startswith("{"):
            raise ValueError("File exists but is not valid JSON — possibly empty or wrong file.")
        data = json.loads(text)

        geoms = []
        acres = []
        names = []
        for feat in data.get("features", []):
            try:
                geom = shape(feat["geometry"])
            except Exception:
                continue
            props = feat.get("properties", {}) or {}
            a = props.get("GIS_ACRES") or props.get("ACRES") or props.get("gis_acres") or np.nan
            try:
                a = float(a)
            except Exception:
                a = np.nan
            geoms.append(geom)
            names.append(str(props.get("FIRE_NAME", "")))
            acres.append(a)
        return geoms, acres, names

    # Shapefile (only geometry)
    elif ext == ".shp":
        print(f"Loading Shapefile perimeters: {path}")
        from shapefile import Reader  # install pyshp
        r = Reader(path)
        shapes = r.shapes()
        records = r.records()
        fields = [f[0] for f in r.fields[1:]]
        geoms, acres, names = [], [], []
        for i, s in enumerate(shapes):
            geom = shape(s.__geo_interface__)
            rec = dict(zip(fields, records[i]))
            a = rec.get("GIS_ACRES") or rec.get("ACRES") or np.nan
            try:
                a = float(a)
            except Exception:
                a = np.nan
            geoms.append(geom)
            names.append(str(rec.get("FIRE_NAME", "")))
            acres.append(a)
        return geoms, acres, names

    else:
        raise ValueError("Unsupported file type. Use .geojson or .shp")


def spatial_label_points_with_acres(firms_df, perim_path, acre_threshold=500):
    geoms, acres, names = load_perimeters_auto(perim_path)
    tree = STRtree(geoms)
    idx_map = {id(g): i for i, g in enumerate(geoms)}

    matched_acres = np.full(len(firms_df), np.nan)
    matched_names = np.array([""] * len(firms_df), dtype=object)

    for i, (lat, lon) in enumerate(zip(firms_df["latitude"], firms_df["longitude"])):
        pt = Point(lon, lat)
        cands = tree.query(pt)
        best_i, best_a = None, -1.0
        for c in cands:
            j = idx_map[id(c)]
            try:
                if c.covers(pt):
                    a = acres[j] if acres[j] == acres[j] else -1.0
                    if a > best_a:
                        best_a = a
                        best_i = j
            except Exception:
                continue
        if best_i is not None:
            matched_acres[i] = acres[best_i]
            matched_names[i] = names[best_i]

    out = firms_df.copy()
    out["perimeter_acres"] = matched_acres
    out["perimeter_name"] = matched_names
    out["spread_label"] = (out["perimeter_acres"].fillna(-1) >= acre_threshold).astype(int)
    return out


# --------------------------------
# Main
# --------------------------------
def main(args):
    ensure_dirs()

    df = pd.read_csv(args.csv)
    df = to_datetime(df)
    df = spatial_label_points_with_acres(df, args.perimeter_geojson, acre_threshold=args.acre_threshold)

    df = add_time_features(df)
    df = add_intensity_deltas(df)
    df = add_local_density(df, args.local_window_hours, args.local_radius_km)
    df = df.dropna(subset=["latitude", "longitude", "brightness", "bright_t31", "confidence", "datetime"])

    df.to_csv("outputs/features/firms_with_perimeter_labels.csv", index=False)
    print("Saved: outputs/features/firms_with_perimeter_labels.csv")
    print("Label distribution:", df["spread_label"].value_counts(normalize=True).round(3).to_dict())

    FEATURES_NUM = [
        "latitude", "longitude", "brightness", "bright_t31", "confidence",
        "hour", "month", "dayofyear", "hour_sin", "hour_cos", "month_sin", "month_cos",
        "brightness_delta_prev", "t31_delta_prev", "local_density", "is_day"
    ]
    FEATURES_CAT = ["daynight"]

    train_df, test_df = time_split(df, args.test_size)
    X_train, y_train = train_df[FEATURES_NUM + FEATURES_CAT], train_df["spread_label"].astype(int)
    X_test, y_test = test_df[FEATURES_NUM + FEATURES_CAT], test_df["spread_label"].astype(int)

    preprocess = ColumnTransformer([
        ("num", StandardScaler(), FEATURES_NUM),
        ("cat", OneHotEncoder(handle_unknown="ignore"), FEATURES_CAT)
    ])

    cw = compute_class_weight(class_weight="balanced", classes=np.array([0, 1]), y=y_train)
    cw_dict = {int(c): float(w) for c, w in zip([0, 1], cw)}
    print("Class weights:", cw_dict)

    models = {
        "Logistic Regression": Pipeline([
            ("prep", preprocess),
            ("clf", LogisticRegression(max_iter=2000, class_weight=cw_dict, solver="liblinear", random_state=42))
        ]),
        "Random Forest": Pipeline([
            ("prep", preprocess),
            ("clf", RandomForestClassifier(n_estimators=300, min_samples_split=4, min_samples_leaf=2,
                                          class_weight=cw_dict, n_jobs=-1, random_state=42))
        ])
    }

    for name, model in models.items():
        print(f"\n=== {name} ===")
        model.fit(X_train, y_train)
        proba = model.predict_proba(X_test)[:, 1]
        preds = (proba >= 0.5).astype(int)
        print("ROC AUC:", round(roc_auc_score(y_test, proba), 4))
        print(classification_report(y_test, preds, digits=3))
        thr = threshold_sweep(y_test, proba, name.split()[0], beta=0.5)
        dump(model, f"outputs/models/{name.replace(' ', '_').lower()}.joblib")

    print("✅ Training complete. Models saved to outputs/models/")



if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Train fire-spread probability model with real perimeters")
    p.add_argument("--csv", default="data/datasets/CleanedCaliData.csv")
    p.add_argument("--perimeter-geojson", required=True, help="Path to GeoJSON or Shapefile")
    p.add_argument("--acre-threshold", type=float, default=500)
    p.add_argument("--local-window-hours", type=int, default=24)
    p.add_argument("--local-radius-km", type=float, default=10)
    p.add_argument("--test-size", type=float, default=0.2)
    args = p.parse_args()
    main(args)
