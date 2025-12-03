"""
Merge real perimeter labels with historical weather data
"""
import pandas as pd

print("=== MERGING REAL LABELS WITH WEATHER DATA ===\n")

# Load the dataset with real perimeter-based labels
labels_df = pd.read_csv('outputs/features/fires_labeled_with_perimeter_labels.csv')
print(f"Loaded {len(labels_df)} fires with real perimeter labels")
print(f"  Spread fires: {(labels_df['spread_label']==1).sum()}")
print(f"  No-spread fires: {(labels_df['spread_label']==0).sum()}")

# Load the weather-enriched dataset
weather_df = pd.read_csv('outputs/features/fires_with_hist_weather.csv')
print(f"\nLoaded {len(weather_df)} fires with weather data")

# Merge on key columns (lat, lon, date, time should uniquely identify each fire detection)
merge_cols = ['latitude', 'longitude', 'acq_date', 'acq_time']

print(f"\nMerging on: {merge_cols}")
merged_df = labels_df.merge(
    weather_df[['latitude', 'longitude', 'acq_date', 'acq_time', 
                'hist_temp', 'hist_humidity', 'hist_wind_speed', 'hist_wind_dir',
                'elevation', 'slope', 'aspect']],
    on=merge_cols,
    how='left',
    suffixes=('', '_weather')
)

print(f"\nMerged dataset: {len(merged_df)} rows")
print(f"  Successfully matched weather data: {merged_df['hist_temp'].notna().sum()} rows")
print(f"  Missing weather data: {merged_df['hist_temp'].isna().sum()} rows")

# Check spread label preservation
print(f"\n=== LABEL DISTRIBUTION (should be unchanged) ===")
print(merged_df['spread_label'].value_counts())

# Fill missing elevation/slope/aspect from original if they exist
for col in ['elevation', 'slope', 'aspect']:
    if col + '_weather' in merged_df.columns:
        # Use weather version where available, fall back to original
        merged_df[col] = merged_df[col + '_weather'].fillna(merged_df[col])
        merged_df.drop(columns=[col + '_weather'], inplace=True)

# Save the merged dataset
output_path = 'outputs/features/fires_with_real_labels_and_weather.csv'
merged_df.to_csv(output_path, index=False)
print(f"\n✓ Saved merged dataset to: {output_path}")

# Show sample
print("\n=== SAMPLE SPREAD FIRES (label=1) ===")
sample_cols = ['latitude', 'longitude', 'brightness', 'spread_label', 
               'hist_temp', 'hist_humidity', 'hist_wind_speed', 'elevation']
print(merged_df[merged_df['spread_label']==1][sample_cols].head(3))

print("\n=== SAMPLE NO-SPREAD FIRES (label=0) ===")
print(merged_df[merged_df['spread_label']==0][sample_cols].head(3))

print("\n=== READY FOR TRAINING ===")
print(f"Use this file for training: {output_path}")
print(f"It has:")
print(f"  - Real spread labels from fire perimeters")
print(f"  - Historical weather data (temp, humidity, wind)")
print(f"  - Topography data (elevation, slope, aspect)")
print(f"  - All original fire detection features")
