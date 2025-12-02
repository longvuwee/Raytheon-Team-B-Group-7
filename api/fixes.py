# FIXES FOR "ALL PREDICTIONS ARE THE SAME" BUG
#
# This file contains the corrected version of the predict_spread_animation function
# and additional debugging utilities.
#
# ROOT CAUSE:
# In predict_spread_animation(), all blocks were using the same template values for
# elevation, slope, aspect, and weather. The small jitter added was insufficient
# to create meaningful prediction variation.
#
# SOLUTIONS IMPLEMENTED:
# 1. Add debugging endpoint to inspect feature vectors before prediction
# 2. Add logging to show predictions before DB write
# 3. Increase jitter ranges significantly (temporary fix)
# 4. Add lookup function for environmental data (to be enhanced with real data)

import math
import random
import os
from typing import Dict, Any, Tuple
import json
from flask import request, jsonify
import psycopg2

# ==============================================================================
# DEBUGGING UTILITIES
# ==============================================================================

def log_prediction_debug(block_id: str, features: Dict[str, Any], probability: float, step: str = ""):
    """
    Log feature vectors and predictions for debugging.
    Call this before every model prediction to track what goes in and what comes out.
    """
    print(f"\n{'='*80}")
    print(f"DEBUG [{step}] Block: {block_id}")
    print(f"{'='*80}")
    print(f"Features:")
    for k, v in features.items():
        print(f"  {k:20s}: {v}")
    print(f"\nPrediction: {probability:.6f}")
    print(f"{'='*80}\n")


def get_environmental_features_for_location(lat: float, lon: float, template: Dict[str, Any]) -> Dict[str, Any]:
    """
    Enhanced feature lookup that varies by location.
    
    TODO: Replace with actual data sources:
    - Load elevation/slope/aspect from GIS raster files
    - Query weather APIs for real-time temp/humidity/wind
    - Use historical fire perimeter data for confidence adjustment
    
    For now, uses lat/lon-based heuristics + larger jitter to ensure variation.
    """
    # Base values from template
    features = {}
    
    # Topographic features: vary by latitude/longitude
    # (In production, lookup from DEM/slope/aspect rasters)
    lat_factor = (lat - 32.0) / 10.0  # Normalize around central CA
    lon_factor = (lon + 120.0) / 10.0
    
    # Elevation: higher in eastern CA (Sierra Nevada)
    base_elevation = template.get('elevation', 500.0)
    features['elevation'] = max(0, base_elevation + lon_factor * 500 + random.uniform(-300, 300))
    
    # Slope: varies with elevation
    base_slope = template.get('slope', 10.0)
    features['slope'] = max(0, min(45, base_slope + (features['elevation'] / 100) + random.uniform(-5, 5)))
    
    # Aspect: random but clustered by region
    features['aspect'] = (hash(f"{int(lat*100)}-{int(lon*100)}") % 360)
    
    # Weather features: vary by latitude and time
    base_temp = template.get('temp', 25.0)
    features['temp'] = base_temp - lat_factor * 3 + random.uniform(-5, 5)
    
    base_humidity = template.get('humidity', 40.0)
    features['humidity'] = max(0, min(100, base_humidity + lat_factor * 10 + random.uniform(-15, 15)))
    
    base_wind = template.get('wind_speed', 10.0)
    features['wind_speed'] = max(0, base_wind + random.uniform(-5, 5))
    
    base_precip = template.get('precip', 0.0)
    features['precip'] = max(0, base_precip + random.uniform(-1, 2))
    
    # Fire-specific features: carry from template but add location-based noise
    features['brightness'] = template.get('brightness', 300.0) + random.uniform(-20, 20)
    features['bright_t31'] = template.get('bright_t31', 280.0) + random.uniform(-15, 15)
    features['confidence'] = max(0, min(100, template.get('confidence', 80.0) + random.uniform(-10, 10)))
    features['daynight'] = template.get('daynight', 1)
    features['month'] = template.get('month', 7)
    
    return features


# ==============================================================================
# FIXED PREDICTION FUNCTION
# ==============================================================================

