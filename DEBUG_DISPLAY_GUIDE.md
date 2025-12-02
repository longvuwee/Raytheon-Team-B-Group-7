# Quick Debug Checklist for Fire Spread Display

## The Issue
The "Run Demo" button doesn't display any fire spread predictions on the globe.

## Root Causes (Likely)

### 1. Backend Not Returning Data
The backend might be:
- Not running
- Returning errors
- Returning empty predictions array
- Using wrong endpoint

### 2. Frontend Not Processing Data
- Predictions not reaching FireSpreadLayer component
- Image generation failing
- Globe not initialized
- Layers being hidden

## Debugging Steps

### Step 1: Check Browser Console

1. Open browser DevTools (F12)
2. Go to Console tab
3. Click "Run Demo"
4. Look for these logs:

**Expected logs:**
```
=== RUN DEMO STARTED ===
Fetched fire_inputs rows: 50
Cluster created with 12 points
Calling handleRunForecast...
[api] fetch -> POST http://localhost:10000/predict-spread-animation
Backend response: {predictions: [...], time_steps: 24}
Number of predictions received: XXX
Building forecast frames for 24 time steps
[FireSpreadLayer] Received predictions: 24 frames
[FireSpreadLayer] Creating layers...
Forecast setup complete
=== RUN DEMO COMPLETED ===
```

**If you see:**
- `No data in fire_inputs table` → Your Supabase table is empty
- `CORS error` → Backend not accessible
- `404 Not Found` → Backend endpoint wrong
- `fetch failed` → Backend not running
- `Number of predictions received: 0` → Backend returns empty array

### Step 2: Verify Backend is Running

```bash
# Check if backend is running
curl http://localhost:10000/health

# Expected response:
{"status": "ok"}
```

If this fails:
```bash
# Start the backend
cd C:\\Users\\Amer\\Desktop\\Raytheon-Team-B-Group-7
python api\\Server.py
```

### Step 3: Test Backend Directly

```bash
# Test predict-spread-animation endpoint
curl -X POST http://localhost:10000/predict-spread-animation \\
  -H "Content-Type: application/json" \\
  -d "{\"cluster\": [{\"latitude\": 34.2, \"longitude\": -118.2, \"brightness\": 320, \"bright_t31\": 290, \"confidence\": 80, \"daynight\": 1, \"elevation\": 500, \"slope\": 10, \"aspect\": 180, \"temp\": 30, \"humidity\": 20, \"wind_speed\": 15, \"precip\": 0, \"month\": 7}], \"time_steps\": 3, \"model_name\": \"random_forest\"}"
```

**Expected response:**
```json
{
  "predictions": [
    {"time": 0, "lat": 34.2, "lon": -118.2, "spread_probability": 0.75, "block_id": "CA-..."},
    ...
  ],
  "time_steps": 3
}
```

### Step 4: Check Frontend Configuration

Open `.env.local` in `my-app` folder:
```
VITE_API_URL=http://localhost:10000
```

Make sure it matches where your backend is running.

### Step 5: Check Supabase Data

Your frontend fetches from `fire_inputs` table. Verify data exists:

```bash
curl http://localhost:10000/debug/inspect-db-predictions
```

Or in Supabase dashboard, run:
```sql
SELECT COUNT(*) FROM fire_inputs;
```

If count is 0, you need to populate the table first.

## Common Fixes

### Fix 1: Backend Not Started
```bash
cd C:\\Users\\Amer\\Desktop\\Raytheon-Team-B-Group-7
python api\\Server.py
```

### Fix 2: Wrong API URL
Edit `my-app/.env.local`:
```
VITE_API_URL=http://localhost:10000
```

Then restart Vite:
```bash
cd my-app
pnpm dev
```

### Fix 3: Empty Supabase Table

You can seed data using the backend:
```bash
curl -X POST http://localhost:10000/predict \\
  -H "Content-Type: application/json" \\
  -d "{\"model\": \"random_forest\", \"latitude\": 34.2, \"longitude\": -118.2, \"brightness\": 320, \"bright_t31\": 290, \"confidence\": 80, \"daynight\": 1, \"elevation\": 500, \"slope\": 10, \"aspect\": 180, \"temp\": 30, \"humidity\": 20, \"wind_speed\": 15, \"precip\": 0, \"month\": 7}"
```

### Fix 4: CORS Issues

If you see CORS errors, make sure backend includes:
```python
CORS(app, resources={r"/*": {"origins": "*"}})
```

This is already in Server.py.

### Fix 5: Globe Not Initialized

In console, check:
```javascript
// In browser console
window.globeRef = null; // This should show the globe ref
```

If null, the globe hasn't loaded yet. Wait a few seconds after page load.

## What to Report

When asking for help, provide:

1. **Console logs** - Copy all logs from console after clicking "Run Demo"
2. **Backend status** - Result of `curl http://localhost:10000/health`
3. **Network tab** - Check if `/predict-spread-animation` request succeeded
4. **Supabase count** - How many rows in `fire_inputs` table

## Expected Behavior

After clicking "Run Demo", you should see:
1. Status message: "Running demo: fetching seeds..."
2. Camera flies to California
3. Status message: "Generating 24h forecast..."
4. Red/orange heatmap overlays appear on globe
5. Timeline controls appear at bottom
6. Message disappears

The heatmap should show fire spread predictions with colors:
- Red = High probability
- Orange/Yellow = Medium probability
- Transparent = Low probability

## Still Not Working?

If console shows predictions are being received but nothing displays:

1. Check if other layers are visible (toggle "MODIS Hotspots")
2. Try zooming out - predictions might be outside view
3. Check globe initialization - refresh page
4. Disable ad blockers - might block canvas rendering
5. Try different browser - Chrome recommended

## Quick Test Script

Save this as `test_demo.html` and open in browser:

```html
<!DOCTYPE html>
<html>
<head><title>Test Backend</title></head>
<body>
  <h1>Backend Test</h1>
  <button onclick="testHealth()">Test Health</button>
  <button onclick="testPredict()">Test Prediction</button>
  <pre id="output"></pre>
  <script>
    const API_URL = 'http://localhost:10000';
    async function testHealth() {
      try {
        const res = await fetch(API_URL + '/health');
        const data = await res.json();
        document.getElementById('output').textContent = JSON.stringify(data, null, 2);
      } catch (e) {
        document.getElementById('output').textContent = 'Error: ' + e.message;
      }
    }
    async function testPredict() {
      try {
        const res = await fetch(API_URL + '/predict-spread-animation', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            cluster: [{
              latitude: 34.2, longitude: -118.2, brightness: 320,
              bright_t31: 290, confidence: 80, daynight: 1,
              elevation: 500, slope: 10, aspect: 180,
              temp: 30, humidity: 20, wind_speed: 15,
              precip: 0, month: 7
            }],
            time_steps: 3,
            model_name: 'random_forest'
          })
        });
        const data = await res.json();
        document.getElementById('output').textContent = JSON.stringify(data, null, 2);
      } catch (e) {
        document.getElementById('output').textContent = 'Error: ' + e.message;
      }
    }
  </script>
</body>
</html>
```

Open this in your browser and click "Test Prediction". If this works but the app doesn't, the issue is in the frontend React code.
