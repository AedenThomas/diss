#!/usr/bin/env python3
"""
WebRTC Performance Analysis Script

This script analyzes the results from the WebRTC testing framework and generates
the required plots for the Master's dissertation.

Expected plots:
- Figure 6.1: Presenter CPU Utilization vs Number of Viewers
- Figure 6.2: Average G2G Latency vs Packet Loss Rate
- Figure 6.3: Text Legibility Score vs Presenter Upload Bandwidth

Author: WebRTC Testing Framework
"""

import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
import numpy as np
from pathlib import Path
import sys
from typing import Dict, List, Tuple
import logging
from scipy.stats import ttest_ind

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class WebRTCAnalyzer:
    def __init__(self, data_path: str = 'results.csv', output_dir: str = 'plots'):
        self.data_path = Path(data_path)
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(exist_ok=True)
        
        # Set up matplotlib style
        plt.style.use('seaborn-v0_8')
        sns.set_palette("husl")
        
        self.df = None
        
    def load_data(self) -> pd.DataFrame:
        """Load and validate the results CSV file."""
        logger.info(f"Loading data from {self.data_path}")
        
        if not self.data_path.exists():
            raise FileNotFoundError(f"Results file not found: {self.data_path}")
            
        try:
            self.df = pd.read_csv(self.data_path)
            logger.info(f"Loaded {len(self.df)} records")
            
            # Validate required columns
            required_columns = [
                'Architecture', 'Num_Viewers', 'Packet_Loss_Rate', 'Presenter_Bandwidth',
                'Presenter_CPU_Avg', 'Avg_Latency_Ms', 'Text_Legibility_Score', 'Success'
            ]
            
            missing_columns = [col for col in required_columns if col not in self.df.columns]
            if missing_columns:
                raise ValueError(f"Missing required columns: {missing_columns}")
                
            # Filter successful tests only
            successful_tests = self.df[self.df['Success'] == True]
            logger.info(f"Found {len(successful_tests)} successful tests out of {len(self.df)} total")
            
            if len(successful_tests) == 0:
                logger.warning("No successful tests found! All plots will be empty.")
            
            self.df = successful_tests
            return self.df
            
        except Exception as e:
            logger.error(f"Error loading data: {e}")
            raise
    
    def preprocess_data(self):
        """Clean and preprocess the data for analysis."""
        logger.info("Preprocessing data...")
        
        # Convert bandwidth strings to numeric (extract number from "5mbit", "2mbit", etc.)
        self.df['Bandwidth_Mbps'] = self.df['Presenter_Bandwidth'].str.extract('(\\d+)').astype(float)
        
        # Calculate Estimated Total Egress Bandwidth (Mbps)
        # For P2P: presenter sends to each viewer (Presenter_Bandwidth_Usage * Num_Viewers)
        # For SFU: presenter sends only one stream (Presenter_Bandwidth_Usage)
        self.df['Egress_Bandwidth_Mbps'] = np.where(
            self.df['Architecture'] == 'P2P',
            self.df['Presenter_Bandwidth_Usage'] * self.df['Num_Viewers'],
            self.df['Presenter_Bandwidth_Usage']
        )
        
        # Ensure numeric columns are properly typed
        numeric_columns = [
            'Num_Viewers', 'Packet_Loss_Rate', 'Presenter_CPU_Avg', 
            'Avg_Latency_Ms', 'Avg_Jitter_Ms', 'Text_Legibility_Score'
        ]
        
        for col in numeric_columns:
            self.df[col] = pd.to_numeric(self.df[col], errors='coerce')
        
        # Remove rows with NaN values in key columns
        before_count = len(self.df)
        self.df = self.df.dropna(subset=numeric_columns)
        after_count = len(self.df)
        
        if before_count != after_count:
            logger.warning(f"Removed {before_count - after_count} rows with missing data")
        
        logger.info("Data preprocessing complete")
    
    def run_statistical_tests(self):
        """Perform statistical significance testing between P2P and SFU architectures."""
        logger.info("Running statistical significance tests...")
        
        print("\\n" + "="*80)
        print("STATISTICAL SIGNIFICANCE TESTS")
        print("="*80)
        
        # Test 1: Presenter CPU at N=10 viewers
        print("\\nTest 1: Presenter CPU at N=10 viewers")
        print("-" * 40)
        p2p_cpu_10 = self.df[(self.df['Architecture'] == 'P2P') & (self.df['Num_Viewers'] == 10)]['Presenter_CPU_Avg']
        sfu_cpu_10 = self.df[(self.df['Architecture'] == 'SFU') & (self.df['Num_Viewers'] == 10)]['Presenter_CPU_Avg']
        
        if len(p2p_cpu_10) > 0 and len(sfu_cpu_10) > 0:
            t_stat, p_value = ttest_ind(p2p_cpu_10, sfu_cpu_10)
            print(f"P2P CPU (N=10): {p2p_cpu_10.mean():.2f}% ± {p2p_cpu_10.std():.2f}% (n={len(p2p_cpu_10)})")
            print(f"SFU CPU (N=10): {sfu_cpu_10.mean():.2f}% ± {sfu_cpu_10.std():.2f}% (n={len(sfu_cpu_10)})")
            print(f"t-statistic: {t_stat:.4f}")
            print(f"p-value: {p_value:.6f}")
            if p_value < 0.001:
                print("Result: ***HIGHLY SIGNIFICANT*** (p < 0.001)")
            elif p_value < 0.01:
                print("Result: **SIGNIFICANT** (p < 0.01)")
            elif p_value < 0.05:
                print("Result: *SIGNIFICANT* (p < 0.05)")
            else:
                print("Result: Not significant (p >= 0.05)")
        else:
            print("Insufficient data for CPU comparison at N=10 viewers")
        
        # Test 2: G2G Latency at 5% packet loss (for N=5 viewers)
        print("\\nTest 2: G2G Latency at 5% packet loss (N=5 viewers)")
        print("-" * 50)
        p2p_latency_5loss = self.df[(self.df['Architecture'] == 'P2P') & 
                                   (self.df['Num_Viewers'] == 5) & 
                                   (self.df['Packet_Loss_Rate'] == 5)]['Avg_Latency_Ms']
        sfu_latency_5loss = self.df[(self.df['Architecture'] == 'SFU') & 
                                   (self.df['Num_Viewers'] == 5) & 
                                   (self.df['Packet_Loss_Rate'] == 5)]['Avg_Latency_Ms']
        
        if len(p2p_latency_5loss) > 0 and len(sfu_latency_5loss) > 0:
            t_stat, p_value = ttest_ind(p2p_latency_5loss, sfu_latency_5loss)
            print(f"P2P Latency (5% loss, N=5): {p2p_latency_5loss.mean():.2f}ms ± {p2p_latency_5loss.std():.2f}ms (n={len(p2p_latency_5loss)})")
            print(f"SFU Latency (5% loss, N=5): {sfu_latency_5loss.mean():.2f}ms ± {sfu_latency_5loss.std():.2f}ms (n={len(sfu_latency_5loss)})")
            print(f"t-statistic: {t_stat:.4f}")
            print(f"p-value: {p_value:.6f}")
            if p_value < 0.001:
                print("Result: ***HIGHLY SIGNIFICANT*** (p < 0.001)")
            elif p_value < 0.01:
                print("Result: **SIGNIFICANT** (p < 0.01)")
            elif p_value < 0.05:
                print("Result: *SIGNIFICANT* (p < 0.05)")
            else:
                print("Result: Not significant (p >= 0.05)")
        else:
            print("Insufficient data for latency comparison at 5% packet loss")
        
        # Test 3: Text Legibility Score at 1Mbps bandwidth
        print("\\nTest 3: Text Legibility Score at 1Mbps bandwidth")
        print("-" * 45)
        p2p_tls_1mbps = self.df[(self.df['Architecture'] == 'P2P') & 
                               (self.df['Bandwidth_Mbps'] == 1)]['Text_Legibility_Score']
        sfu_tls_1mbps = self.df[(self.df['Architecture'] == 'SFU') & 
                               (self.df['Bandwidth_Mbps'] == 1)]['Text_Legibility_Score']
        
        if len(p2p_tls_1mbps) > 0 and len(sfu_tls_1mbps) > 0:
            t_stat, p_value = ttest_ind(p2p_tls_1mbps, sfu_tls_1mbps)
            print(f"P2P TLS (1Mbps): {p2p_tls_1mbps.mean():.2f} ± {p2p_tls_1mbps.std():.2f} (n={len(p2p_tls_1mbps)})")
            print(f"SFU TLS (1Mbps): {sfu_tls_1mbps.mean():.2f} ± {sfu_tls_1mbps.std():.2f} (n={len(sfu_tls_1mbps)})")
            print(f"t-statistic: {t_stat:.4f}")
            print(f"p-value: {p_value:.6f}")
            if p_value < 0.001:
                print("Result: ***HIGHLY SIGNIFICANT*** (p < 0.001)")
            elif p_value < 0.01:
                print("Result: **SIGNIFICANT** (p < 0.01)")
            elif p_value < 0.05:
                print("Result: *SIGNIFICANT* (p < 0.05)")
            else:
                print("Result: Not significant (p >= 0.05)")
        else:
            print("Insufficient data for TLS comparison at 1Mbps bandwidth")
        
        print("="*80)
    
    def generate_figure_6_1(self):
        """
        Generate Figure 6.1: Presenter CPU Utilization (%) vs. Number of Viewers
        Shows separate lines for P2P Mesh and SFU architectures.
        """
        logger.info("Generating Figure 6.1: CPU vs Viewers")
        
        fig, ax = plt.subplots(figsize=(10, 6))
        
        # Group by architecture and number of viewers, calculate mean CPU usage
        grouped_data = self.df.groupby(['Architecture', 'Num_Viewers'])['Presenter_CPU_Avg'].agg(['mean', 'std']).reset_index()
        
        # Plot lines for each architecture
        architectures = ['P2P', 'SFU']
        colors = {'P2P': '#e74c3c', 'SFU': '#3498db'}
        markers = {'P2P': 'o', 'SFU': 's'}
        
        for arch in architectures:
            arch_data = grouped_data[grouped_data['Architecture'] == arch]
            
            if len(arch_data) > 0:
                ax.errorbar(
                    arch_data['Num_Viewers'], 
                    arch_data['mean'],
                    yerr=arch_data['std'],
                    label=f'{arch} Mesh' if arch == 'P2P' else arch,
                    marker=markers[arch],
                    linewidth=2.5,
                    markersize=8,
                    color=colors[arch],
                    capsize=5
                )
        
        ax.set_xlabel('Number of Viewers', fontsize=12, fontweight='bold')
        ax.set_ylabel('Presenter CPU Utilization (%)', fontsize=12, fontweight='bold')
        ax.set_title('Figure 6.1: Presenter CPU Utilization vs Number of Viewers', 
                    fontsize=14, fontweight='bold', pad=20)
        
        ax.legend(fontsize=11, loc='upper left')
        ax.grid(True, alpha=0.3)
        ax.set_xlim(left=0)
        ax.set_ylim(bottom=0)
        
        # Add annotations for expected behavior
        ax.text(0.02, 0.98, 
               'Expected: P2P increases linearly\\nSFU remains flat and low', 
               transform=ax.transAxes, 
               fontsize=10, 
               verticalalignment='top',
               bbox=dict(boxstyle='round', facecolor='lightgray', alpha=0.8))
        
        plt.tight_layout()
        output_path = self.output_dir / 'presenter_cpu_vs_viewers.png'
        plt.savefig(output_path, dpi=300, bbox_inches='tight')
        plt.close()
        
        logger.info(f"Saved Figure 6.1 to {output_path}")
    
    def generate_figure_6_2(self):
        """
        Generate Figure 6.2: Average G2G Latency (ms) vs. Packet Loss Rate (%)
        Shows separate lines for P2P (N=5) and SFU (N=5) with 5 viewers.
        """
        logger.info("Generating Figure 6.2: Latency vs Packet Loss")
        
        fig, ax = plt.subplots(figsize=(10, 6))
        
        # Filter data for 5 viewers only
        filtered_data = self.df[self.df['Num_Viewers'] == 5]
        
        if len(filtered_data) == 0:
            logger.warning("No data found for 5 viewers. Using all available data.")
            filtered_data = self.df
        
        # Group by architecture and packet loss rate, calculate mean latency
        grouped_data = filtered_data.groupby(['Architecture', 'Packet_Loss_Rate'])['Avg_Latency_Ms'].agg(['mean', 'std']).reset_index()
        
        # Plot lines for each architecture
        architectures = ['P2P', 'SFU']
        colors = {'P2P': '#e74c3c', 'SFU': '#3498db'}
        markers = {'P2P': 'o', 'SFU': 's'}
        
        for arch in architectures:
            arch_data = grouped_data[grouped_data['Architecture'] == arch]
            
            if len(arch_data) > 0:
                ax.errorbar(
                    arch_data['Packet_Loss_Rate'], 
                    arch_data['mean'],
                    yerr=arch_data['std'],
                    label=f'{arch} (N=5)',
                    marker=markers[arch],
                    linewidth=2.5,
                    markersize=8,
                    color=colors[arch],
                    capsize=5
                )
        
        ax.set_xlabel('Packet Loss Rate (%)', fontsize=12, fontweight='bold')
        ax.set_ylabel('Average G2G Latency (ms)', fontsize=12, fontweight='bold')
        ax.set_title('Figure 6.2: Glass-to-Glass Latency vs Packet Loss Rate', 
                    fontsize=14, fontweight='bold', pad=20)
        
        ax.legend(fontsize=11, loc='upper left')
        ax.grid(True, alpha=0.3)
        ax.set_xlim(left=0)
        ax.set_ylim(bottom=0)
        
        # Add annotations for expected behavior
        ax.text(0.02, 0.98, 
               'Expected: P2P starts lower but\\ndegrades sharply. SFU more resilient.', 
               transform=ax.transAxes, 
               fontsize=10, 
               verticalalignment='top',
               bbox=dict(boxstyle='round', facecolor='lightgray', alpha=0.8))
        
        plt.tight_layout()
        output_path = self.output_dir / 'latency_vs_packet_loss.png'
        plt.savefig(output_path, dpi=300, bbox_inches='tight')
        plt.close()
        
        logger.info(f"Saved Figure 6.2 to {output_path}")
    
    def generate_figure_6_3(self):
        """
        Generate Figure 6.3: Text Legibility Score vs. Presenter Upload Bandwidth (Mbps)
        Shows separate series for P2P and SFU architectures.
        """
        logger.info("Generating Figure 6.3: Text Legibility vs Bandwidth")
        
        fig, ax = plt.subplots(figsize=(10, 6))
        
        # Group by architecture and bandwidth, calculate mean TLS
        grouped_data = self.df.groupby(['Architecture', 'Bandwidth_Mbps'])['Text_Legibility_Score'].agg(['mean', 'std']).reset_index()
        
        # Plot bars for each architecture
        architectures = ['P2P', 'SFU']
        colors = {'P2P': '#e74c3c', 'SFU': '#3498db'}
        
        # Get unique bandwidth values
        bandwidth_values = sorted(grouped_data['Bandwidth_Mbps'].unique())
        x = np.arange(len(bandwidth_values))
        width = 0.35
        
        for i, arch in enumerate(architectures):
            arch_data = grouped_data[grouped_data['Architecture'] == arch]
            
            if len(arch_data) > 0:
                # Align data with bandwidth values
                means = []
                stds = []
                
                for bw in bandwidth_values:
                    bw_data = arch_data[arch_data['Bandwidth_Mbps'] == bw]
                    if len(bw_data) > 0:
                        means.append(bw_data['mean'].iloc[0])
                        stds.append(bw_data['std'].iloc[0])
                    else:
                        means.append(0)
                        stds.append(0)
                
                ax.bar(
                    x + i * width, 
                    means,
                    width,
                    yerr=stds,
                    label=arch,
                    color=colors[arch],
                    alpha=0.8,
                    capsize=5
                )
        
        ax.set_xlabel('Presenter Upload Bandwidth (Mbps)', fontsize=12, fontweight='bold')
        ax.set_ylabel('Text Legibility Score (TLS)', fontsize=12, fontweight='bold')
        ax.set_title('Figure 6.3: Text Legibility Score vs Presenter Upload Bandwidth', 
                    fontsize=14, fontweight='bold', pad=20)
        
        ax.set_xticks(x + width / 2)
        ax.set_xticklabels([f'{int(bw)}' for bw in bandwidth_values])
        ax.legend(fontsize=11, loc='upper right')
        ax.grid(True, alpha=0.3, axis='y')
        ax.set_ylim(bottom=0)
        
        # Add annotations for expected behavior
        ax.text(0.02, 0.98, 
               'Expected: Both perform well at high bandwidth.\\nP2P degrades faster than SFU at low bandwidth.\\n(Lower score = better legibility)', 
               transform=ax.transAxes, 
               fontsize=10, 
               verticalalignment='top',
               bbox=dict(boxstyle='round', facecolor='lightgray', alpha=0.8))
        
        plt.tight_layout()
        output_path = self.output_dir / 'tls_vs_bandwidth.png'
        plt.savefig(output_path, dpi=300, bbox_inches='tight')
        plt.close()
        
        logger.info(f"Saved Figure 6.3 to {output_path}")
    
    def generate_figure_6_4(self):
        """
        Generate Figure 6.4: Estimated Total Egress Bandwidth (Mbps) vs. Number of Viewers
        Shows separate lines for P2P and SFU architectures.
        """
        logger.info("Generating Figure 6.4: Egress Bandwidth vs Viewers")
        
        fig, ax = plt.subplots(figsize=(10, 6))
        
        # Group by architecture and number of viewers, calculate mean egress bandwidth
        grouped_data = self.df.groupby(['Architecture', 'Num_Viewers'])['Egress_Bandwidth_Mbps'].agg(['mean', 'std']).reset_index()
        
        # Plot lines for each architecture
        architectures = ['P2P', 'SFU']
        colors = {'P2P': '#e74c3c', 'SFU': '#3498db'}
        markers = {'P2P': 'o', 'SFU': 's'}
        
        for arch in architectures:
            arch_data = grouped_data[grouped_data['Architecture'] == arch]
            
            if len(arch_data) > 0:
                ax.errorbar(
                    arch_data['Num_Viewers'], 
                    arch_data['mean'],
                    yerr=arch_data['std'],
                    label=arch,
                    marker=markers[arch],
                    linewidth=2.5,
                    markersize=8,
                    color=colors[arch],
                    capsize=5
                )
        
        ax.set_xlabel('Number of Viewers', fontsize=12, fontweight='bold')
        ax.set_ylabel('Estimated Total Egress Bandwidth (Mbps)', fontsize=12, fontweight='bold')
        ax.set_title('Figure 6.4: Estimated Total Egress Bandwidth vs Number of Viewers', 
                    fontsize=14, fontweight='bold', pad=20)
        
        ax.legend(fontsize=11, loc='upper left')
        ax.grid(True, alpha=0.3)
        ax.set_xlim(left=0)
        ax.set_ylim(bottom=0)
        
        # Add annotations for expected behavior
        ax.text(0.02, 0.98, 
               'Expected: P2P increases linearly\\n(N × presenter bandwidth)\\nSFU remains flat (single stream)', 
               transform=ax.transAxes, 
               fontsize=10, 
               verticalalignment='top',
               bbox=dict(boxstyle='round', facecolor='lightgray', alpha=0.8))
        
        plt.tight_layout()
        output_path = self.output_dir / 'egress_bandwidth_vs_viewers.png'
        plt.savefig(output_path, dpi=300, bbox_inches='tight')
        plt.close()
        
        logger.info(f"Saved Figure 6.4 to {output_path}")
    
    def generate_figure_6_5(self):
        """
        Generate Figure 6.5: Average Jitter vs. Packet Loss Rate (%)
        Shows separate lines for P2P and SFU architectures.
        """
        logger.info("Generating Figure 6.5: Jitter vs Packet Loss")
        
        fig, ax = plt.subplots(figsize=(10, 6))
        
        # Group by architecture and packet loss rate, calculate mean jitter
        grouped_data = self.df.groupby(['Architecture', 'Packet_Loss_Rate'])['Avg_Jitter_Ms'].agg(['mean', 'std']).reset_index()
        
        # Plot lines for each architecture
        architectures = ['P2P', 'SFU']
        colors = {'P2P': '#e74c3c', 'SFU': '#3498db'}
        markers = {'P2P': 'o', 'SFU': 's'}
        
        for arch in architectures:
            arch_data = grouped_data[grouped_data['Architecture'] == arch]
            
            if len(arch_data) > 0:
                ax.errorbar(
                    arch_data['Packet_Loss_Rate'], 
                    arch_data['mean'],
                    yerr=arch_data['std'],
                    label=arch,
                    marker=markers[arch],
                    linewidth=2.5,
                    markersize=8,
                    color=colors[arch],
                    capsize=5
                )
        
        ax.set_xlabel('Packet Loss Rate (%)', fontsize=12, fontweight='bold')
        ax.set_ylabel('Average Jitter (ms)', fontsize=12, fontweight='bold')
        ax.set_title('Figure 6.5: Average Jitter vs Packet Loss Rate', 
                    fontsize=14, fontweight='bold', pad=20)
        
        ax.legend(fontsize=11, loc='upper left')
        ax.grid(True, alpha=0.3)
        ax.set_xlim(left=0)
        ax.set_ylim(bottom=0)
        
        # Add annotations for expected behavior
        ax.text(0.02, 0.98, 
               'Expected: Both increase with packet loss.\\nP2P may be more sensitive to\\nnetwork instability.', 
               transform=ax.transAxes, 
               fontsize=10, 
               verticalalignment='top',
               bbox=dict(boxstyle='round', facecolor='lightgray', alpha=0.8))
        
        plt.tight_layout()
        output_path = self.output_dir / 'jitter_vs_packet_loss.png'
        plt.savefig(output_path, dpi=300, bbox_inches='tight')
        plt.close()
        
        logger.info(f"Saved Figure 6.5 to {output_path}")
    
    def generate_summary_statistics(self):
        """Generate summary statistics table."""
        logger.info("Generating summary statistics")
        
        # Create summary statistics by architecture
        summary_stats = []
        
        for arch in ['P2P', 'SFU']:
            arch_data = self.df[self.df['Architecture'] == arch]
            
            if len(arch_data) > 0:
                stats = {
                    'Architecture': arch,
                    'Total_Tests': len(arch_data),
                    'Avg_CPU_Usage': arch_data['Presenter_CPU_Avg'].mean(),
                    'Max_CPU_Usage': arch_data['Presenter_CPU_Avg'].max(),
                    'Avg_Latency': arch_data['Avg_Latency_Ms'].mean(),
                    'Min_Latency': arch_data['Avg_Latency_Ms'].min(),
                    'Max_Latency': arch_data['Avg_Latency_Ms'].max(),
                    'Avg_TLS': arch_data['Text_Legibility_Score'].mean(),
                    'Min_TLS': arch_data['Text_Legibility_Score'].min(),
                    'Max_TLS': arch_data['Text_Legibility_Score'].max()
                }
                summary_stats.append(stats)
        
        summary_df = pd.DataFrame(summary_stats)
        
        # Save to CSV
        summary_path = self.output_dir / 'summary_statistics.csv'
        summary_df.to_csv(summary_path, index=False, float_format='%.2f')
        logger.info(f"Saved summary statistics to {summary_path}")
        
        # Print to console
        print("\\n" + "="*80)
        print("SUMMARY STATISTICS")
        print("="*80)
        print(summary_df.to_string(index=False, float_format=lambda x: f'{x:.2f}'))
        print("="*80 + "\\n")
        
        return summary_df
    
    def run_analysis(self):
        """Run the complete analysis pipeline."""
        logger.info("Starting WebRTC performance analysis...")
        
        try:
            # Load and preprocess data
            self.load_data()
            if self.df is None or len(self.df) == 0:
                logger.error("No data available for analysis")
                return False
                
            self.preprocess_data()
            
            # Run statistical significance tests
            self.run_statistical_tests()
            
            # Generate all figures
            self.generate_figure_6_1()
            self.generate_figure_6_2()
            self.generate_figure_6_3()
            self.generate_figure_6_4()
            self.generate_figure_6_5()
            
            # Generate summary statistics
            self.generate_summary_statistics()
            
            logger.info("Analysis complete! All plots saved to the plots directory.")
            
            # List generated files
            plot_files = list(self.output_dir.glob('*.png'))
            stats_files = list(self.output_dir.glob('*.csv'))
            
            print("\\nGenerated files:")
            for file in plot_files + stats_files:
                print(f"  - {file}")
            
            return True
            
        except Exception as e:
            logger.error(f"Analysis failed: {e}")
            return False

def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description='Analyze WebRTC performance test results')
    parser.add_argument('--input', '-i', default='results.csv', 
                       help='Input CSV file path (default: results.csv)')
    parser.add_argument('--output', '-o', default='plots', 
                       help='Output directory for plots (default: plots)')
    parser.add_argument('--verbose', '-v', action='store_true', 
                       help='Enable verbose logging')
    
    args = parser.parse_args()
    
    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)
    
    # Create analyzer and run analysis
    analyzer = WebRTCAnalyzer(args.input, args.output)
    success = analyzer.run_analysis()
    
    sys.exit(0 if success else 1)

if __name__ == '__main__':
    main()