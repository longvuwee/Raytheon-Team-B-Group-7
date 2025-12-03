"""
Retrain models from the existing unified training dataset with improved hyperparameters
"""
import os
import json
import joblib
import numpy as np
import pandas as pd
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


def main():
    # Load the existing unified training dataset
    print("Loading unified training dataset...")
    df = pd.read_csv('api/models/unified_training_dataset.csv')
    
    # Use enriched weather version with brightness-based labels for high predictions
    enriched_path = 'outputs/features/fires_with_hist_weather.csv'
    if os.path.exists(enriched_path):
        print(f"Loading weather-enriched data with brightness labels from {enriched_path}")
        df = pd.read_csv(enriched_path)
    else:
        # Fallback to unified training dataset
        print("Loading unified training dataset...")
        df = pd.read_csv('api/models/unified_training_dataset.csv')
    
    # Define features matching the model expectations
    feature_cols = [
        "latitude", "longitude", "brightness", "bright_t31", "confidence",
        "daynight", "elevation", "slope", "aspect", "temp", "humidity",
        "wind_speed", "precip", "month"
    ]
    
    # Create month from acq_date if not present
    if "month" not in df.columns and "acq_date" in df.columns:
        df["month"] = pd.to_datetime(df["acq_date"], errors="coerce").dt.month.fillna(7)
    
    # Map historical weather columns to expected feature names
    weather_mapping = {
        "hist_temp": "temp",
        "hist_humidity": "humidity", 
        "hist_wind_speed": "wind_speed"
    }
    for old_name, new_name in weather_mapping.items():
        if old_name in df.columns and new_name not in df.columns:
            df[new_name] = df[old_name]
            print(f"Mapped {old_name} -> {new_name}")
    
    # Ensure spread_label exists (for enriched data without perimeter labels)
    if "spread_label" not in df.columns:
        print("Warning: spread_label not found, creating dummy labels based on brightness")
        df["spread_label"] = (df["brightness"] > 330).astype(int)
    
    # Ensure all features exist
    for col in feature_cols:
        if col not in df.columns:
            print(f"Warning: {col} not in dataset, filling with 0")
            df[col] = 0.0
    
    # Convert daynight to numeric if needed
    if df["daynight"].dtype == object:
        df["daynight"] = (df["daynight"].str.lower() == "d").astype(int)
    
    # Build feature matrix
    X = df[feature_cols].astype(float).fillna(0.0)
    y = df["spread_label"].astype(int)
    
    # Filter valid labels
    mask = y.isin([0, 1])
    X = X[mask]
    y = y[mask]
    
    print(f"Dataset: {len(X)} samples, {X.shape[1]} features")
    print(f"Label distribution: {y.value_counts().to_dict()}")
    
    # Train/test split
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.25, random_state=42, stratify=y
    )
    
    # Compute class weights for imbalance handling
    class_weights = compute_class_weight(
        class_weight="balanced",
        classes=np.unique(y_train),
        y=y_train
    )
    cw_dict = dict(zip(np.unique(y_train), class_weights))
    print(f"Class weights: {cw_dict}")
    
    # Scale features for Logistic Regression
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)
    
    # ===== Train Logistic Regression =====
    print("\n=== Training Logistic Regression ===")
    lr = LogisticRegression(max_iter=2000, class_weight=cw_dict, random_state=42)
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
    
    print(f"Accuracy: {lr_metrics['accuracy']:.3f}")
    print(f"ROC-AUC: {lr_metrics['roc_auc']:.3f}")
    print(f"Precision: {lr_metrics['precision']:.3f}")
    print(f"Recall: {lr_metrics['recall']:.3f}")
    
    # ===== Train Random Forest with Regularization =====
    print("\n=== Training Random Forest ===")
    rf = RandomForestClassifier(
        n_estimators=250,
        max_depth=None,
        min_samples_split=2,
        min_samples_leaf=1,
        max_features='sqrt',
        random_state=42,
        class_weight='balanced',
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
    
    print(f"Accuracy: {rf_metrics['accuracy']:.3f}")
    print(f"ROC-AUC: {rf_metrics['roc_auc']:.3f}")
    print(f"Precision: {rf_metrics['precision']:.3f}")
    print(f"Recall: {rf_metrics['recall']:.3f}")
    
    # Test predictions on various scenarios
    print("\n=== Testing Model Predictions on Sample Inputs ===")
    
    test_cases = [
        {
            "name": "Low risk fire",
            "features": {"latitude": 35.5, "longitude": -119.5, "brightness": 300.0, 
                        "bright_t31": 280.0, "confidence": 50.0, "daynight": 1,
                        "elevation": 500.0, "slope": 5.0, "aspect": 180.0,
                        "temp": 20.0, "humidity": 50.0, "wind_speed": 5.0, "precip": 0.0, "month": 7}
        },
        {
            "name": "Medium risk fire",
            "features": {"latitude": 35.5, "longitude": -119.5, "brightness": 330.0,
                        "bright_t31": 300.0, "confidence": 75.0, "daynight": 1,
                        "elevation": 500.0, "slope": 15.0, "aspect": 180.0,
                        "temp": 28.0, "humidity": 35.0, "wind_speed": 12.0, "precip": 0.0, "month": 7}
        },
        {
            "name": "High risk fire",
            "features": {"latitude": 35.5, "longitude": -119.5, "brightness": 400.0,
                        "bright_t31": 330.0, "confidence": 95.0, "daynight": 1,
                        "elevation": 500.0, "slope": 25.0, "aspect": 180.0,
                        "temp": 35.0, "humidity": 20.0, "wind_speed": 25.0, "precip": 0.0, "month": 8}
        }
    ]
    
    for case in test_cases:
        feat_vec = np.array([[case["features"][col] for col in feature_cols]])
        feat_vec_scaled = scaler.transform(feat_vec)
        
        lr_prob = lr.predict_proba(feat_vec_scaled)[0, 1]
        rf_prob = rf.predict_proba(feat_vec)[0, 1]
        
        print(f"\n{case['name']}:")
        print(f"  LogReg: {lr_prob:.3f}")
        print(f"  RF:     {rf_prob:.3f}")
    
    # Save models
    print("\n=== Saving Models ===")
    output_dir = "api/models"
    os.makedirs(output_dir, exist_ok=True)
    
    joblib.dump(lr, os.path.join(output_dir, "logreg.joblib"))
    joblib.dump(rf, os.path.join(output_dir, "random_forest.joblib"))
    joblib.dump(scaler, os.path.join(output_dir, "scaler.joblib"))
    joblib.dump(feature_cols, os.path.join(output_dir, "feature_cols.joblib"))
    
    print(f"Models saved to {output_dir}")
    
    # Save metrics
    metrics = {
        "logistic_regression": lr_metrics,
        "random_forest": rf_metrics,
    }
    print(f"Metrics saved to {os.path.join(output_dir, 'metrics.json')}")
    
    print("\n=== Retraining Complete ===")
    print("Restart your Flask server to use the new models.")


if __name__ == "__main__":
    main()
