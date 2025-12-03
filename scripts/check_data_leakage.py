"""
Check for data leakage in the fire spread model
"""
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score

# Load data
df = pd.read_csv('outputs/features/fires_with_hist_weather.csv')

# Create labels the same way as training
df['spread_label'] = (df['brightness'] > 330).astype(int)

print("=== DATA LEAKAGE INVESTIGATION ===\n")
print(f"Total samples: {len(df)}")
print(f"\nLabel creation: spread_label = 1 if brightness > 330, else 0")
print(f"Spread fires (label=1): {(df['spread_label']==1).sum()}")
print(f"No-spread fires (label=0): {(df['spread_label']==0).sum()}")

print("\n=== BRIGHTNESS BY LABEL ===")
print(df.groupby('spread_label')['brightness'].describe())

print("\n=== CRITICAL ISSUE ===")
print("The label is DIRECTLY created from brightness (a feature)!")
print("This is PERFECT data leakage.")
print("\nThe model learns: if brightness > 330 → predict 1, else → predict 0")
print("This gives 100% accuracy but has ZERO predictive value.")

# Check what columns exist
print(f"\n=== AVAILABLE COLUMNS ===")
print(df.columns.tolist())

# Test 1: Train with brightness included
feature_cols = ["latitude", "longitude", "brightness", "bright_t31", "confidence",
                "daynight", "elevation", "slope", "aspect", "hist_temp", "hist_humidity",
                "hist_wind_speed"]
# Only use columns that exist
feature_cols = [col for col in feature_cols if col in df.columns]
print(f"\n=== USING FEATURES ===")
print(feature_cols)

# Convert daynight to numeric
if df['daynight'].dtype == object:
    df['daynight'] = (df['daynight'].str.upper() == 'D').astype(int)

X = df[feature_cols].fillna(0).astype(float)
y = df['spread_label']

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.25, random_state=42, stratify=y)

rf_with_brightness = RandomForestClassifier(n_estimators=100, max_depth=10, random_state=42)
rf_with_brightness.fit(X_train, y_train)
acc_with = accuracy_score(y_test, rf_with_brightness.predict(X_test))

# Test 2: Train WITHOUT brightness
feature_cols_no_brightness = [col for col in feature_cols if col != 'brightness']
X_no_bright = X[feature_cols_no_brightness]
X_train_nb, X_test_nb, y_train_nb, y_test_nb = train_test_split(X_no_bright, y, test_size=0.25, random_state=42, stratify=y)

rf_without_brightness = RandomForestClassifier(n_estimators=100, max_depth=10, random_state=42)
rf_without_brightness.fit(X_train_nb, y_train_nb)
acc_without = accuracy_score(y_test_nb, rf_without_brightness.predict(X_test_nb))

print(f"\n=== MODEL COMPARISON ===")
print(f"Accuracy WITH brightness feature: {acc_with:.3f}")
print(f"Accuracy WITHOUT brightness feature: {acc_without:.3f}")

print("\n=== FEATURE IMPORTANCE (with brightness) ===")
importances = rf_with_brightness.feature_importances_
for feat, imp in sorted(zip(feature_cols, importances), key=lambda x: x[1], reverse=True)[:5]:
    print(f"{feat:20s}: {imp:.4f}")

print("\n=== CONCLUSION ===")
print("The 100% accuracy is NOT a sign of a good model.")
print("It's a sign of data leakage - the label is created FROM a feature.")
print("\nTo fix this, you need:")
print("1. Real labels based on actual fire perimeter growth (not brightness)")
print("2. Remove brightness from features if keeping brightness-based labels")
print("3. Use a different target variable (e.g., acres burned, containment time)")