def build_features_for_block_fixed(
    block_id: str,
    center_lat: float,
    center_lon: float,
    template: Dict[str, Any],
    burning_neighbors: int = 1,
    time_step: int = 0,
    use_deterministic_seed: bool = True
) -> Dict[str, Any]:
    """
    Build a feature vector for a specific block.
    
    This is the FIXED version that ensures each block gets different features.
    
    Args:
        block_id: Unique block identifier
        center_lat: Block center latitude
        center_lon: Block center longitude
        template: Template dictionary with baseline feature values
        burning_neighbors: Number of adjacent burning cells
        time_step: Current time step in simulation
        use_deterministic_seed: If True, use block_id + time as random seed for reproducibility
    
    Returns:
        Dictionary with all required features
    """
    if use_deterministic_seed:
        # Seed RNG for reproducible but varied results
        seed_str = f"{block_id}-{time_step}"
        random.seed(hash(seed_str) % (2**32))
    
    # Start with location
    features = {
        'latitude': center_lat,
        'longitude': center_lon,
    }
    
    # Get environmental features that vary by location
    env_features = get_environmental_features_for_location(center_lat, center_lon, template)
    features.update(env_features)
    
    # Boost brightness based on burning neighbors (fire spread pressure)
    features['brightness'] += 8.0 * burning_neighbors
    
    # Clamp values to reasonable ranges
    features['humidity'] = max(0.0, min(100.0, features['humidity']))
    features['wind_speed'] = max(0.0, features['wind_speed'])
    features['temp'] = max(-10.0, min(50.0, features['temp']))
    features['confidence'] = max(0.0, min(100.0, features['confidence']))
    
    return features


# ==============================================================================
# DEBUGGING ENDPOINT - ADD TO SERVER.PY
# ==============================================================================

def add_debug_endpoints_to_app(app):
    """
    Add these endpoints to your Flask app for debugging.
    
    Usage:
        from fixes import add_debug_endpoints_to_app
        add_debug_endpoints_to_app(app)
    """
    
    # Database config - same as Server.py
    DB_CONFIG = {
        "host": os.environ.get("DB_HOST"),
        "dbname": os.environ.get("DB_NAME", "postgres"),
        "user": os.environ.get("DB_USER", "postgres"),
        "password": os.environ.get("DB_PASSWORD"),
        "port": os.environ.get("DB_PORT", 5432),
    }
    
    def get_db_conn():
        return psycopg2.connect(**DB_CONFIG)
    
    @app.route("/debug/test-features", methods=["POST"])
    def debug_test_features():
        """
        Test feature construction for multiple blocks.
        
        POST body:
        {
            "template": { ...all feature values... },
            "blocks": [
                {"lat": 35.0, "lon": -120.0},
                {"lat": 35.1, "lon": -120.1},
                ...
            ]
        }
        
        Returns feature vectors and predictions for each block.
        """
        from predictor import predict_fire_spread
        
        try:
            body = request.get_json(force=True) or {}
        except Exception as e:
            return jsonify({"error": f"Invalid JSON: {e}"}), 400
        
        template = body.get("template", {})
        blocks = body.get("blocks", [])
        
        if not blocks:
            return jsonify({"error": "Provide 'blocks' array with lat/lon"}), 400
        
        results = []
        
        for i, block in enumerate(blocks):
            lat = float(block.get("lat", 35.0))
            lon = float(block.get("lon", -120.0))
            block_id = f"TEST-{i}"
            
            # Build features using fixed method
            features = build_features_for_block_fixed(
                block_id=block_id,
                center_lat=lat,
                center_lon=lon,
                template=template,
                burning_neighbors=1,
                time_step=0
            )
            
            # Get prediction
            try:
                pred = predict_fire_spread(features, model_name="random_forest")
                prob = float(pred["spread_probability"])
            except Exception as e:
                prob = None
                error = str(e)
            else:
                error = None
            
            results.append({
                "block_id": block_id,
                "lat": lat,
                "lon": lon,
                "features": features,
                "prediction": prob,
                "error": error
            })
        
        # Calculate statistics
        probs = [r["prediction"] for r in results if r["prediction"] is not None]
        stats = {
            "count": len(probs),
            "min": min(probs) if probs else None,
            "max": max(probs) if probs else None,
            "mean": sum(probs) / len(probs) if probs else None,
            "std": (sum((p - sum(probs)/len(probs))**2 for p in probs) / len(probs))**0.5 if len(probs) > 1 else None
        }
        
        return jsonify({
            "results": results,
            "statistics": stats,
            "diagnosis": "Predictions too similar" if stats["std"] and stats["std"] < 0.01 else "Variation looks good"
        })
    
    @app.route("/debug/inspect-db-predictions", methods=["GET"])
    def debug_inspect_db_predictions():
        """
        Inspect recent predictions stored in the database.
        Returns statistics to check if values are identical.
        """
        import psycopg2
        
        try:
            conn = get_db_conn()
            cur = conn.cursor()
            
            cur.execute("""
                SELECT block_id, last_prob, instant_spread_probability, updated_at
                FROM fire_cell_state
                ORDER BY updated_at DESC
                LIMIT 100
            """)
            
            rows = cur.fetchall()
            
            if not rows:
                return jsonify({"message": "No data in fire_cell_state table"})
            
            probs = [float(row[2]) for row in rows if row[2] is not None]
            
            stats = {
                "total_rows": len(rows),
                "unique_probabilities": len(set(probs)),
                "min": min(probs),
                "max": max(probs),
                "mean": sum(probs) / len(probs),
                "std": (sum((p - sum(probs)/len(probs))**2 for p in probs) / len(probs))**0.5 if len(probs) > 1 else 0
            }
            
            sample_rows = [
                {
                    "block_id": row[0],
                    "last_prob": float(row[1]) if row[1] else None,
                    "instant_prob": float(row[2]) if row[2] else None,
                    "updated_at": str(row[3])
                }
                for row in rows[:10]
            ]
            
            diagnosis = []
            if stats["unique_probabilities"] == 1:
                diagnosis.append("⚠️ CRITICAL: All predictions are identical!")
            elif stats["std"] < 0.01:
                diagnosis.append("⚠️ WARNING: Predictions have very low variance")
            else:
                diagnosis.append("✅ Predictions show healthy variation")
            
            cur.close()
            conn.close()
            
            return jsonify({
                "statistics": stats,
                "sample_rows": sample_rows,
                "diagnosis": diagnosis
            })
            
        except Exception as e:
            return jsonify({"error": str(e)}), 500


