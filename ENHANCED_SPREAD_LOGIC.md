# Enhanced Fire Spread Logic Implementation

## Overview
Implemented dynamic threshold decay and exposure accumulation to create more realistic fire spread simulation.

## Key Changes

### 1. **Dynamic Threshold Decay**
The spread threshold now decreases over time, making fire spread easier as hours progress:

```python
BASE_SPREAD_THRESHOLD = 0.75      # Starting threshold at hour 0
THRESHOLD_DECAY_RATE = 0.40       # Reduces threshold by 40% over 12 hours
MIN_THRESHOLD = 0.20              # Floor threshold
```

**Time-based threshold progression:**
- **Hour 0**: 0.75 (75% probability required)
- **Hour 3**: 0.66 (66% probability required)
- **Hour 6**: 0.57 (57% probability required)
- **Hour 9**: 0.48 (48% probability required)
- **Hour 11**: 0.45 (45% probability required)

**Formula:**
```python
time_factor = (time_step / (time_steps - 1)) * THRESHOLD_DECAY_RATE
dynamic_threshold = BASE_SPREAD_THRESHOLD * (1.0 - time_factor)
```

### 2. **Neighbor Threshold Bonus**
Cells with more burning neighbors have lower ignition thresholds:

```python
NEIGHBOR_THRESHOLD_BONUS = 0.05   # -5% threshold per burning neighbor
```

**Example:**
- 1 burning neighbor: threshold reduced by 5%
- 3 burning neighbors: threshold reduced by 15%
- 5 burning neighbors: threshold reduced by 25%

**Formula:**
```python
neighbor_bonus = burning_neighbors * NEIGHBOR_THRESHOLD_BONUS
effective_threshold = max(dynamic_threshold - neighbor_bonus, MIN_THRESHOLD)
```

### 3. **Exposure Accumulation**
Cells that are repeatedly exposed to fire predictions accumulate exposure over time:

```python
EXPOSURE_IGNITION_THRESHOLD = 1.0  # Auto-ignite when exposure reaches 1.0
```

**How it works:**
- Each prediction adds its probability to the cell's cumulative `exposure`
- When `exposure >= 1.0`, the cell ignites regardless of current threshold
- Handles repeated predictions on the same cell across multiple time steps

