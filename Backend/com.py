import pandas as pd
import numpy as np
import datetime
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder, StandardScaler, OneHotEncoder
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report, accuracy_score, confusion_matrix
import joblib
from collections import Counter
import random
from sklearn.cluster import KMeans
import os
import warnings


from imblearn.over_sampling import SMOTE
from imblearn.pipeline import Pipeline as ImbPipeline 


warnings.filterwarnings("ignore", category=FutureWarning, module='pandas')

class JaipurAccidentDataCollector:
    def __init__(self, random_seed=42):
        self.random_seed = random_seed
        np.random.seed(self.random_seed)
        random.seed(self.random_seed)
        self.raw_df = None
        self.processed_df = None
        self.kmeans_model = None

        self.jaipur_locations = {
            "Amer Fort Road": (26.985, 75.850), "Hawa Mahal Road": (26.923, 75.826),
            "Johari Bazaar": (26.918, 75.824), "MI Road": (26.913, 75.817),
            "Tonk Road": (26.850, 75.800), "Sanganer Airport": (26.828, 75.795),
            "Malviya Nagar": (26.865, 75.825), "Mansarovar": (26.870, 75.750),
            "Vaishali Nagar": (26.905, 75.735), "Jhotwara Road": (26.940, 75.750),
            "C-Scheme": (26.908, 75.812), "Bani Park": (26.927, 75.805),
            "Civil Lines": (26.900, 75.800), "Durgapura": (26.850, 75.808),
            "Pratap Nagar": (26.800, 75.800), "Sitapura": (26.750, 75.800)
        }
        self.hospitals = {
            "SMS Hospital": (26.904, 75.811), "Fortis Hospital": (26.864, 75.824),
            "Manipal Hospital": (26.937, 75.755), "Eternal Hospital": (26.871, 75.760)
        }

    def load_accident_data(self, file_path):
        """Loads accident data from a CSV file (can handle zipped CSV)."""
        try:
            self.raw_df = pd.read_csv(
                file_path,
                compression='zip',
                low_memory=False,
            )
            print(f" Data loaded successfully from {file_path}. Shape: {self.raw_df.shape}")
            print(" Columns available:", self.raw_df.columns.tolist())
        except FileNotFoundError:
            print(f" Error: File not found at {file_path}")
            self.raw_df = pd.DataFrame()
        except Exception as e:
            print(f" An error occurred while loading the data: {e}")
            self.raw_df = pd.DataFrame()

    def preprocess_data(self):
        """Preprocesses the loaded accident data."""
        if self.raw_df.empty:
            print(" No raw data to preprocess. Please load data first.")
            self.processed_df = pd.DataFrame()
            return

        df = self.raw_df.copy()

        for col in df.columns:
            if df[col].dtype in ['int64', 'float64']:
                if df[col].isnull().sum() > 0:
                    median_val = df[col].median()
                    df[col] = df[col].fillna(median_val)
                    print(f"Filled missing numericals in '{col}' with median: {median_val}")
            else: 
                if df[col].isnull().sum() > 0:
                    mode_val = df[col].mode().iloc[0] if not df[col].mode().empty else 'Unknown'
                    df[col] = df[col].fillna(mode_val)
                    print(f"Filled missing categoricals in '{col}' with mode: {mode_val}")

      
        df['Date'] = pd.to_datetime(df['Date'], errors='coerce', format='%d-%m-%Y')
        df['Time'] = df['Time'].astype(str).apply(lambda x: pd.to_datetime(x, errors='coerce', format='%H:%M').time() if pd.notna(x) else None)

        df.dropna(subset=['Date', 'Time'], inplace=True)

        df['Year'] = df['Date'].dt.year
        df['Month'] = df['Date'].dt.month
        df['Day'] = df['Date'].dt.day
        df['Hour_of_Day'] = df['Time'].apply(lambda x: x.hour)

        if 'Day_of_Week' in df.columns:
            df['Day_of_Week'] = pd.to_numeric(df['Day_of_Week'], errors='coerce')
            df['Day_of_Week'] = df['Day_of_Week'].fillna(df['Day_of_Week'].median()).astype(int)
            df['Day_of_Week'] = df['Day_of_Week'] - 1

        def get_time_of_day(hour):
            if 5 <= hour < 12: return 'Morning'
            elif 12 <= hour < 17: return 'Afternoon'
            elif 17 <= hour < 21: return 'Evening'
            else: return 'Night'
        df['Time_of_Day_Category'] = df['Hour_of_Day'].apply(get_time_of_day)

        if 'longitude' in df.columns and 'latitude' in df.columns:
            coords = df[['longitude', 'latitude']].apply(pd.to_numeric, errors='coerce').dropna()
            if not coords.empty:
                self.kmeans_model = KMeans(n_clusters=10, random_state=self.random_seed, n_init=10)
                df.loc[coords.index, 'Location_Category'] = self.kmeans_model.fit_predict(coords)
                df['Location_Category'] = df['Location_Category'].fillna('Unknown').astype(object)
            else:
                print(" Longitude or Latitude data is entirely missing or invalid for KMeans clustering. Assigning 'Unknown'.")
                df['Location_Category'] = 'Unknown'
        else:
            print(" Longitude or Latitude columns not found for KMeans clustering. Assigning 'Unknown'.")
            df['Location_Category'] = 'Unknown'

        columns_to_drop = [
            'Time', 'Date', 'Accident_Index', 'Local_Authority_(District)',
            'Local_Authority_(Highway)', 'LSOA_of_Accident_Location',
            '1st_Road_Number', '2nd_Road_Number',
            'Junction_Detail', 'Junction_Control',
            'Pedestrian_Crossing-Human_Control', 'Pedestrian_Crossing-Physical_Facilities',
            'Special_Conditions_at_Site', 'Carriageway_Hazards'
        ]
        df.drop(columns=[col for col in columns_to_drop if col in df.columns], inplace=True, errors='ignore')

        self.processed_df = df
        print(" Data preprocessing completed!")
        print(" Processed Data Head:")
        print(self.processed_df.head())
        print(" Processed Data Info:")
        print(self.processed_df.info())

        return self.processed_df

