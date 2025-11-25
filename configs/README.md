# Folder: configs

## 📌 Purpose
Holds configuration files that control how different parts of the wildfire prediction application run. This allows reproducibility and makes it easy to switch between environments (development, staging, production).

---

## 📂 Contents
- **dev/** → settings for local development.  
- **prod/** → production-ready configs.  
- **.env.example** → template for environment variables (never commit real secrets).  

---

## ⚙️ Usage
1. Copy `.env.example` to `.env` and fill in values.  
2. Modify config YAML/JSON files to adjust model parameters, API URLs, or database connections.  

---

## 📑 Notes
- Keep secrets out of source control.  
- Use consistent naming for keys across environments.  
