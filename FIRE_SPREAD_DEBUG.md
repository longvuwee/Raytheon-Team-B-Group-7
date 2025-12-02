# Fire Spread Simulation Not Propagating - Debug Guide

## Problem Summary
The fire spread simulation only generates predictions for hour 0 (initial state) and none for subsequent hours 1-11. Backend returns only 18 predictions total instead of spreading across multiple time steps.

**Symptoms:**
```
Hour 0: 67 predictions ✓
Hour 1: 0 predictions ✗
Hour 2: 0 predictions ✗
...
Hour 11: 0 predictions ✗
```

## Root Cause Analysis

### 1. **High Spread Threshold (Primary Issue)**
- **Location**: `api/Server.py` line 102
- **Problem**: `SPREAD_THRESHOLD = 0.75` (75%)
- **Impact**: Cells must have >75% spread probability to ignite. If model predicts 60-70% (realistic values), fire never spreads.
- **Fix Applied**: ✓ Lowered to `0.50` (50%)

### 2. **Simulation Loop Logic**
```python
# For each time step:
for t in range(time_steps):
    # Find candidates (neighbors of burning cells)
    candidates = {}
    for b_id, st in blocks.items():
        if st.get("T_burn") == 1:  # Only cells actively burning
            # Add neighbors to candidates
```

**The Problem:**
- If no cells have `T_burn=1` after step 0, `candidates` becomes empty
- Empty candidates = no predictions = simulation stops
- This happens when all predicted probabilities < SPREAD_THRESHOLD

### 3. **Timeline State Machine**
```python
T_burn states:
  0 = no fire
  1 = burning (REQUIRED for spread)
  2 = burned out
  3 = cannot burn
```

For fire to spread to hour 1+:
1. Initial cells must predict prob >= 0.50 (new threshold)
2. `update_timeline()` sets `new_T_burn=1` 
3. These cells become candidates for next time step
4. Process repeats

## Solutions Implemented

### ✓ Solution 1: Lower Spread Threshold (DONE)
**Changed**: `SPREAD_THRESHOLD = 0.50` (was 0.75)
**Rationale**: 
- Real fires don't need 75% certainty to spread
- 50% is more realistic for probabilistic modeling
- Allows model's natural predictions to drive simulation

### ✓ Solution 2: Enhanced Logging (DONE)
Added comprehensive debug output:
```python
# Shows threshold in prediction logs
print(f"→ Prediction: {prob:.4f} (threshold={SPREAD_THRESHOLD})")

# Shows spread decisions
print(f"Block {nb_id}: prob={prob:.3f}, old_T_burn={old_T_burn} → new_T_burn={new_T_burn} (SPREAD/NO SPREAD)")

# Shows burning cell count
print(f"Step {t}: {candidates} candidates, {blocks} total, {burning_count} burning")
```

## Alternative Solutions (If Issue Persists)

### Option 3: Probabilistic Spread (Stochastic)
Instead of hard threshold, use probability:
```python
import random

def update_timeline(old_T, old_T_burn, prob, can_burn):
    # Use probability instead of threshold
    if random.random() < prob:  # Spreads with given probability
        if old_T_burn == 0:
            return 0, 1  # Ignite
    # ... rest of logic
```

**Pros**: More realistic fire behavior, always produces some spread
**Cons**: Non-deterministic (different each run)

### Option 4: Adaptive Threshold
Dynamically adjust threshold based on conditions:
```python
# Lower threshold for dry/windy conditions
if feat['humidity'] < 30 and feat['wind_speed'] > 15:
    effective_threshold = 0.40
else:
    effective_threshold = 0.50
```

### Option 5: Neighbor Boost
Give bonus to cells with many burning neighbors:
```python
burning_neighbors = meta.get('burning_neighbors', 0)
neighbor_boost = burning_neighbors * 0.05  # 5% per burning neighbor
adjusted_prob = min(prob + neighbor_boost, 1.0)

if adjusted_prob >= SPREAD_THRESHOLD:
    # Cell ignites
```

### Option 6: Multiple Thresholds
Different thresholds for different states:
```python
IGNITION_THRESHOLD = 0.50   # New cells need 50%
CONTINUE_THRESHOLD = 0.30   # Already burning cells need 30% to continue
```

## Testing the Fix

### 1. Check Render.com Logs
After deploying, visit: https://dashboard.render.com
- Look for: `"Step 0/12: X candidates, Y total blocks, Z burning"`
- Verify `Z burning` > 0 after step 0
- Check predictions: `"→ Prediction: 0.XXXX (threshold=0.5)"`
- Look for `"SPREAD"` messages

### 2. Frontend Console
Should now see:
```
Hour 0: 67 predictions ✓
Hour 1: 45 predictions ✓  (NEW!)
Hour 2: 38 predictions ✓  (NEW!)
...
```

### 3. Visual Verification
- Click "Run Demo"
- Camera should fly to Oregon coast
- Red heatmap should appear
- Click play button (►)
- Fire should animate and grow over 12 hours

## If Spread Still Doesn't Work

### Check Model Predictions
The model might be predicting very low probabilities. Add to `Server.py`:
```python
# After prediction, log distribution
all_probs = [p['spread_probability'] for p in predictions_out if p['time'] == 0]
if all_probs:
    print(f"Hour 0 prob range: min={min(all_probs):.3f}, max={max(all_probs):.3f}, avg={sum(all_probs)/len(all_probs):.3f}")
```

### Consider Model Retraining
If probabilities are consistently < 0.30, the model may need:
1. More positive training examples (actual fire spread cases)
2. Feature engineering adjustments
3. Different classification threshold during training

## Summary

**Primary Fix**: Lowered `SPREAD_THRESHOLD` from 0.75 → 0.50
**Expected Result**: Fire simulation now propagates across all 12 hours
**Next Steps**: 
1. Deploy to Render.com (auto-deploys on git push)
2. Test via frontend "Run Demo"
3. Check logs if issues persist
4. Consider alternative approaches if needed

**Key Insight**: The threshold acts as a "gate" - too high and nothing passes through, too low and fire spreads unrealistically. 50% is a good balance for probabilistic fire modeling.
