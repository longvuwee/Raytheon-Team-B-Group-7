# Loop Fix Summary

## Problems Identified

### 1. Frontend Infinite Loop
**Issue**: The frontend was making an API call to `https://firecast-x.onrender.com/predict-spread-animation` but the backend was taking too long to respond (or hanging). During this wait, React components kept re-rendering, causing `FiresLayer` to repeatedly clean up and recreate layers.

**Symptoms**:
- Console shows repeated `FiresLayer: removed 'Fires' layer` and `FiresLayer: useEffect triggered`
- API call never completes
- "Failed to generate forecast. Please try again." alert

**Root Cause**: No timeout on the `fetch()` call in `forecastApi.js`

### 2. Scikit-learn Warnings (Backend)
**Issue**: Hundreds of warnings:
```
UserWarning: X does not have valid feature names, but RandomForestClassifier was fitted with feature names
```

**Root Cause**: Passing numpy arrays to `rf.predict_proba()` instead of pandas DataFrames with proper column names

## Fixes Applied

### Fix 1: Added 60-Second Timeout to API Requests
**File**: `my-app/src/utils/forecastApi.js`

Added `AbortController` with 60-second timeout to prevent infinite waiting:

```javascript
async function requestWithLogging(url, options = {}) {
  try {
    console.log('[api] fetch ->', (options.method || 'GET').toUpperCase(), url);
    
    // Add 60 second timeout for long-running predictions
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    
    const res = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    // ... rest of code
  } catch (err) {
    if (err.name === 'AbortError') {
      console.error('[api] Request timeout after 60 seconds:', url);
      throw new Error('Request timed out after 60 seconds');
    }
    // ... rest of error handling
  }
}
```

**Result**: If backend takes longer than 60 seconds, the request aborts with a clear error message instead of hanging forever.

### Fix 2: Added Response Time Logging
**File**: `my-app/src/App.jsx`

Added timer to log how long the backend takes to respond:

```javascript
const startTime = Date.now();
const resp = await generateSpreadForecast(
  cluster.points,
  forecastHours,
  "random_forest"
);
const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
console.log(`Backend response received in ${elapsedTime}s:`, resp);
```

**Result**: You'll see exactly how long the backend takes (e.g., "Backend response received in 3.47s")

### Fix 3: Added Empty Response Check
**File**: `my-app/src/App.jsx`

Added validation to catch empty responses:

```javascript
if (predictions.length === 0) {
  console.error("Backend returned 0 predictions! Check backend logs.");
  alert("Failed to generate forecast. Please try again.");
  setIsLoadingForecast(false);
  return;
}
```

**Result**: Clear error message if backend returns no predictions

### Fix 4: Use Pandas DataFrames in Predictor
**File**: `api/predictor.py`

Changed `_build_feature_vector()` to return a pandas DataFrame instead of numpy array:

```python
import pandas as pd  # Added import

def _build_feature_vector(features: Dict[str, Any]) -> pd.DataFrame:
    """
    Build a 1×N DataFrame with columns in the same order as `feature_cols`.
    Returns a DataFrame to preserve feature names and avoid sklearn warnings.
    """
    vals = []
    for name in feature_cols:
        if name not in features:
            raise KeyError(f"Missing feature: {name}")
        vals.append(float(features[name]))

    # Return DataFrame with proper column names
    return pd.DataFrame([vals], columns=feature_cols)
```

**Result**: No more scikit-learn warnings about missing feature names

## Next Steps

1. **Restart Backend** (pick up pandas fix):
   ```bash
   cd c:\Users\Amer\Desktop\Raytheon-Team-B-Group-7
   python api\Server.py
   ```

2. **Restart Frontend** (pick up timeout fix):
   ```bash
   cd my-app
   pnpm dev
   ```

3. **Test "Run Demo"**:
   - Open http://localhost:5173 (or :5174)
   - Click "Run Demo"
   - Watch console logs:
     - Should see "Backend response received in X.XXs"
     - Should see "Number of predictions received: N" (where N > 0)
     - Should see "[FireSpreadLayer] Received predictions: N"
   
4. **If timeout occurs**:
   - Check if backend is actually running at http://localhost:10000
   - Test directly: `curl http://localhost:10000/health`
   - If using Render.com deployment, check Render logs for errors

## Expected Behavior

**Before Fix**:
- Frontend hangs indefinitely
- FiresLayer loops forever
- No error messages
- Hundreds of sklearn warnings in backend

**After Fix**:
- Request completes in <10 seconds (or times out at 60s)
- Clear console logs showing timing
- No sklearn warnings in backend
- Error alerts if something fails

## Debugging Tips

If you still see issues:

1. **Check backend is running**:
   ```powershell
   curl http://localhost:10000/health
   ```

2. **Check backend logs** for actual errors (not just warnings)

3. **Test with smaller cluster**:
   - Click on globe to select just 1-2 fire points
   - Click "Run Forecast" with fewer points

4. **Check Render.com deployment**:
   - If using `https://firecast-x.onrender.com`, verify it's running
   - Render free tier has cold starts (can take 30+ seconds)
   - Check Render dashboard logs

5. **Verify .env.local**:
   ```
   VITE_API_URL=http://localhost:10000  # or https://firecast-x.onrender.com
   ```
