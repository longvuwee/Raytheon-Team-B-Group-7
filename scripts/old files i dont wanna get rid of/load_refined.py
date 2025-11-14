import pandas as pd
from sqlalchemy import create_engine
from pathlib import Path
from urllib.parse import quote_plus

# 1) DB connection
password = quote_plus("SE4485!")  # encode the !
engine = create_engine(
    f"postgresql+psycopg2://postgres:{password}@localhost:5432/firecast"
)

# 2) path to your refined dataset
csv_path = Path(r"C:\Users\Amer\Desktop\Raytheon-Team-B-Group-7\outputs\features\firms_with_perimeter_labels.csv")

# 3) read csv
df = pd.read_csv(csv_path)

# 4) make date-like columns real datetimes when present
for col in ["acq_date", "ALARM_DATE", "CONT_DATE", "ValidStart", "ValidEnd"]:
    if col in df.columns:
        df[col] = pd.to_datetime(df[col], errors="coerce")

# 5) write to postgres
# this will DROP and recreate the table so it matches the CSV exactly
df.to_sql(
    "firms_with_perimeter_labels",   # name of table in postgres
    engine,
    if_exists="replace",
    index=False
)

print("✅ refined dataset loaded to Postgres as firms_with_perimeter_labels")
