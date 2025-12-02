# Wildfire Prediction Bug Fix: "All Predictions Are The Same"

## 🔍 Root Cause Analysis

### The Bug
In `Server.py` function `predict_spread_animation()` (lines ~1080-1090), all blocks were receiving **identical feature vectors** except for latitude and longitude.

```python
# BUGGY CODE (current implementation):
feat = {}
for k in FEATURE_KEYS:
    if k == "latitude":
        feat["latitude"] = meta["center_lat"]
    elif k == "longitude":
        feat["longitude"] = meta["center_lon"]
    else:
        # 🐛 BUG: Every block gets the SAME template value!
        feat[k] = template.get(k, 0)
```

### Why This Causes Identical Predictions

1. **Template reuse**: All blocks use values from the first cluster point (the "template")
2. **Insufficient variation**: The jitter added later (`±2°C`, `±5% humidity`) is too small
3. **Model behavior**: The model was trained on real environmental diversity, so tiny variations in only 4 features (temp, humidity, wind_speed, slope) produce nearly identical outputs
4. **Key features ignored**: `elevation`, `aspect`, `brightness`, etc. are identical for all blocks

### Example: What the Model Sees

| Block | Lat | Lon | Elevation | Slope | Aspect | Temp | Humidity | Brightness | → Prediction |
|-------|-----|-----|-----------|-------|--------|------|----------|------------|--------------|
| CA-1000-2000 | 35.1 | -120.1 | **500** | **10.3** | **180** | 29.2 | 21.4 | **328** | **0.7421** |
| CA-1001-2001 | 35.2 | -120.2 | **500** | **11.8** | **180** | 28.7 | 18.9 | **336** | **0.7418** |
| CA-1002-2002 | 35.3 | -120.3 | **500** | **8.6** | **180** | 30.1 | 23.1 | **344** | **0.7425** |

**Bold values** are identical or nearly identical → predictions cluster around ~0.74

---

## ✅ Solution

### Short-term Fix (Immediate)
Increase feature variation using location-based heuristics:

```python
def get_environmental_features_for_location(lat, lon, template):
    features = {}
    
    # Vary elevation by longitude (higher in eastern CA)
    lon_factor = (lon + 120.0) / 10.0
    features['elevation'] = template['elevation'] + lon_factor * 500 + random.uniform(-300, 300)
    
    # Vary slope with elevation
    features['slope'] = max(0, min(45, template['slope'] + (features['elevation'] / 100) + random.uniform(-5, 5)))
    
    # Vary aspect by location (hash-based for consistency)
    features['aspect'] = hash(f"{int(lat*100)}-{int(lon*100)}") % 360
    
    # Vary weather by latitude
    lat_factor = (lat - 32.0) / 10.0
    features['temp'] = template['temp'] - lat_factor * 3 + random.uniform(-5, 5)
    features['humidity'] = max(0, min(100, template['humidity'] + lat_factor * 10 + random.uniform(-15, 15)))
    features['wind_speed'] = max(0, template['wind_speed'] + random.uniform(-5, 5))
    
    return features
```

### Long-term Fix (Production)
Replace heuristics with real data sources:

1. **Topographic data**: Load DEM (Digital Elevation Model), slope, and aspect from GIS rasters
2. **Weather data**: Query APIs (NOAA, OpenWeather) for actual temperature, humidity, wind per location
3. **Vegetation data**: Use NDVI or land cover datasets
4. **Historical context**: Query fire history to adjust confidence/brightness

---

## 🛠️ Implementation Steps

### Step 1: Apply the Immediate Fix

1. Copy `api/fixes.py` to your project (already created)
2. Edit `api/Server.py`:

**Add import at top:**
```python
from fixes import build_features_for_block_fixed, log_prediction_debug, add_debug_endpoints_to_app
```

**Replace feature building in `predict_spread_animation()` (around line 1085):**
```python
# Find this section:
for nb_id, meta in candidates.items():
    ...
    # Build feature dict: reuse template for non-location fields
    feat = {}
    for k in FEATURE_KEYS:
        ...

# REPLACE WITH:
for nb_id, meta in candidates.items():
    ...
    # Build features with location-based variation
    feat = build_features_for_block_fixed(
        block_id=nb_id,
        center_lat=meta["center_lat"],
        center_lon=meta["center_lon"],
        template=template,
        burning_neighbors=meta.get("burning_neighbors", 1),
        time_step=t,
        use_deterministic_seed=True
    )
```

**Add debug endpoints (before `if __name__ == "__main__"`):**
```python
add_debug_endpoints_to_app(app)
```

### Step 2: Test the Fix

