FROM python:3.9-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY . .

# Create output directories
RUN mkdir -p /app/plots /app/data

# Make the script executable
RUN chmod +x analyze_results.py

# Default command
CMD ["python", "analyze_results.py", "--input", "/app/data/results.csv", "--output", "/app/plots"]