**Example scenario:**
- Hour 1: Cell predicted with prob=0.35, exposure=0.35 (doesn't ignite, threshold=0.75)
- Hour 3: Same cell predicted with prob=0.40, exposure=0.75 (still doesn't ignite)
- Hour 5: Same cell predicted with prob=0.30, exposure=1.05 (IGNITES due to accumulated exposure)

### 4. **Persistent Burning**
Once a cell ignites, it continues burning for the full `T_MAX` duration regardless of subsequent predictions:

**Before (broken):**
```python
if prob < SPREAD_THRESHOLD:
    if old_T_burn == 1:
        return 0, 0  # Stopped burning! ❌
```

**After (fixed):**
```python
if not should_ignite:
    if old_T_burn == 1:
        new_T = min(old_T + 1, T_MAX)
        return new_T, 1  # Continue burning ✅
```

## Updated Function Signature

### `update_timeline()`

**Old:**
```python
def update_timeline(old_T, old_T_burn, prob, can_burn) -> Tuple[int, int]:
```

**New:**
```python
def update_timeline(
    old_T: int, 
    old_T_burn: int, 
    prob: float, 
    can_burn: bool,
    time_step: int = 0,
    time_steps: int = 12,
    burning_neighbors: int = 0,
    exposure: float = 0.0
) -> Tuple[int, int, float]:
```

**Returns:** `(new_T, new_T_burn, new_exposure)`

## Simulation Loop Changes

### Cell State Tracking
Each block now tracks exposure:

```python
blocks[nb_id] = {
    "row": meta["row"],
    "col": meta["col"],
    "center_lat": meta["center_lat"],
    "center_lon": meta["center_lon"],
    "T": new_T,
    "T_burn": new_T_burn,
    "last_prob": prob,
    "exposure": new_exposure,  # NEW: Accumulated exposure
}
```

### Enhanced Logging
Progress logs now show current threshold:

```
Step 0/12: 67 candidates, 67 total blocks, 67 burning, threshold=0.750, 1.23s
Step 5/12: 134 candidates, 201 total blocks, 89 burning, threshold=0.600, 0.98s
Step 10/12: 278 candidates, 479 total blocks, 156 burning, threshold=0.480, 1.45s
```

Debug logs show all parameters:

```
Block CA-44-123: prob=0.680, threshold=0.750, exposure=0.680, old_T_burn=0 → new_T_burn=0 (NO SPREAD)
Block CA-45-123: prob=0.780, threshold=0.700, exposure=0.780, old_T_burn=0 → new_T_burn=1 (SPREAD)
Block CA-46-123: prob=0.420, threshold=0.650, exposure=1.250, old_T_burn=0 → new_T_burn=1 (SPREAD - via exposure)
```

## Ignition Conditions

A cell ignites if **any** of these conditions are met:

1. **Direct ignition:** `prob >= effective_threshold`
2. **Accumulated exposure:** `exposure >= EXPOSURE_IGNITION_THRESHOLD` (1.0)

Where:
```python
effective_threshold = max(
    BASE_SPREAD_THRESHOLD * (1 - time_factor) - (burning_neighbors * NEIGHBOR_THRESHOLD_BONUS),
    MIN_THRESHOLD
)
```

## Expected Behavior Changes

### Before (Fixed Threshold = 0.75)
- Most predictions below 0.75 → no spread
- Fire stopped propagating after hour 0
- Only initial seed cells burned
- Burning cells could revert to non-burning
- **Result:** Only hour 0 had predictions (67), hours 1-11 had 0

### After (Dynamic Threshold + Exposure)
- Threshold decreases from 0.75 → 0.45 over 12 hours
- Cells near multiple burning neighbors easier to ignite
- Repeated exposure accumulates toward auto-ignition
- Once burning, cells continue for full T_MAX duration
- **Expected Result:** Fire propagates through all 12 hours with increasing spread

## Tuning Parameters

Adjust these constants to control spread dynamics:

```python
BASE_SPREAD_THRESHOLD = 0.75      # ↑ Higher = harder to ignite initially
THRESHOLD_DECAY_RATE = 0.40       # ↑ Higher = faster threshold decrease
NEIGHBOR_THRESHOLD_BONUS = 0.05   # ↑ Higher = more neighbor influence
MIN_THRESHOLD = 0.20              # ↓ Lower = easier late-stage ignition
EXPOSURE_IGNITION_THRESHOLD = 1.0 # ↓ Lower = faster exposure-based ignition
T_MAX = 12                        # Duration each cell burns
```

## Testing

### 1. Verify Threshold Decay
Check logs for decreasing thresholds:
```
Step 0/12: ... threshold=0.750
Step 5/12: ... threshold=0.600
Step 10/12: ... threshold=0.480
```

### 2. Verify Spread Propagation
Hours 1-11 should now have predictions:
- Frontend console: "Hour 1: X predictions" (X > 0)
- Backend logs: "burning_count > 0" for multiple hours

### 3. Verify Exposure Accumulation
Look for cells that ignite via exposure:
```
Block CA-X-Y: prob=0.400, threshold=0.650, exposure=1.150 → new_T_burn=1 (SPREAD - via exposure)
```

### 4. Verify Persistent Burning
Once ignited, cells should burn for T_MAX steps regardless of subsequent low predictions.

## Rollback

If issues arise, revert to fixed threshold by changing:

```python
# In update_timeline(), replace dynamic threshold with:
effective_threshold = BASE_SPREAD_THRESHOLD  # Fixed threshold
new_exposure = 0.0  # Disable exposure tracking
```

Or restore from git:
```bash
git checkout HEAD -- api/Server.py
```
