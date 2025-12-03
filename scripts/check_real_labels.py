"""
Check the real perimeter-labeled dataset
"""
import pandas as pd

# Check fires_labeled_with_perimeter_labels.csv
print("=== CHECKING REAL PERIMETER LABELS ===\n")
df = pd.read_csv('outputs/features/fires_labeled_with_perimeter_labels.csv')

print(f"Total rows: {len(df)}")
print(f"\nColumns: {df.columns.tolist()}")

if 'spread_label' in df.columns:
    print("\n=== SPREAD LABEL DISTRIBUTION ===")
    print(df['spread_label'].value_counts())
    print(f"\nLabel 1 (spread): {(df['spread_label']==1).sum()} fires ({(df['spread_label']==1).sum()/len(df)*100:.1f}%)")
    print(f"Label 0 (no spread): {(df['spread_label']==0).sum()} fires ({(df['spread_label']==0).sum()/len(df)*100:.1f}%)")
    
    # Check if this has real perimeter data
    perimeter_cols = [col for col in df.columns if 'acre' in col.lower() or 'gis' in col.lower() or 'perim' in col.lower()]
    if perimeter_cols:
        print(f"\n=== PERIMETER DATA COLUMNS ===")
        print(perimeter_cols)
        for col in perimeter_cols[:3]:  # Show first 3
            print(f"\n{col}:")
            print(df[df['spread_label']==1][col].describe())
    
    print("\n=== SAMPLE FIRES WITH SPREAD (label=1) ===")
    spread_cols = ['latitude', 'longitude', 'brightness', 'confidence', 'spread_label']
    if perimeter_cols:
        spread_cols.extend(perimeter_cols[:2])
    print(df[df['spread_label']==1][spread_cols].head(3))
    
    print("\n=== SAMPLE FIRES WITHOUT SPREAD (label=0) ===")
    print(df[df['spread_label']==0][spread_cols].head(3))
    
    # Check brightness distribution by label
    print("\n=== BRIGHTNESS BY LABEL (checking for data leakage) ===")
    print(df.groupby('spread_label')['brightness'].describe())
    
    # Check if labels are based on brightness threshold
    threshold_330 = df['spread_label'] == (df['brightness'] > 330).astype(int)
    if threshold_330.all():
        print("\n⚠️ WARNING: Labels are EXACTLY brightness > 330 - this is data leakage!")
    else:
        overlap = threshold_330.sum() / len(df) * 100
        print(f"\n✓ Labels are NOT based on brightness threshold")
        print(f"  (Only {overlap:.1f}% overlap with brightness>330 rule)")
else:
    print("\n❌ No spread_label column found!")

# Now check if fires_with_hist_weather has any labels
print("\n\n=== CHECKING fires_with_hist_weather.csv ===")
df2 = pd.read_csv('outputs/features/fires_with_hist_weather.csv')
print(f"Total rows: {len(df2)}")
print(f"Has spread_label: {'spread_label' in df2.columns}")
print(f"Columns: {df2.columns.tolist()}")