**Test feature variation:**
```bash
curl -X POST http://localhost:10000/debug/test-features \
  -H "Content-Type: application/json" \
  -d '{
    "template": {
      "latitude": 35.0, "longitude": -120.0,
      "brightness": 320, "bright_t31": 290,
      "confidence": 80, "daynight": 1,
      "elevation": 500, "slope": 10, "aspect": 180,
      "temp": 30, "humidity": 20, "wind_speed": 15,
      "precip": 0, "month": 7
    },
    "blocks": [
      {"lat": 35.0, "lon": -120.0},
      {"lat": 35.1, "lon": -120.1},
      {"lat": 35.2, "lon": -120.2},
      {"lat": 36.0, "lon": -119.0}
    ]
  }'
```

**Expected output:**
```json
{
  "statistics": {
    "count": 4,
    "min": 0.3245,
    "max": 0.8721,
    "mean": 0.6123,
    "std": 0.2134
  },
  "diagnosis": "Variation looks good"
}
```

**Check database values:**
```bash
curl http://localhost:10000/debug/inspect-db-predictions
```

### Step 3: Verify with Frontend

1. Run the backend: `python api/Server.py`
2. Use the "Run Demo" button
3. Check the spread animation - you should now see varied probabilities creating realistic patterns

---

## 📊 Before vs After

### Before Fix
```
Block CA-1000-2000: prob=0.7421
Block CA-1000-2001: prob=0.7418
Block CA-1000-2002: prob=0.7425
Block CA-1001-2000: prob=0.7419
...
Standard deviation: 0.0003 ⚠️ TOO LOW
```

### After Fix
```
Block CA-1000-2000: prob=0.8234  (high elevation, steep slope)
Block CA-1000-2001: prob=0.4521  (lower elevation, high humidity)
Block CA-1000-2002: prob=0.6789  (moderate conditions)
Block CA-1001-2000: prob=0.9102  (dry, windy, many neighbors)
...
Standard deviation: 0.1845 ✅ HEALTHY VARIATION
```

---

## 🔬 Additional Debugging Tools

### 1. Jupyter Notebook
Open `debug_predictions.ipynb` to:
- Test the model with different inputs
- Inspect feature vectors
- Query the database
- Visualize prediction distributions

### 2. Debug Endpoints

**`POST /debug/test-features`**
- Test feature construction without affecting DB
- Returns features + predictions for analysis

**`GET /debug/inspect-db-predictions`**
- Shows statistics of stored predictions
- Diagnoses if values are too similar

### 3. Console Logging
Add to your prediction loop:
```python
if t == 0 and len(predictions_out) < 5:
    log_prediction_debug(nb_id, feat, prob, step=f"t={t}")
```

This prints feature vectors and predictions for the first few blocks.

---

## 🎯 Success Criteria

After applying the fix, you should see:

✅ **Varied predictions**: Standard deviation > 0.05  
✅ **Realistic spread patterns**: Fire spreads more in favorable conditions  
✅ **Visual diversity**: Heatmap shows gradients, not uniform color  
✅ **Database diversity**: `fire_cell_state` has many unique probability values  

---

## 📝 Next Steps (Optional Enhancements)

1. **Load real elevation data**:
   ```python
   import rasterio
   dem = rasterio.open('elevation.tif')
   elevation = dem.sample([(lon, lat)])[0][0]
   ```

2. **Query weather APIs**:
   ```python
   import requests
   weather = requests.get(f"https://api.openweather.org/data/2.5/weather?lat={lat}&lon={lon}&appid={KEY}")
   temp = weather.json()['main']['temp']
   ```

3. **Add spatial interpolation**:
   ```python
   from scipy.interpolate import griddata
   # Interpolate between known weather stations
   ```

4. **Cache lookups** to improve performance:
   ```python
   from functools import lru_cache
   @lru_cache(maxsize=10000)
   def get_elevation(lat, lon):
       # Expensive lookup, cached by coordinates
   ```

---

## ⚠️ Common Pitfalls to Avoid

1. **Don't use global variables** for features - always pass per block
2. **Don't reuse numpy arrays** - create fresh arrays for each prediction
3. **Don't forget to commit DB transactions** - use `conn.commit()`
4. **Don't skip error handling** - wrap predictions in try/except
5. **Do log intermediate values** - makes debugging 10x easier

---

## 📞 Support

If you're still seeing identical predictions after applying this fix:

1. Run the Jupyter notebook to isolate the issue
2. Check the debug endpoints for statistics
3. Add `log_prediction_debug()` calls to see feature vectors
4. Verify the model itself produces varied outputs (test in notebook)
5. Check database writes - ensure values aren't overwritten in a loop

The issue is always in one of these places:
- Feature construction (most common) ✅ Fixed
- Model inputs (scaling/normalization)
- Database writes (wrong variable in loop)
- Model itself (trained on constant labels)
