# Folder: datasets

## 📌 Purpose
Stores all datasets used in the wildfire prediction model, including raw FIRMS fire detections, external environmental data, and processed features.

---

## 📂 Contents
- **raw/** → immutable raw datasets (NASA FIRMS downloads, etc.).  
- **processed/** → cleaned and feature-engineered data.  
- **external/** → third-party sources (NOAA weather, vegetation indices).  

---

## ⚙️ Usage
- Raw data should be placed in `raw/`.  
- Run preprocessing to generate processed data:  
```bash
make preprocess-data
