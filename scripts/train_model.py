import os
import json
import argparse
import joblib
import numpy as np
import pandas as pd
import geopandas as gpd
from shapely.geometry import Point
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report, roc_auc_score
from sklearn.utils.class_weight import compute_class_weight

# -----------------------------------------------------------
# STEP 1 — Spatial Join with Automatic CRS Handling
# -----------------------------------------------------------
def spatial_label_points_with_acres(csv_path, perim_geojson_path, acre_threshold=500):
    print(f"\n📂 Loading FIRMS data from: {csv_path}")
    df = pd.read_csv(csv_path)

    # Convert FIRMS detections into GeoDataFrame (EPSG:4326)
    firms_gdf = gpd.GeoDataFrame(
        df,
        geometry=gpd.points_from_xy(df["longitude"], df["latitude"]),
        crs="EPSG:4326"
    )
    print(f"✅ Loaded {len(firms_gdf)} FIRMS detections.")

    print(f"\n🔥 Loading CAL FIRE perimeters: {perim_geojson_path}")
    perims = gpd.read_file(perim_geojson_path)

    # Detect and reproject CRS if necessary
    if perims.crs is None:
        print("⚠️ No CRS detected in perimeters — assuming EPSG:3310 (California Albers).")
        perims.set_crs(epsg=3310, inplace=True)

    if perims.crs.to_epsg() != 4326:
        print(f"♻️ Reprojecting perimeters from {perims.crs} → EPSG:4326 ...")
        perims = perims.to_crs(epsg=4326)

    print(f"✅ CRS check complete — Perimeters: {perims.crs}, FIRMS: {firms_gdf.crs}")

    # Spatial join (each FIRMS point gets perimeter info)
    joined = gpd.sjoin(firms_gdf, perims, how="left", predicate="within")
    matched = joined["index_right"].notna().sum()
    print(f"🔍 Matched FIRMS detections to perimeters: {matched}/{len(joined)} "
          f"({matched/len(joined)*100:.2f}%)")

    # Identify acreage column
    acre_col = None
    for c in perims.columns:
        if "GIS_ACRES" in c.upper() or "ACRES" in c.upper():
            acre_col = c
            break

    # Assign spread labels
    joined["spread_label"] = 0
    if acre_col:
        joined["spread_label"] = (
            joined[acre_col].fillna(0) >= acre_threshold
        ).astype(int)
        print(f"✅ Using '{acre_col}' for labeling (≥ {acre_threshold} acres = spread).")
    else:
        print("⚠️ No acreage column found — labeling skipped.")

    # Save labeled FIRMS data
    os.makedirs("outputs/features", exist_ok=True)
    joined.to_csv("outputs/features/firms_with_perimeter_labels.csv", index=False)
    print("💾 Saved: outputs/features/firms_with_perimeter_labels.csv")

    # Label distribution check
    dist = joined["spread_label"].value_counts(normalize=True).to_dict()
    print("📊 Label distribution:", dist)

    return joined


# -----------------------------------------------------------
# STEP 2 — Model Training
# -----------------------------------------------------------
def train_and_evaluate(df):
    print("\n🚀 Training fire spread prediction models...")

    # Select numeric columns for ML
    features = ["brightness", "confidence", "bright_t31"]
    X = df[features].fillna(0)
    y = df["spread_label"]

    if y.nunique() < 2:
        raise ValueError("Only one class present — spatial join may have failed (all 0s).")

    # Train/test split
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.25, random_state=42, stratify=y
    )

    # Normalize
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)

    # Compute class weights
    cw = compute_class_weight(class_weight="balanced", classes=np.unique(y_train), y=y_train)
    cw_dict = dict(zip(np.unique(y_train), cw))
    print("⚖️ Class weights:", cw_dict)

    # Logistic Regression
    lr = LogisticRegression(max_iter=1000, class_weight=cw_dict)
    lr.fit(X_train_scaled, y_train)
    y_pred_lr = lr.predict(X_test_scaled)
    y_proba_lr = lr.predict_proba(X_test_scaled)[:, 1]
    print("\n=== Logistic Regression ===")
    print("ROC AUC:", roc_auc_score(y_test, y_proba_lr))
    print(classification_report(y_test, y_pred_lr))

    # Random Forest
    rf = RandomForestClassifier(
        n_estimators=200, random_state=42, class_weight=cw_dict, n_jobs=-1
    )
    rf.fit(X_train, y_train)
    y_pred_rf = rf.predict(X_test)
    y_proba_rf = rf.predict_proba(X_test)[:, 1]
    print("\n=== Random Forest ===")
    print("ROC AUC:", roc_auc_score(y_test, y_proba_rf))
    print(classification_report(y_test, y_pred_rf))

    # Save models
    os.makedirs("outputs/models", exist_ok=True)
    joblib.dump(lr, "outputs/models/fire_spread_model_lr.joblib")
    joblib.dump(rf, "outputs/models/fire_spread_model_rf.joblib")
    print("\n💾 Saved trained models to outputs/models/")

    return rf, lr


# -----------------------------------------------------------
# STEP 3 — Main Entry Point
# -----------------------------------------------------------
def main(args):
    df = spatial_label_points_with_acres(
        args.csv, args.perimeter_geojson, acre_threshold=args.acre_threshold
    )
    train_and_evaluate(df)


# -----------------------------------------------------------
# STEP 4 — CLI
# -----------------------------------------------------------
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train Fire Spread Prediction Model (FIRMS + CAL FIRE)")
    parser.add_argument("--csv", type=str, required=True, help="Path to FIRMS CleanedCaliData.csv")
    parser.add_argument("--perimeter-geojson", type=str, required=True, help="Path to CAL FIRE perimeter GeoJSON")
    parser.add_argument("--acre-threshold", type=int, default=500, help="Minimum acres to label as spreading")
    args = parser.parse_args()
    main(args)
