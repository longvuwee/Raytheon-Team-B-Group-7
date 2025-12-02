# Render Deployment Fixes

## Changes Made to Improve Performance

### 1. Added Comprehensive Logging to Backend (`api/Server.py`)
- **Start logging**: Shows cluster size, time steps, and model being used
- **Per-step progress**: Logs every 5 steps showing candidates, blocks, and elapsed time
- **Cell limit warning**: Alerts when hitting the 5000 cell limit
- **Total time tracking**: Shows total prediction time at the end

**Purpose**: Helps diagnose slow predictions and identify bottlenecks on Render

### 2. Reduced Frontend Timeout (`my-app/src/utils/forecastApi.js`)
- Added 60-second timeout with AbortController
- Clear error messages when timeout occurs
- Prevents infinite hanging on slow Render responses

### 3. Reduced Demo Forecast Duration (`my-app/src/App.jsx`)
- Changed from 24 hours to **12 hours** for "Run Demo"
- Reduces computation time by ~50%
- Helps stay within Render free tier timeout limits

### 4. Fixed Scikit-learn Warnings (`api/predictor.py`)
- Changed to use pandas DataFrames instead of numpy arrays
- Eliminates hundreds of "missing feature names" warnings
- Cleaner logs on Render

## Deploying to Render

### Option 1: Automatic Deployment (if connected to GitHub)
1. **Commit changes**:
   ```bash
   git add -A
   git commit -m "Add performance logging and reduce forecast duration"
   git push origin testing-with-render
   ```

2. **Render will auto-deploy** (if GitHub integration is set up)
   - Check Render dashboard for deployment status
   - View logs in real-time during deployment

### Option 2: Manual Deployment (if using Render CLI or manual setup)
1. Commit and push changes (same as above)
2. Go to Render dashboard
3. Click "Manual Deploy" → "Deploy latest commit"

## Expected Render Logs

After deployment, when you click "Run Demo", you should see in Render logs:

```
=== PREDICT-SPREAD-ANIMATION START ===
Cluster size: 12 points
Time steps: 12
Model: random_forest

DEBUG: Block CA-1234-5678 at t=0
  Location: (36.5123, -119.8765)
  Features: elev=450.0, slope=8.5, temp=28.3°C
  → Prediction: 0.7234

  Step 0/12: 49 candidates, 12 total blocks, 0.45s
  Step 5/12: 123 candidates, 89 total blocks, 0.52s
  Step 10/12: 245 candidates, 178 total blocks, 0.58s

=== PREDICTION COMPLETE: 1456 predictions in 7.23s ===
```

## Troubleshooting Render Issues

### If still timing out after 60 seconds:

1. **Check Render service is running**:
   - Go to Render dashboard
   - Look for "Live" status
   - Check last deployment was successful

2. **View Render logs**:
   - Click on your service in Render dashboard
   - Go to "Logs" tab
   - Look for errors or warnings

3. **Common Render issues**:
   - **Cold start delay**: Free tier services spin down after 15 min of inactivity
   - **Build failures**: Check if dependencies installed correctly
   - **Memory limits**: Free tier has 512MB RAM limit
   - **Database connection**: Verify Supabase credentials in Render environment variables

4. **Reduce forecast even more**:
   - Change `handleRunForecast(cluster, 12)` to `handleRunForecast(cluster, 6)` for 6-hour forecast
   - Or reduce cluster size by filtering fewer points

### If predictions work but are slow:

1. **Optimize database writes**: 
   - Current code writes to Supabase on every prediction
   - Consider batch writes every N predictions
   - Or disable DB writes for demo (comment out DB code in Server.py)

2. **Reduce MAX_CELLS**:
   - Change `MAX_CELLS = 5000` to `MAX_CELLS = 1000` in Server.py
   - Limits simulation spread

3. **Simplify model**:
   - Use logistic regression instead: `"logreg"` (faster than random forest)
   - Reduce forest size if possible

## Render Environment Variables to Check

Make sure these are set in Render dashboard → Environment:

```
SUPABASE_URL=https://ogzrpvdamptoiicxkzfg.supabase.co
SUPABASE_KEY=<your-service-role-key>
DB_HOST=aws-1-us-east-2.pooler.supabase.com
DB_NAME=postgres
DB_USER=postgres.ogzrpvdamptoiicxkzfg
DB_PASSWORD=firecast123!
DB_PORT=5432
```

## Testing Locally vs Render

**Local (recommended for development)**:
1. Start backend: `python api/Server.py`
2. Change `.env.local`: `VITE_API_URL=http://localhost:10000`
3. Much faster, easier to debug

**Render (for deployment/demo)**:
1. Change `.env.local`: `VITE_API_URL=https://firecast-x.onrender.com`
2. Slower due to cold starts
3. Good for sharing with others

## Next Steps

1. **Push changes to GitHub**:
   ```bash
   cd C:\Users\Amer\Desktop\Raytheon-Team-B-Group-7
   git status
   git add api/Server.py api/predictor.py my-app/src/App.jsx my-app/src/utils/forecastApi.js
   git commit -m "Optimize for Render: add logging, reduce forecast duration, fix sklearn warnings"
   git push origin testing-with-render
   ```

2. **Wait for Render to deploy** (2-5 minutes)

3. **Test the deployment**:
   - Refresh browser at localhost:5173
   - Click "Run Demo"
   - Watch both browser console AND Render logs

4. **Share Render logs** if still having issues so we can diagnose further
