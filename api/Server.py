from flask import Flask, request, jsonify
from flask_cors import CORS
import os
from predictor import predict_fire_spread

app = Flask(__name__)
CORS(app)

# -------------------------------------------------
# /predict: general endpoint for all 3 models
# -------------------------------------------------
@app.route("/predict", methods=["POST"])
def predict_general():
    try:
        data = request.get_json()
        if data is None:
            return jsonify({"error": "Invalid or missing JSON body"}), 400

        # default model if not provided
        model_name = data.get("model", "random_forest")

        # only allow the 3 known models
        allowed = ["random_forest", "logistic_regression", "pytorch_nn"]
        if model_name not in allowed:
            return jsonify({"error": "Invalid model", "allowed": allowed}), 400

        result = predict_fire_spread(data, model_name=model_name)
        return jsonify(result)

    except Exception as e:
        return jsonify({
            "error": "unexpected error in /predict",
            "detail": str(e),
        }), 500


# -------------------------------------------------
# /predict-nn: convenience endpoint for the NN
# -------------------------------------------------
@app.route("/predict-nn", methods=["POST"])
def predict_nn():
    try:
        data = request.get_json()
        if data is None:
            return jsonify({"error": "Invalid or missing JSON body"}), 400

        result = predict_fire_spread(data, model_name="pytorch_nn")
        return jsonify(result)

    except Exception as e:
        return jsonify({
            "error": "unexpected error in /predict-nn",
            "detail": str(e),
        }), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
