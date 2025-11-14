import os
import pandas as pd
import joblib

from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score
from sklearn.inspection import permutation_importance

# Import your training config so we use the SAME dataset and split settings
from training.config import TrainConfig

def main():
    cfg = TrainConfig()

    # 1. Load the dataset used for training (e.g., unified_with_weather.csv)
    print(f"Loading dataset from: {cfg.dataset_csv}")
    df = pd.read_csv(cfg.dataset_csv)

    if "spread_label" not in df.columns:
        raise ValueError("spread_label not found in dataset; cannot compute feature importance.")

    # 2. Separate features and labels
    y = df["spread_label"]
    # You already saved feature_cols during training; use those to select X
    feature_cols = joblib.load("outputs/models/feature_cols.joblib")
    X = df[feature_cols]

    # 3. Train/test split identical to trainer.py
    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=cfg.test_size,
        random_state=cfg.random_state,
        stratify=y,
    )

    # 4. Load models and scaler
    rf = joblib.load("outputs/models/random_forest.joblib")
    logreg = joblib.load("outputs/models/logreg.joblib")
    scaler = joblib.load("outputs/models/scaler.joblib")

    # For logistic regression, we need scaled features
    X_train_scaled = scaler.transform(X_train)
    X_test_scaled = scaler.transform(X_test)

    # 5. Quick sanity check: base ROC AUC
    y_proba_rf = rf.predict_proba(X_test)[:, 1]
    y_proba_lr = logreg.predict_proba(X_test_scaled)[:, 1]

    print("Base ROC AUC (Random Forest):", roc_auc_score(y_test, y_proba_rf))
    print("Base ROC AUC (Logistic Reg.):", roc_auc_score(y_test, y_proba_lr))

    # 6. Permutation importance for Random Forest
    print("\nComputing permutation importance for Random Forest...")
    rf_imp = permutation_importance(
        rf,
        X_test,
        y_test,
        n_repeats=10,
        scoring="roc_auc",
        random_state=cfg.random_state,
        n_jobs=-1,
    )

    rf_df = pd.DataFrame({
        "feature": feature_cols,
        "rf_importance_mean": rf_imp.importances_mean,
        "rf_importance_std": rf_imp.importances_std,
    }).sort_values("rf_importance_mean", ascending=False)

    # 7. Permutation importance for Logistic Regression
    print("Computing permutation importance for Logistic Regression...")
    lr_imp = permutation_importance(
        logreg,
        X_test_scaled,
        y_test,
        n_repeats=10,
        scoring="roc_auc",
        random_state=cfg.random_state,
        n_jobs=-1,
    )

    lr_df = pd.DataFrame({
        "feature": feature_cols,
        "lr_importance_mean": lr_imp.importances_mean,
        "lr_importance_std": lr_imp.importances_std,
    }).sort_values("lr_importance_mean", ascending=False)

    # 8. Print top 15 for each
    print("\nTop 15 features (Random Forest, permutation importance):")
    print(rf_df.head(15))

    print("\nTop 15 features (Logistic Regression, permutation importance):")
    print(lr_df.head(15))

    # 9. Save to CSV for inspection
    os.makedirs("outputs/features", exist_ok=True)
    rf_out = "outputs/features/rf_permutation_importance.csv"
    lr_out = "outputs/features/lr_permutation_importance.csv"
    rf_df.to_csv(rf_out, index=False)
    lr_df.to_csv(lr_out, index=False)

    print(f"\nSaved RF permutation importance to: {rf_out}")
    print(f"Saved LR permutation importance to: {lr_out}")

if __name__ == "__main__":
    main()
