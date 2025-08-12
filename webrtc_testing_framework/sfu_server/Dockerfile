FROM node:18

# Install system dependencies required by mediasoup
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Create non-root user
RUN groupadd -r nodejs && useradd -r -g nodejs nodejs
USER nodejs

EXPOSE 3002
EXPOSE 10000-10100/udp

CMD ["node", "server.js"]