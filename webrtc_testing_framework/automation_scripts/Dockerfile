# Use the official Puppeteer base image which includes all dependencies
FROM ghcr.io/puppeteer/puppeteer:latest

# Switch to the root user to install Docker client
USER root

# Install Docker client to control network emulation
RUN apt-get update && apt-get install -y --no-install-recommends \
    docker.io \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

# Copy package files and install dependencies as root
COPY package*.json ./
RUN npm ci

# Copy the rest of the application code
COPY . .

# Ensure the app directory and results directory are writable
RUN chmod -R 755 /app
RUN mkdir -p /app/results && chmod -R 777 /app/results

# This command will be run by docker-compose (as root due to docker-compose override)
CMD ["node", "run_tests.js"]