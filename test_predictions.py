"""
Test script to verify the prediction fixes work with your Supabase fire_inputs table.

This script:
1. Connects to your Supabase database
2. Fetches sample rows from fire_inputs
3. Tests predictions with the fixed feature construction
4. Verifies that predictions vary across different locations
"""

import sys
import os
from pathlib import Path

# Add api folder to path
api_path = Path(__file__).parent / 'api'
sys.path.insert(0, str(api_path))

import psycopg2
from predictor import predict_fire_spread
from fixes import build_features_for_block_fixed

# Database configuration
DB_CONFIG = {
    "host": os.environ.get("DB_HOST", "aws-1-us-east-2.pooler.supabase.com"),
    "dbname": os.environ.get("DB_NAME", "postgres"),
    "user": os.environ.get("DB_USER", "postgres.ogzrpvdamptoiicxkzfg"),
    "password": os.environ.get("DB_PASSWORD", "firecast123!"),
    "port": int(os.environ.get("DB_PORT", 5432)),
}

def test_predictions_from_fire_inputs():
    """
    Fetch rows from your fire_inputs table and test predictions.
    """
    print("=" * 80)
    print("Testing Prediction Variation with Supabase fire_inputs Data")
    print("=" * 80)
    
    # Connect to database
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        print("✓ Connected to Supabase database\n")
    except Exception as e:
        print(f"✗ Failed to connect to database: {e}")
        return
    
    # Fetch sample rows from fire_inputs
    try:
        cur.execute("""
            SELECT id, latitude, longitude, brightness, bright_t31, confidence,
                   daynight, elevation, slope, aspect, temp, humidity, wind_speed,
                   precip, month, model
            FROM fire_inputs
            ORDER BY created_at DESC
            LIMIT 10
        """)
        rows = cur.fetchall()
        
        if not rows:
            print("✗ No data found in fire_inputs table")
            cur.close()
            conn.close()
            return
        
        print(f"✓ Fetched {len(rows)} rows from fire_inputs table\n")
        
    except Exception as e:
        print(f"✗ Error fetching data: {e}")
        cur.close()
        conn.close()
        return
    
    # Use first row as template
    template_row = rows[0]
    template = {
        'latitude': float(template_row[1]),
        'longitude': float(template_row[2]),
        'brightness': float(template_row[3]),
        'bright_t31': float(template_row[4]),
        'confidence': float(template_row[5]),
        'daynight': int(template_row[6]),
        'elevation': float(template_row[7]),
        'slope': float(template_row[8]),
        'aspect': float(template_row[9]),
        'temp': float(template_row[10]),
        'humidity': float(template_row[11]),
        'wind_speed': float(template_row[12]),
        'precip': float(template_row[13]),
        'month': int(template_row[14]),
    }
    
    print("Template values:")
    for k, v in template.items():
        print(f"  {k:15s}: {v}")
    print()
    
    # Test predictions on multiple locations
    predictions = []
    print("Testing predictions on sample locations:")
    print("-" * 80)
    
    for i, row in enumerate(rows[:5]):  # Test first 5 rows
        lat = float(row[1])
        lon = float(row[2])
        block_id = f"TEST-{i}"
        
        # Build features using FIXED method
        features = build_features_for_block_fixed(
            block_id=block_id,
            center_lat=lat,
            center_lon=lon,
            template=template,
            burning_neighbors=1,
            time_step=0,
            use_deterministic_seed=True
        )
        
        # Get prediction
        try:
            pred = predict_fire_spread(features, model_name="random_forest")
            prob = float(pred["spread_probability"])
            predictions.append(prob)
            
            print(f"\nLocation {i+1}: ({lat:.4f}, {lon:.4f})")
            print(f"  Block ID: {block_id}")
            print(f"  Elevation: {features['elevation']:.1f}m")
            print(f"  Slope: {features['slope']:.1f}°")
            print(f"  Aspect: {features['aspect']:.0f}°")
            print(f"  Temp: {features['temp']:.1f}°C")
            print(f"  Humidity: {features['humidity']:.1f}%")
            print(f"  Brightness: {features['brightness']:.1f}")
            print(f"  → PREDICTION: {prob:.6f}")
            
        except Exception as e:
            print(f"\n✗ Prediction failed for location {i+1}: {e}")
            import traceback
            traceback.print_exc()
    
    # Analyze prediction variation
    print("\n" + "=" * 80)
    print("RESULTS ANALYSIS")
    print("=" * 80)
    
    if len(predictions) > 1:
        import statistics
        
        min_pred = min(predictions)
        max_pred = max(predictions)
        mean_pred = statistics.mean(predictions)
        std_pred = statistics.stdev(predictions) if len(predictions) > 1 else 0
        
        print(f"Number of predictions: {len(predictions)}")
        print(f"Min prediction: {min_pred:.6f}")
        print(f"Max prediction: {max_pred:.6f}")
        print(f"Mean prediction: {mean_pred:.6f}")
        print(f"Std deviation: {std_pred:.6f}")
        print(f"Range: {max_pred - min_pred:.6f}")
        
        print("\nDiagnosis:")
        if std_pred < 0.001:
            print("⚠️  CRITICAL: Predictions are nearly identical!")
            print("    Standard deviation < 0.001 indicates a problem.")
        elif std_pred < 0.01:
            print("⚠️  WARNING: Low variation in predictions")
            print("    Standard deviation < 0.01 may indicate insufficient diversity.")
        else:
            print("✓ HEALTHY: Predictions show good variation")
            print("    Standard deviation > 0.01 indicates diverse outputs.")
        
        # Show prediction distribution
        print("\nPrediction values:")
        for i, p in enumerate(predictions):
            bar_length = int(p * 50)
            bar = '█' * bar_length
            print(f"  Location {i+1}: {p:.6f} {bar}")
    
    print("\n" + "=" * 80)
    
    cur.close()
    conn.close()


if __name__ == "__main__":
    test_predictions_from_fire_inputs()
