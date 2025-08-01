from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator
import math
import random
import pandas as pd
import numpy as np
from typing import Dict, Any, List, Optional
import uvicorn
import os
from pathlib import Path
import logging

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Jaipur Accident Severity Calculator",
    description="API to calculate maximum accident severity based on route coordinates in Jaipur with CSV data integration",
    version="2.0.0"
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

accident_data = None

# Jaipur city bounds (approximate)
JAIPUR_BOUNDS = {
    "min_lat": 26.8089,
    "max_lat": 26.9124,
    "min_lng": 75.7873,
    "max_lng": 75.8573
}

class RouteRequest(BaseModel):
    start_latitude: float
    start_longitude: float
    end_latitude: float
    end_longitude: float

class AccidentSeverityResponse(BaseModel):
    max_severity_score: float
    severity_level: str
    risk_factors: Dict[str, Any]
    route_analysis: Dict[str, Any]
    csv_data_analysis: Optional[Dict[str, Any]] = None

class CSVDataResponse(BaseModel):
    total_records: int
    columns: List[str]
    sample_data: List[Dict[str, Any]]
    data_summary: Dict[str, Any]

def load_csv_data():
    """Load the AccidentsBig.csv file from the specified path"""
    global accident_data
    
    try:
    
        csv_path = Path(r"D:\team 1\Backend\AccidentsBig.csv")
        
        alternative_paths = [
            Path("AccidentsBig.csv"), 
            Path("./AccidentsBig.csv"),  
            Path(__file__).parent / "AccidentsBig.csv" if hasattr(Path(__file__), 'parent') else Path.cwd() / "AccidentsBig.csv",
        ]
        
        # Try to find the CSV file
        file_found = False
        for path in [csv_path] + alternative_paths:
            if path.exists():
                csv_path = path
                file_found = True
                logger.info(f"Found CSV file at: {csv_path}")
                break
        
        if not file_found:
            logger.warning(f"CSV file 'AccidentsBig.csv' not found in expected locations")
            logger.warning(f"Checked paths: {[str(p) for p in [csv_path] + alternative_paths]}")
            return None
        
        # Read the CSV file
        accident_data = pd.read_csv(csv_path)
        
        # Clean column names (remove extra spaces, standardize)
        accident_data.columns = accident_data.columns.str.strip()
        
        # Handle common data issues
        accident_data = accident_data.dropna(how='all')  # Remove completely empty rows
        
        # Convert coordinate columns to numeric if they exist
        lat_cols = [col for col in accident_data.columns if 'lat' in col.lower()]
        lng_cols = [col for col in accident_data.columns if 'lng' in col.lower() or 'lon' in col.lower()]
        
        if lat_cols:
            accident_data[lat_cols[0]] = pd.to_numeric(accident_data[lat_cols[0]], errors='coerce')
        if lng_cols:
            accident_data[lng_cols[0]] = pd.to_numeric(accident_data[lng_cols[0]], errors='coerce')
        
        logger.info(f"Successfully loaded CSV with {len(accident_data)} records and {len(accident_data.columns)} columns")
        logger.info(f"Columns: {list(accident_data.columns)}")
        
        return accident_data
        
    except FileNotFoundError:
        logger.error(f"CSV file not found at path: {csv_path}")
        return None
    except pd.errors.EmptyDataError:
        logger.error("CSV file is empty")
        return None
    except pd.errors.ParserError as e:
        logger.error(f"Error parsing CSV file: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error loading CSV: {e}")
        return None

