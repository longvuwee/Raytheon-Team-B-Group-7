import os
import json
import joblib
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.utils.class_weight import compute_class_weight
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    roc_auc_score,
    classification_report,
)

class ModelTrainer:
    def __init__(self, cfg):
        self.cfg = cfg

    def load_dataset(self):
        df = pd.read_csv(self.cfg.dataset_csv)
        if "spread_label" not in df.columns:
            raise ValueError("spread_label not found in dataset")
        y = df["spread_label"].astype(int)
        X = df.drop(columns=["spread_label"])
        # drop non numeric quietly
        X = X.select_dtypes(include=["number"]).fillna(0.0)
        return X, y

    def train(self):
        X, y = self.load_dataset()

        mask = y.isin([0, 1])
        X, y = X[mask], y[mask]

        X_train, X_test, y_train, y_test = train_test_split(
            X, y,
            test_size=self.cfg.test_size,
            random_state=self.cfg.random_state,
            stratify=y
        )

        class_weights = compute_class_weight(
            class_weight="balanced",
            classes=np.unique(y_train),
            y=y_train
        )
        cw_dict = dict(zip(np.unique(y_train), class_weights))

        scaler = StandardScaler()
        X_train_scaled = scaler.fit_transform(X_train)
        X_test_scaled = scaler.transform(X_test)

        lr = LogisticRegression(max_iter=2000, class_weight=cw_dict)
        lr.fit(X_train_scaled, y_train)
        y_pred_lr = lr.predict(X_test_scaled)
        y_proba_lr = lr.predict_proba(X_test_scaled)[:, 1]

        lr_metrics = {
            "accuracy": accuracy_score(y_test, y_pred_lr),
            "precision": precision_score(y_test, y_pred_lr, zero_division=0),
            "recall": recall_score(y_test, y_pred_lr, zero_division=0),
            "roc_auc": roc_auc_score(y_test, y_proba_lr),
        }

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
        }

        os.makedirs(self.cfg.output_dir, exist_ok=True)
        joblib.dump(lr, os.path.join(self.cfg.output_dir, "logreg.joblib"))
        joblib.dump(rf, os.path.join(self.cfg.output_dir, "random_forest.joblib"))
        joblib.dump(scaler, os.path.join(self.cfg.output_dir, "scaler.joblib"))
        joblib.dump(list(X.columns), os.path.join(self.cfg.output_dir, "feature_cols.joblib"))

        with open(os.path.join(self.cfg.output_dir, "metrics.json"), "w") as f:
            json.dump(
                {"logistic_regression": lr_metrics, "random_forest": rf_metrics},
                f,
                indent=2
            )
