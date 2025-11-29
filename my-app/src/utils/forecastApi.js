/**
 * API client for fire spread prediction backend
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

/**
 * Generate fire spread predictions for a cluster of fire points
 * @param {Array} clusterPoints - Array of fire points with lat, lon, brightness, etc.
 * @param {number} forecastHours - Number of hours to forecast
 * @param {string} modelName - Model to use (neural_network, random_forest, logreg)
 * @returns {Promise<Array>} Array of predictions for each time step
 */
export async function generateSpreadForecast(clusterPoints, forecastHours = 24, modelName = "neural_network") {
  try {
    const response = await fetch(`${API_BASE_URL}/predict-spread-animation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        cluster: clusterPoints,
        time_steps: forecastHours,
        model_name: modelName,
      }),
    });

    if (!response.ok) {
      throw new Error(`Forecast API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.predictions;
  } catch (error) {
    console.error('Failed to generate forecast:', error);
    throw error;
  }
}

/**
 * Fetch environmental data for a location (for prediction features)
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {Date} date - Date/time
 * @returns {Promise<Object>} Environmental data
 */
export async function fetchEnvironmentalData(lat, lon, date) {
  try {
    const response = await fetch(`${API_BASE_URL}/environmental-data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        latitude: lat,
        longitude: lon,
        datetime: date.toISOString(),
      }),
    });

    if (!response.ok) {
      // Return default values if API fails
      return getDefaultEnvironmentalData();
    }

    return await response.json();
  } catch (error) {
    console.warn('Environmental data fetch failed, using defaults:', error);
    return getDefaultEnvironmentalData();
  }
}

function getDefaultEnvironmentalData() {
  return {
    temperature: 25,
    humidity: 40,
    wind_speed: 10,
    wind_direction: 180,
    vegetation_index: 0.3,
    elevation: 500,
    slope: 15,
  };
}