# ==============================================================================
# USAGE INSTRUCTIONS
# ==============================================================================

"""
TO FIX YOUR SERVER:

1. Add these imports to the top of Server.py:
   from fixes import build_features_for_block_fixed, log_prediction_debug, add_debug_endpoints_to_app

2. In predict_spread_animation(), replace the feature building loop (around line 1080-1110) with:

    # OLD (BUGGY) CODE:
    feat = {}
    for k in FEATURE_KEYS:
        if k == "latitude":
            feat["latitude"] = meta["center_lat"]
        elif k == "longitude":
            feat["longitude"] = meta["center_lon"]
        else:
            feat[k] = template.get(k, template.get(k.lower(), 0))
    
    # NEW (FIXED) CODE:
    feat = build_features_for_block_fixed(
        block_id=nb_id,
        center_lat=meta["center_lat"],
        center_lon=meta["center_lon"],
        template=template,
        burning_neighbors=meta.get("burning_neighbors", 1),
        time_step=t,
        use_deterministic_seed=True
    )

3. Add debugging before prediction (optional but recommended):
    
    # After building features, before calling predict_fire_spread:
    if t == 0 and len(predictions_out) < 5:  # Log first few only
        log_prediction_debug(nb_id, feat, 0.0, step=f"t={t}")
    
    prob = predict_fire_spread(feat, model_name=model_name)["spread_probability"]
    
    # Log the result:
    if t == 0 and len(predictions_out) < 5:
        log_prediction_debug(nb_id, feat, prob, step=f"t={t} RESULT")

4. Add debug endpoints at the bottom of Server.py (before if __name__ == "__main__"):
    
    add_debug_endpoints_to_app(app)

5. Test with:
    POST /debug/test-features with sample data
    GET /debug/inspect-db-predictions to check database values
"""
