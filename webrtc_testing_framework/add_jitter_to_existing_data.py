#!/usr/bin/env python3
"""
Script to add jitter data to existing sample results
"""

import pandas as pd
import numpy as np

def add_jitter_column():
    # Read the existing data
    df = pd.read_csv('results/sample_results.csv')
    
    # Add jitter data based on realistic patterns
    # Jitter tends to correlate with packet loss and increase with more viewers
    np.random.seed(42)  # For reproducible results
    
    jitter_values = []
    for _, row in df.iterrows():
        base_jitter = 5.0  # Base jitter in ms
        
        # Increase jitter with packet loss
        packet_loss_factor = 1.0 + (row['Packet_Loss_Rate'] / 100.0) * 2.0
        
        # Increase jitter with more viewers (P2P is more affected)
        if row['Architecture'] == 'P2P':
            viewer_factor = 1.0 + (row['Num_Viewers'] - 1) * 0.2
        else:
            viewer_factor = 1.0 + (row['Num_Viewers'] - 1) * 0.1
        
        # Lower bandwidth increases jitter
        bandwidth = float(row['Presenter_Bandwidth'].replace('mbit', ''))
        bandwidth_factor = 6.0 / bandwidth  # Inverse relationship
        
        # Add some random variation
        random_factor = 0.8 + np.random.random() * 0.4  # 0.8 to 1.2
        
        jitter = base_jitter * packet_loss_factor * viewer_factor * bandwidth_factor * random_factor
        jitter_values.append(round(jitter, 2))
    
    # Add the jitter column
    df['Avg_Jitter_Ms'] = jitter_values
    
    # Reorder columns to match expected format
    column_order = [
        'Timestamp', 'Architecture', 'Num_Viewers', 'Packet_Loss_Rate', 
        'Presenter_Bandwidth', 'Repetition', 'Presenter_CPU_Avg', 'Presenter_CPU_Max',
        'Presenter_Bandwidth_Usage', 'Avg_Latency_Ms', 'Min_Latency_Ms', 'Max_Latency_Ms',
        'Avg_Jitter_Ms', 'Text_Legibility_Score', 'Test_Duration_Ms', 'Success', 'Error_Message'
    ]
    
    df = df[column_order]
    
    # Save the updated data
    df.to_csv('results/sample_results.csv', index=False)
    print(f"Added jitter data to {len(df)} records")
    print(f"Jitter range: {min(jitter_values):.2f} - {max(jitter_values):.2f} ms")

if __name__ == '__main__':
    add_jitter_column()