import os
import json
import numpy as np
import pandas as pd
import joblib

from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import accuracy_score, precision_score, recall_score, roc_auc_score
from sklearn.utils.class_weight import compute_class_weight

from training.config import TrainConfig

import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers


def main():
    cfg = TrainConfig()

    # 1. Load dataset (same one used for RF / LR, e.g. unified_with_weather.csv)
    print(f"Loading dataset from: {cfg.dataset_csv}")
    df = pd.read_csv(cfg.dataset_csv)

    if "spread_label" not in df.columns:
        raise ValueError("spread_label not found in dataset")

    y = df["spread_label"]

    # Use only numeric feature columns (drop label)
    X = df.drop(columns=["spread_label"])
    X = X.select_dtypes(include=[np.number])

    # Filter to binary labels {0, 1}
    mask = y.isin([0, 1])
    X = X[mask]
    y = y[mask]

    feature_cols = X.columns.tolist()

    # 2. Train/test split (same settings as trainer.py)
    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=cfg.test_size,
        random_state=cfg.random_state,
        stratify=y,
    )

    # 3. Scale features
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)

    # 4. Compute class weights to handle imbalance
    classes = np.unique(y_train)
    class_weights = compute_class_weight(
        class_weight="balanced",
        classes=classes,
        y=y_train,
    )
    class_weight_dict = {int(c): float(w) for c, w in zip(classes, class_weights)}
    print("Class weights used:", class_weight_dict)

    # 5. Build TensorFlow (Keras) model
    input_dim = X_train_scaled.shape[1]

    model = keras.Sequential([
        layers.Input(shape=(input_dim,)),
        layers.Dense(64, activation="relu"),
        layers.Dense(32, activation="relu"),
        layers.Dropout(0.3),
        layers.Dense(1, activation="sigmoid"),  # binary classification
    ])

    model.compile(
        optimizer="adam",
        loss="binary_crossentropy",
        metrics=[
            "accuracy",
            tf.keras.metrics.AUC(name="auc"),
            tf.keras.metrics.Precision(name="precision"),
            tf.keras.metrics.Recall(name="recall"),
        ],
    )

    # 6. Train with early stopping + class weights
    callbacks = [
        keras.callbacks.EarlyStopping(
            monitor="val_auc",
            mode="max",
            patience=5,
            restore_best_weights=True,
        )
    ]

    history = model.fit(
        X_train_scaled,
        y_train,
        validation_split=0.2,
        epochs=50,
        batch_size=64,
        callbacks=callbacks,
        class_weight=class_weight_dict,
        verbose=1,
    )

    # 7. Evaluate using sklearn metrics for direct comparison (default threshold = 0.5)
    y_proba = model.predict(X_test_scaled).ravel()
    y_pred_default = (y_proba >= 0.5).astype(int)

    metrics_default = {
        "threshold": 0.5,
        "accuracy": float(accuracy_score(y_test, y_pred_default)),
        "precision": float(precision_score(y_test, y_pred_default, zero_division=0)),
        "recall": float(recall_score(y_test, y_pred_default, zero_division=0)),
        "roc_auc": float(roc_auc_score(y_test, y_proba)),
    }

    print("\nTensorFlow NN metrics at threshold 0.5:")
    print(metrics_default)

    # 8. Small threshold sweep so you can see the tradeoff
    print("\nThreshold sweep (precision / recall):")
    thresholds = np.linspace(0.1, 0.9, 9)  # 0.1, 0.2, ..., 0.9
    sweep = []
    for t in thresholds:
        y_pred_t = (y_proba >= t).astype(int)
        acc = accuracy_score(y_test, y_pred_t)
        prec = precision_score(y_test, y_pred_t, zero_division=0)
        rec = recall_score(y_test, y_pred_t, zero_division=0)
        sweep.append({"threshold": float(t), "accuracy": float(acc),
                      "precision": float(prec), "recall": float(rec)})
        print(f"t={t:0.2f}  acc={acc:0.3f}  prec={prec:0.3f}  rec={rec:0.3f}")

    # 9. Save model, scaler, feature columns, and metrics
    os.makedirs(cfg.output_dir, exist_ok=True)

    model_path = os.path.join(cfg.output_dir, "tf_fire_spread_nn.keras")
    model.save(model_path)

    joblib.dump(scaler, os.path.join(cfg.output_dir, "tf_scaler.joblib"))
    joblib.dump(feature_cols, os.path.join(cfg.output_dir, "tf_feature_cols.joblib"))

    metrics = {
        "default_threshold_metrics": metrics_default,
        "threshold_sweep": sweep,
    }

    metrics_path = os.path.join(cfg.output_dir, "tf_nn_metrics.json")
    with open(metrics_path, "w") as f:
        json.dump(metrics, f, indent=2)

    print(f"\nSaved TF model to: {model_path}")
    print("Saved scaler to: outputs/models/tf_scaler.joblib")
    print("Saved feature cols to: outputs/models/tf_feature_cols.joblib")
    print(f"Saved metrics (including threshold sweep) to: {metrics_path}")


if __name__ == "__main__":
    main()