# 2. Model Training and Prediction
class JaipurAccidentPredictor:
    def __init__(self, random_seed=42):
        self.random_seed = random_seed
        self.model = None
        self.preprocessor = None
        self.feature_columns = None
        self.target_column = 'Accident_Severity'

    def train_model(self, data: pd.DataFrame):
        """Trains a RandomForestClassifier model on the provided data using SMOTE."""
        if self.target_column not in data.columns:
            print(f" Error: Target column '{self.target_column}' not found in the data.")
            return

        data[self.target_column] = data[self.target_column].astype(int)

        X = data.drop(columns=[self.target_column])
        y = data[self.target_column]

        numerical_features = X.select_dtypes(include=['int64', 'float64', 'int32']).columns.tolist()
        categorical_features = X.select_dtypes(include=['object', 'bool']).columns.tolist()

        X = X[numerical_features + categorical_features]

        print("Numerical features for model:", numerical_features)
        print("Categorical features for model:", categorical_features)

        self.preprocessor = ColumnTransformer(
            transformers=[
                ('num', StandardScaler(), numerical_features),
                ('cat', OneHotEncoder(handle_unknown='ignore'), categorical_features)
            ],
            remainder='passthrough'
        )
        smote = SMOTE(random_state=self.random_seed, sampling_strategy='auto')

        self.model = ImbPipeline(steps=[
            ('preprocessor', self.preprocessor),
            ('smote', smote), # SMOTE step added
            ('classifier', RandomForestClassifier(
                n_estimators=200,
                random_state=self.random_seed,
            ))
        ])

        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=self.random_seed, stratify=y)

        print("\nTarget distribution in training set (BEFORE SMOTE):")
        print(y_train.value_counts(normalize=True))
        print("\nTarget distribution in testing set:")
        print(y_test.value_counts(normalize=True))


        print(" Training the model (with SMOTE oversampling)...")
      
        self.model.fit(X_train, y_train)
        print("✅ Model training completed!")
        y_pred = self.model.predict(X_test)
        print("\n--- Model Evaluation ---")
        print("Accuracy:", accuracy_score(y_test, y_pred))
        target_names = {1: 'Fatal', 2: 'Serious', 3: 'Slight'}
        sorted_labels = sorted(y_test.unique())
        print("Classification Report:\n", classification_report(y_test, y_pred, labels=sorted_labels, target_names=[target_names.get(lbl, str(lbl)) for lbl in sorted_labels], zero_division=0))
        print("Confusion Matrix:\n", confusion_matrix(y_test, y_pred, labels=sorted_labels))

        self.feature_columns = X.columns.tolist()

    def predict_severity(self, new_data: pd.DataFrame):
        """Predicts accident severity for new, unseen data."""
        if self.model is None or self.preprocessor is None:
            print(" Error: Model or preprocessor not trained. Please train the model first.")
            return None

        for col in self.feature_columns:
            if col not in new_data.columns:
               
                if col in self.model.named_steps['preprocessor'].named_transformers_['num'].get_feature_names_out().tolist():
                     new_data[col] = 0.0 
                else: 
                     new_data[col] = 'Unknown' 
        new_data = new_data[self.feature_columns]

        try:
            predictions = self.model.predict(new_data)
            return predictions
        except Exception as e:
            print(f" Error during prediction: {e}")
            return None

    def save_model(self, model_path="accident_predictor_pipeline.joblib"):
        """Saves the trained model and preprocessor."""
        if self.model:
            joblib.dump(self.model, model_path)
            print(f" Model saved to {model_path}")
        else:
            print(" No model to save.")

    def load_model(self, model_path="accident_predictor_pipeline.joblib"):
        """Loads a trained model and preprocessor."""
        try:
            self.model = joblib.load(model_path)
            print(f" Model loaded from {model_path}")
            return True
        except FileNotFoundError:
            print(f" Error: Model file not found at {model_path}")
            return False
        except Exception as e:
            print(f" An error occurred while loading the model: {e}")
            return False