def calculate_distance(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Calculate distance between two points using Haversine formula (in km)"""
    lat1, lng1, lat2, lng2 = map(math.radians, [lat1, lng1, lat2, lng2])
    
    dlat = lat2 - lat1
    dlng = lng2 - lng1
    
    a = math.sin(dlat / 2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2)**2
    c = 2 * math.asin(math.sqrt(a))
    r = 6371  # Radius of Earth in kilometers

    distance = r * c
    return distance

def get_severity_level(score: float) -> str:
    """Convert numerical severity score to categorical level"""
    if score >= 8.0:
        return "CRITICAL"
    elif score >= 6.0:
        return "HIGH"
    elif score >= 4.0:
        return "MEDIUM"
    elif score >= 2.0:
        return "LOW"
    else:
        return "MINIMAL"

def get_high_risk_areas_from_csv(radius_km: float = 5.0) -> List[Dict]:
    """Get high-risk areas from CSV data based on accident frequency"""
    global accident_data
    
    if accident_data is None:
        return []
    
    try:
        # Find latitude/longitude columns
        lat_cols = [col for col in accident_data.columns if 'lat' in col.lower()]
        lng_cols = [col for col in accident_data.columns if 'lng' in col.lower() or 'lon' in col.lower()]
        
        if not lat_cols or not lng_cols:
            logger.warning("No latitude/longitude columns found in CSV data")
            return []
        
        lat_col = lat_cols[0]
        lng_col = lng_cols[0]
        
        # Remove rows with invalid coordinates
        valid_data = accident_data.dropna(subset=[lat_col, lng_col])
        
        if len(valid_data) == 0:
            return []
        
        # Group nearby accidents to find high-risk areas
        high_risk_areas = []
        processed_indices = set()
        
        for idx, row in valid_data.iterrows():
            if idx in processed_indices:
                continue
                
            lat = float(row[lat_col])
            lng = float(row[lng_col])
            
            # Find all accidents within radius
            nearby_accidents = []
            for idx2, row2 in valid_data.iterrows():
                if idx2 in processed_indices:
                    continue
                    
                lat2 = float(row2[lat_col])
                lng2 = float(row2[lng_col])
                
                distance = calculate_distance(lat, lng, lat2, lng2)
                if distance <= radius_km:
                    nearby_accidents.append((idx2, distance))
                    processed_indices.add(idx2)
            
            # If there are multiple accidents in this area, consider it high-risk
            if len(nearby_accidents) >= 3:  # Threshold for high-risk area
                # Calculate center point
                center_lat = valid_data.loc[[acc[0] for acc in nearby_accidents], lat_col].mean()
                center_lng = valid_data.loc[[acc[0] for acc in nearby_accidents], lng_col].mean()
                
                high_risk_areas.append({
                    "lat": center_lat,
                    "lng": center_lng,
                    "name": f"High-risk area ({len(nearby_accidents)} accidents)",
                    "accident_count": len(nearby_accidents)
                })
        
        # Sort by accident count and return top areas
        high_risk_areas.sort(key=lambda x: x['accident_count'], reverse=True)
        return high_risk_areas[:10]  # Return top 10 high-risk areas
        
    except Exception as e:
        logger.error(f"Error identifying high-risk areas from CSV: {e}")
        return []

def analyze_csv_data_for_route(route: RouteRequest) -> Dict[str, Any]:
    """Analyze CSV data for the given route"""
    global accident_data
    
    if accident_data is None:
        return {"error": "CSV data not available"}
    
    try:
        csv_analysis = {
            "total_accidents_in_dataset": len(accident_data),
            "nearby_accidents": [],
            "severity_distribution": {},
            "time_patterns": {},
            "route_risk_score": 0.0
        }
        
        # Look for latitude/longitude columns
        lat_cols = [col for col in accident_data.columns if 'lat' in col.lower()]
        lng_cols = [col for col in accident_data.columns if 'lng' in col.lower() or 'lon' in col.lower()]
        
        if lat_cols and lng_cols:
            lat_col = lat_cols[0]
            lng_col = lng_cols[0]
            
            # Find accidents near the route (within different radii)
            nearby_accidents = []
            route_risk_score = 0.0
            
            for idx, row in accident_data.iterrows():
                if pd.notna(row[lat_col]) and pd.notna(row[lng_col]):
                    try:
                        acc_lat = float(row[lat_col])
                        acc_lng = float(row[lng_col])
                        
                        # Check distance to start point
                        dist_to_start = calculate_distance(
                            route.start_latitude, route.start_longitude,
                            acc_lat, acc_lng
                        )
                        
                        # Check distance to end point
                        dist_to_end = calculate_distance(
                            route.end_latitude, route.end_longitude,
                            acc_lat, acc_lng
                        )
                        
                        min_distance = min(dist_to_start, dist_to_end)
                        
                        # Different risk weights based on distance
                        if min_distance <= 0.5:  # Very close - high risk
                            route_risk_score += 3.0
                        elif min_distance <= 1.0:  # Close - medium risk
                            route_risk_score += 2.0
                        elif min_distance <= 2.0:  # Nearby - low risk
                            route_risk_score += 1.0
                        
                        if min_distance <= 3.0:  # Include in nearby accidents list
                            accident_info = {
                                "distance_km": round(min_distance, 3),
                                "latitude": acc_lat,
                                "longitude": acc_lng
                            }
                            
                            # Add other available columns
                            for col in accident_data.columns:
                                if col not in [lat_col, lng_col] and pd.notna(row[col]):
                                    accident_info[col.lower().replace(' ', '_')] = row[col]
                            
                            nearby_accidents.append(accident_info)
                    
                    except (ValueError, TypeError):
                        continue  # Skip invalid coordinate data
            
            # Sort by distance and limit results
            nearby_accidents.sort(key=lambda x: x['distance_km'])
            csv_analysis["nearby_accidents"] = nearby_accidents[:15]  # Top 15 nearest
            csv_analysis["nearby_accidents_count"] = len([acc for acc in nearby_accidents if acc['distance_km'] <= 2.0])
            csv_analysis["route_risk_score"] = min(route_risk_score * 0.1, 4.0)  # Scale and cap the risk score
        
        # Analyze severity if severity column exists
        severity_cols = [col for col in accident_data.columns if 'severity' in col.lower()]
        if severity_cols:
            severity_col = severity_cols[0]
            severity_counts = accident_data[severity_col].value_counts().to_dict()
            csv_analysis["severity_distribution"] = severity_counts
        
        # Analyze time patterns if time/date columns exist
        time_cols = [col for col in accident_data.columns if any(time_word in col.lower() for time_word in ['time', 'date', 'hour'])]
        if time_cols:
            csv_analysis["time_patterns"] = {
                "available_time_columns": time_cols
            }
        
        return csv_analysis
        
    except Exception as e:
        logger.error(f"Error analyzing CSV data: {e}")
        return {"error": f"Error analyzing CSV data: {str(e)}"}

def calculate_accident_severity(route: RouteRequest) -> AccidentSeverityResponse:
    """Calculate maximum accident severity for the given route using CSV data"""
    
    # Base severity factors
    severity_score = 0.5  # Lower base score, let CSV data drive the calculation
    risk_factors = {}
    
    # Factor 1: Route distance (longer routes = slightly higher risk)
    route_distance = calculate_distance(
        route.start_latitude, route.start_longitude,
        route.end_latitude, route.end_longitude
    )
    
    distance_factor = min(route_distance * 0.3, 1.0)  # Reduced impact, max 1.0 point
    severity_score += distance_factor
    risk_factors["route_distance_km"] = round(route_distance, 2)
    risk_factors["distance_risk_factor"] = round(distance_factor, 2)
    
    # Factor 2: CSV data analysis (primary factor)
    csv_data_analysis = analyze_csv_data_for_route(route)
    csv_risk_factor = 0.0
    
    if "route_risk_score" in csv_data_analysis:
        csv_risk_factor = csv_data_analysis["route_risk_score"]
        severity_score += csv_risk_factor
        risk_factors["csv_risk_factor"] = round(csv_risk_factor, 2)
    
    if "nearby_accidents_count" in csv_data_analysis:
        nearby_count = csv_data_analysis["nearby_accidents_count"]
        risk_factors["csv_nearby_accidents"] = nearby_count
    
    # Factor 3: High-risk areas from CSV data
    high_risk_areas = get_high_risk_areas_from_csv()
    max_risk_area_factor = 0.0
    nearest_risk_areas = []
    
    # Check both start and end points against CSV-derived high-risk areas
    for point_name, lat, lng in [("start", route.start_latitude, route.start_longitude),
                                 ("end", route.end_latitude, route.end_longitude)]:
        for risk_area in high_risk_areas:
            distance_to_risk = calculate_distance(lat, lng, risk_area["lat"], risk_area["lng"])
            
            if distance_to_risk <= 2.0:  # Within 2km of high-risk area
                # Risk factor based on distance and accident count
                risk_factor = max(0, (2.0 - distance_to_risk) * risk_area["accident_count"] * 0.1)
                max_risk_area_factor = max(max_risk_area_factor, risk_factor)
                nearest_risk_areas.append({
                    "area_name": risk_area["name"],
                    "distance_km": round(distance_to_risk, 3),
                    "point": point_name,
                    "accident_count": risk_area["accident_count"],
                    "risk_contribution": round(risk_factor, 2)
                })
    
    severity_score += max_risk_area_factor
    risk_factors["high_risk_areas"] = nearest_risk_areas
    risk_factors["max_area_risk_factor"] = round(max_risk_area_factor, 2)
    
    # Factor 4: Additional factors (reduced impact)
    additional_factor = random.uniform(0.1, 0.5)  # Reduced random factor
    severity_score += additional_factor
    risk_factors["additional_conditions_factor"] = round(additional_factor, 2)
    
    # Cap maximum severity score
    severity_score = min(severity_score, 10.0)
    
    # Route analysis
    route_analysis = {
        "start_point": {
            "latitude": route.start_latitude,
            "longitude": route.start_longitude
        },
        "end_point": {
            "latitude": route.end_latitude,
            "longitude": route.end_longitude
        },
        "total_distance_km": round(route_distance, 2),
        "estimated_travel_time_minutes": round(route_distance * 4, 1),
        "crosses_high_risk_areas": len(nearest_risk_areas) > 0,
        "data_source": "CSV file analysis" if accident_data is not None else "Hardcoded data"
    }
    
    return AccidentSeverityResponse(
        max_severity_score=round(severity_score, 2),
        severity_level=get_severity_level(severity_score),
        risk_factors=risk_factors,
        route_analysis=route_analysis,
        csv_data_analysis=csv_data_analysis if csv_data_analysis.get("error") is None else None
    )

@app.on_event("startup")
async def startup_event():
    """Load CSV data when the application starts"""
    logger.info("Loading CSV data on startup...")
    result = load_csv_data()
    if result is not None:
        logger.info(f"CSV data loaded successfully with {len(result)} records")
    else:
        logger.warning("Failed to load CSV data - will use fallback methods")

# @app.post("/calculate-accident-severity", response_model=AccidentSeverityResponse)
# async def calculate_route_accident_severity(route: RouteRequest):
#     """
#     Calculate the maximum accident severity for a route in Jaipur using CSV data.
    
#     The calculation now primarily uses actual accident data from the CSV file rather than hardcoded values.
#     """
#     try:
#         logger.info(f"Calculating severity for route: {route}")
#         result = calculate_accident_severity(route)
#         return result
#     except ValueError as e:
#         logger.error(f"Validation error: {e}")
#         raise HTTPException(status_code=400, detail=f"Validation error: {str(e)}")
#     except Exception as e:
#         logger.error(f"Error calculating severity: {e}")
#         raise HTTPException(status_code=500, detail=f"Error calculating severity: {str(e)}")/

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

@app.post("/calculate-accident-severity", response_model=AccidentSeverityResponse)
async def calculate_route_accident_severity(route: RouteRequest) -> AccidentSeverityResponse:
    """
    Calculate the maximum accident severity for a route in Jaipur using CSV data.
    """
    logger.info("Received request to calculate accident severity", extra={"route": route.dict()})
    
    try:
        return calculate_accident_severity(route)
    
    except ValueError as ve:
        msg = f"Validation error: {ve}"
        logger.warning(msg)
        raise HTTPException(status_code=400, detail=msg)
    
    except Exception as e:
        msg = f"Unexpected error during severity calculation: {e}"
        logger.exception(msg)
        raise HTTPException(status_code=500, detail=msg)


@app.get("/csv-data-info", response_model=CSVDataResponse)
async def get_csv_data_info():
    """Get information about the loaded CSV data"""
    global accident_data
    
    if accident_data is None:
        raise HTTPException(status_code=404, detail="CSV data not loaded")
    
    try:
        # Get sample data (first 5 rows)
        sample_data = []
        for idx, row in accident_data.head(5).iterrows():
            sample_row = {}
            for col in accident_data.columns:
                value = row[col]
                # Convert numpy/pandas types to Python native types
                if pd.isna(value):
                    sample_row[col] = None
                elif isinstance(value, (np.integer, np.floating)):
                    sample_row[col] = float(value) if isinstance(value, np.floating) else int(value)
                else:
                    sample_row[col] = str(value)
            sample_data.append(sample_row)
        
        # Create data summary
        data_summary = {
            "numeric_columns": [],
            "text_columns": [],
            "date_columns": []
        }
        
        for col in accident_data.columns:
            if accident_data[col].dtype in ['int64', 'float64']:
                data_summary["numeric_columns"].append(col)
            elif accident_data[col].dtype == 'object':
                # Check if it might be a date column
                if any(date_word in col.lower() for date_word in ['date', 'time']):
                    data_summary["date_columns"].append(col)
                else:
                    data_summary["text_columns"].append(col)
        
        return CSVDataResponse(
            total_records=len(accident_data),
            columns=list(accident_data.columns),
            sample_data=sample_data,
            data_summary=data_summary
        )
        
    except Exception as e:
        logger.error(f"Error getting CSV info: {e}")
        raise HTTPException(status_code=500, detail=f"Error getting CSV info: {str(e)}")

@app.get("/high-risk-areas")
async def get_high_risk_areas():
    """Get high-risk areas derived from CSV data"""
    if accident_data is None:
        raise HTTPException(status_code=404, detail="CSV data not loaded")
    
    high_risk_areas = get_high_risk_areas_from_csv()
    return {
        "high_risk_areas": high_risk_areas,
        "total_areas": len(high_risk_areas),
        "data_source": "CSV accident data analysis"
    }

@app.post("/reload-csv")
async def reload_csv_data():
    """Reload the CSV data"""
    logger.info("Reloading CSV data...")
    result = load_csv_data()
    
    if result is not None:
        return {"message": "CSV data reloaded successfully", "records": len(result)}
    else:
        raise HTTPException(status_code=404, detail="Failed to reload CSV data")

@app.get("/")
async def root():
    """Root endpoint with API information"""
    return {
        "message": "Jaipur Accident Severity Calculator API with CSV Integration",
        "version": "2.0.0",
        "csv_data_loaded": accident_data is not None,
        "csv_records": len(accident_data) if accident_data is not None else 0,
        "data_source": "CSV file analysis" if accident_data is not None else "Hardcoded fallback",
        "endpoints": {
            "/calculate-accident-severity": "POST - Calculate accident severity for a route",
            "/csv-data-info": "GET - Get information about loaded CSV data",
            "/high-risk-areas": "GET - Get high-risk areas from CSV data",
            "/reload-csv": "POST - Reload CSV data",
            "/docs": "GET - API documentation",
            "/jaipur-bounds": "GET - Get Jaipur city coordinate bounds"
        }
    }

@app.post("/test-route-format")
async def test_route_format(data: dict):
    """Test endpoint to see what data is being received"""
    logger.info(f"Received raw data: {data}")
    try:
        route = RouteRequest(**data)
        return {"status": "success", "parsed_route": route.model_dump()}
    except Exception as e:
        return {"status": "error", "error": str(e), "received_data": data}

@app.get("/sample-request")
async def get_sample_request():
    """Get a sample request format for testing"""
    return {
        "sample_request": {
            "start_latitude": 26.9124,
            "start_longitude": 75.7873,
            "end_latitude": 26.8851,
            "end_longitude": 75.8073
        },
        "jaipur_bounds": JAIPUR_BOUNDS,
        "note": "All coordinates should preferably be within Jaipur area for best results"
    }

@app.get("/jaipur-bounds")
async def get_jaipur_bounds():
    """Get the coordinate bounds for Jaipur city"""
    high_risk_areas = get_high_risk_areas_from_csv() if accident_data is not None else []
    return {
        "bounds": JAIPUR_BOUNDS,
        "csv_derived_high_risk_areas": high_risk_areas[:5],  # Show top 5
        "total_high_risk_areas": len(high_risk_areas)
    }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)