#!/usr/bin/env python3
"""
Create sample test data for demonstration purposes
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import random

def generate_sample_data():
    """Generate realistic sample test data"""
    
    # Configuration matching the test framework
    architectures = ['P2P', 'SFU']
    num_viewers = [1, 2, 5, 10]
    packet_loss_rates = [0, 1, 2, 5]
    presenter_bandwidths = ['5mbit', '2mbit', '1mbit']
    repetitions = 5
    
    data = []
    base_time = datetime.now()
    
    for arch in architectures:
        for viewers in num_viewers:
            for loss_rate in packet_loss_rates:
                for bandwidth in presenter_bandwidths:
                    for rep in range(1, repetitions + 1):
                        
                        # Simulate realistic metrics based on architecture
                        if arch == 'P2P':
                            # P2P: CPU increases with viewers, affected by network conditions
                            base_cpu = 10 + (viewers * 8)  # Linear increase
                            cpu_variance = loss_rate * 2 + (1 if bandwidth == '1mbit' else 0) * 5
                            cpu_avg = base_cpu + random.uniform(-cpu_variance, cpu_variance)
                            cpu_max = cpu_avg * (1.2 + random.uniform(0, 0.3))
                            
                            # P2P: Latency starts low but degrades with packet loss
                            base_latency = 25 + random.uniform(-5, 5)
                            latency_penalty = loss_rate * (15 + viewers * 2)  # Compounds with viewers
                            avg_latency = base_latency + latency_penalty
                            
                        else:  # SFU
                            # SFU: CPU remains relatively flat
                            base_cpu = 15 + random.uniform(-3, 3)  # Mostly constant
                            cpu_variance = loss_rate * 0.5  # Less affected by network
                            cpu_avg = base_cpu + random.uniform(-cpu_variance, cpu_variance)
                            cpu_max = cpu_avg * (1.1 + random.uniform(0, 0.2))
                            
                            # SFU: Latency starts higher but more resilient
                            base_latency = 35 + random.uniform(-3, 3)
                            latency_penalty = loss_rate * 8  # Less steep increase
                            avg_latency = base_latency + latency_penalty
                        
                        # Bandwidth usage (simplified)
                        bw_multiplier = {'5mbit': 0.8, '2mbit': 0.95, '1mbit': 1.0}[bandwidth]
                        bandwidth_usage = (viewers * 1.2 * bw_multiplier) + random.uniform(-0.2, 0.2)
                        
                        # Text legibility score (lower is better)
                        # Affected by bandwidth and packet loss
                        bw_score = {'5mbit': 0, '2mbit': 2, '1mbit': 8}[bandwidth]
                        loss_score = loss_rate * (3 if arch == 'P2P' else 2)
                        base_tls = bw_score + loss_score + random.uniform(-1, 2)
                        text_legibility = max(0, base_tls)
                        
                        # Ensure values are realistic
                        cpu_avg = max(0, min(100, cpu_avg))
                        cpu_max = max(cpu_avg, min(100, cpu_max))
                        avg_latency = max(10, avg_latency)
                        bandwidth_usage = max(0, bandwidth_usage)
                        text_legibility = max(0, min(50, text_legibility))
                        
                        record = {
                            'Timestamp': (base_time + timedelta(minutes=len(data)*2)).isoformat(),
                            'Architecture': arch,
                            'Num_Viewers': viewers,
                            'Packet_Loss_Rate': loss_rate,
                            'Presenter_Bandwidth': bandwidth,
                            'Repetition': rep,
                            'Presenter_CPU_Avg': round(cpu_avg, 2),
                            'Presenter_CPU_Max': round(cpu_max, 2),
                            'Presenter_Bandwidth_Usage': round(bandwidth_usage, 2),
                            'Avg_Latency_Ms': round(avg_latency, 1),
                            'Min_Latency_Ms': round(avg_latency * 0.8, 1),
                            'Max_Latency_Ms': round(avg_latency * 1.4, 1),
                            'Text_Legibility_Score': round(text_legibility, 1),
                            'Test_Duration_Ms': 60000,
                            'Success': True,
                            'Error_Message': ''
                        }
                        
                        data.append(record)
    
    return pd.DataFrame(data)

def main():
    print("Generating sample WebRTC test data...")
    
    # Generate data
    df = generate_sample_data()
    
    # Save to CSV
    df.to_csv('results/sample_results.csv', index=False)
    
    print(f"Generated {len(df)} sample records")
    print("Sample data saved to: results/sample_results.csv")
    
    # Show sample statistics
    print("\\nSample Statistics by Architecture:")
    summary = df.groupby('Architecture').agg({
        'Presenter_CPU_Avg': ['mean', 'std'],
        'Avg_Latency_Ms': ['mean', 'std'], 
        'Text_Legibility_Score': ['mean', 'std']
    }).round(2)
    
    print(summary)

if __name__ == '__main__':
    import os
    os.makedirs('results', exist_ok=True)
    main()