if __name__ == "__main__":
    print(" ENHANCED ACCIDENT PREDICTION SYSTEM (Using user-provided data)")

    data_collector = JaipurAccidentDataCollector()
    accident_data_path = r"D:\AccidentsBig.csv.zip"

    data_collector.load_accident_data(accident_data_path)
    processed_data = data_collector.preprocess_data()

    if not processed_data.empty:
        predictor = JaipurAccidentPredictor()
        predictor.train_model(processed_data)

        predictor.save_model()

        print("\n TESTING REALISTIC SCENARIOS")

       
        sample_data = pd.DataFrame({
            'longitude': [78.61, 78.50, 78.48, 77.0, 76.5],
            'latitude': [14.72, 14.75, 14.67, 28.0, 27.0],
            'Police_Force': [1, 1, 1, 5, 2],
            'Number_of_Vehicles': [3, 2, 1, 4, 1],
            'Number_of_Casualties': [2, 1, 1, 3, 1],
            'Day_of_Week': [1, 4, 0, 2, 6],
            '1st_Road_Class': [3, 4, 5, 1, 2],
            'Road_Type': [6, 3, 6, 2, 1],
            'Speed_limit': [30, 50, 30, 70, 40],
            'Light_Conditions': [1, 4, 0, 1, 3],
            'Weather_Conditions': [2, 1, 7, 5, 4],
            'Road_Surface_Conditions': [2, 1, 4, 5, 3],
            'Urban_or_Rural_Area': [1, 1, 1, 2, 1],
            'Did_Police_Officer_Attend_Scene_of_Accident': [1, 1, 1, 1, 0],
            'Year': [2020, 2021, 2019, 2022, 2023],
            'Month': [7, 10, 1, 3, 12],
            'Day': [15, 20, 25, 1, 31],
            'Hour_of_Day': [18, 9, 23, 14, 5],
            'Time_of_Day_Category': ['Evening', 'Morning', 'Night', 'Afternoon', 'Morning'],
        })

        if hasattr(data_collector, 'kmeans_model') and data_collector.kmeans_model is not None:
            coords_sample = sample_data[['longitude', 'latitude']].apply(pd.to_numeric, errors='coerce').dropna()
            if not coords_sample.empty:
                sample_data.loc[coords_sample.index, 'Location_Category'] = data_collector.kmeans_model.predict(coords_sample)
                sample_data['Location_Category'] = sample_data['Location_Category'].astype(object)
            else:
                print(" Sample data has no valid Longitude/Latitude for KMeans prediction. Assigning placeholder.")
                sample_data['Location_Category'] = 'Unknown'
        else:
            print(" KMeans model not available for Location_Category prediction on sample data. Assigning placeholder.")
            sample_data['Location_Category'] = 'Unknown'


        predictions = predictor.predict_severity(sample_data)

        if predictions is not None:
            print("\n--- Predicted Accident Severities ---")
            severity_map = {1: 'Fatal', 2: 'Serious', 3: 'Slight'}
            for i, pred in enumerate(predictions):
                print(f"Scenario {i+1}: Predicted Severity: {severity_map.get(pred, pred)}")

        print("\n NEXT STEPS:")
        print("1. **Evaluate SMOTE's Impact:** Run the script and carefully analyze the new Classification Report. You should see improved recall and F1-score for 'Fatal' and 'Serious' classes, possibly at the cost of slightly lower precision or overall accuracy for the majority class.")
        print("2. **SMOTE Parameter Tuning:** Experiment with `sampling_strategy` in SMOTE. Instead of 'auto', you could provide a dictionary like `sampling_strategy={1: 500, 2: 2000}` (where 500 and 2000 are the desired number of samples for classes 1 and 2, respectively) to control the level of oversampling more precisely.")
        print("3. **Hyperparameter Tuning (RandomForest and SMOTE):** Now that SMOTE is in the pipeline, you'll want to tune the RandomForestClassifier's parameters (e.g., `n_estimators`, `max_depth`, `min_samples_leaf`) *and* SMOTE's `k_neighbors` using techniques like `GridSearchCV` or `RandomizedSearchCV` (which can work directly on `ImbPipeline` objects).")
        print("4. **Cross-validation:** Use `StratifiedKFold` with your `ImbPipeline` to get a more reliable estimate of performance across different folds, ensuring each fold maintains class distribution.")
        print("5. **Consider Undersampling:** For very large datasets, oversampling all minority classes to the majority class size can create too many synthetic samples and lead to long training times. You could also try undersampling the majority class (e.g., `RandomUnderSampler`) or a combination of both (`SMOTEENN`, `SMOTETomek`).")
        print("6. **Feature Importance:** After training, inspect `predictor.model.named_steps['classifier'].feature_importances_` to understand which features are most influential in the predictions (after one-hot encoding).")
        print("7. **Threshold Adjustment (Post-Hoc):** For classification problems with imbalanced classes, sometimes adjusting the prediction probability threshold (e.g., predicting 'Serious' if probability is > 0.2 instead of > 0.5) can improve recall for minority classes.")