# FireCastX

**FireCastX** is an interactive wildfire risk and prediction visualization platform developed in collaboration with **Raytheon RTX**. The system combines real-time geospatial data, machine learning–driven prediction outputs, and an interactive 3D map interface to support analysis of wildfire behavior across the United States.

🎥 **Project Demo Video**  
https://youtu.be/0ZyIWZ01St0

---

## Project Status

- ✅ **Frontend:** Fully functional and deployed  
- ⚠️ **Backend:** Not currently running in production  

> **Note:**  
> This demo video was recorded while the backend server was active. During the recording:
> - **Wildfire spread prediction** was executed and visualized  
> - **Point-based prediction** was not executed  

The deployed frontend accurately reflects the system’s completed design, visualization logic, and user interaction workflows.

---

## Overview

FireCastX is designed to visualize wildfire risk and spread prediction data using an interactive **3D globe-based interface**. The platform enables users to explore wildfire activity, model forecasts, and environmental context through layered geospatial visualizations.

The project emphasizes:
- Scalable frontend architecture
- Clear visualization of complex spatial data
- Separation of concerns between visualization and prediction services
- Production-style collaboration between frontend and backend teams

---

## Technical Contributions

- Developed and maintained the **frontend architecture** using **React**, **Vite**, and **OpenGlobus**, creating a high-performance interactive 3D visualization environment for wildfire data across the United States.
- Engineered dynamic UI components including:
  - Timeline sliders for 24-hour forecast visualization  
  - Layer toggles for enabling and disabling prediction outputs  
  - Base map switches for contextual geographic analysis
- Integrated **NASA FIRMS** wildfire datasets and collaborated with the backend team to connect the visualization layer to machine learning prediction services, including:
  - Neural Networks  
  - Linear Regression  
  - Random Forest models
- Supported accurate, data-driven wildfire spread forecasting through seamless frontend–backend integration.
- Contributed to **code organization and modularization**, ensuring scalability, maintainability, and ease of collaboration for future development.

---

## Key Features

- **Interactive 3D Map**
  - Globe-based wildfire visualization using OpenGlobus
  - Smooth navigation, zoom, and camera controls

- **Dynamic Data Layers**
  - Real-time wildfire data overlays
  - Prediction heatmaps and spread visualization
  - Time-based forecast exploration

- **Prediction System Integration**
  - Frontend hooks for backend prediction services
  - Visual display of wildfire spread forecasts (shown in demo)

- **User-Focused Interface Design**
  - Clean separation of controls, legend, and visualization space
  - Responsive UI designed for exploration and analysis

---

## Architecture Summary

- **Frontend**
  - Fully deployed and operational
  - Handles map rendering, UI interaction, and data visualization

- **Backend**
  - Hosts machine learning prediction models
  - Was active during demo recording
  - Currently not deployed in production

This modular architecture allows the visualization platform to remain usable and demonstrable independently of backend availability.

---

## Creators Page

FireCastX includes a **Creators Page** designed to highlight the team behind the project. The page improves usability and transparency by making it easy for users and reviewers to identify contributors, understand roles, and navigate the application through a consistent header and layout structure.

---

## Demo Notes

The demo video showcases:
- Live interaction with the 3D wildfire visualization
- Execution and visualization of wildfire spread predictions
- Frontend communication with backend prediction services

While backend services are not currently live, the demo accurately represents the intended production behavior of the system.

---

## Collaboration

This project was developed in collaboration with **Raytheon RTX**, highlighting experience in:
- Frontend system architecture
- Geospatial data visualization
- Machine learning model integration
- Team-based development in a production-style environment

---

## License / Academic Use

This project was developed for academic and demonstration purposes.  
All datasets and predictive outputs are used strictly for visualization and educational exploration.
