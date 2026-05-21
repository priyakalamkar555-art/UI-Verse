from __future__ import annotations

from pathlib import Path

import pandas as pd
from flask import Flask, jsonify, request
from flask_cors import CORS
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder


BASE_DIR = Path(__file__).resolve().parent
DATA_PATH = BASE_DIR / "data" / "crop_history.csv"

PRICE_PER_TON = {
    "Corn": 320,
    "Wheat": 400,
    "Rice": 460,
    "Soybean": 520,
    "Cotton": 610,
}

app = Flask(__name__)
CORS(app)


def load_model() -> Pipeline:
    data = pd.read_csv(DATA_PATH)
    features = ["acreage", "seed_cost", "fertilizer_cost", "budget", "soil_type", "target_crop"]
    target = "historical_yield_tons"

    preprocessor = ColumnTransformer(
        transformers=[
            (
                "categorical",
                OneHotEncoder(handle_unknown="ignore", sparse=False),
                ["soil_type", "target_crop"],
            ),
        ],
        remainder="passthrough",
    )

    model = RandomForestRegressor(n_estimators=200, random_state=42)
    pipeline = Pipeline([
        ("preprocessor", preprocessor),
        ("model", model),
    ])
    pipeline.fit(data[features], data[target])
    return pipeline


MODEL = load_model()


@app.get("/health")
def health() -> tuple[dict[str, str], int]:
    return {"status": "ok"}, 200


@app.post("/predict_roi")
def predict_roi() -> tuple[dict[str, object], int]:
    payload = request.get_json(silent=True) or {}

    try:
        acreage = float(payload["acreage"])
        seed_cost = float(payload["seed_cost"])
        fertilizer_cost = float(payload["fertilizer_cost"])
        budget = float(payload["budget"])
        soil_type = str(payload["soil_type"])
        target_crop = str(payload["target_crop"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "Invalid forecast payload."}), 400

    if acreage <= 0 or seed_cost < 0 or fertilizer_cost < 0 or budget < 0:
        return jsonify({"error": "Input values must be positive."}), 400

    frame = pd.DataFrame([
        {
            "acreage": acreage,
            "seed_cost": seed_cost,
            "fertilizer_cost": fertilizer_cost,
            "budget": budget,
            "soil_type": soil_type,
            "target_crop": target_crop,
        }
    ])

    predicted_yield = float(MODEL.predict(frame)[0])
    crop_price = PRICE_PER_TON.get(target_crop, 380)
    projected_revenue = predicted_yield * crop_price
    total_costs = seed_cost + fertilizer_cost
    expected_profit = projected_revenue - total_costs
    roi_percent = (expected_profit / total_costs * 100) if total_costs else 0.0

    return jsonify(
        {
            "predicted_yield_tons": round(predicted_yield, 2),
            "projected_revenue": round(projected_revenue, 2),
            "total_costs": round(total_costs, 2),
            "expected_profit": round(expected_profit, 2),
            "roi_percent": round(roi_percent, 2),
            "budget_gap": round(budget - total_costs, 2),
            "crop_price_per_ton": crop_price,
        }
    ), 200


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)