FROM node:20-bookworm-slim

# Install Chromium system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxcb1 \
    libxkbcommon0 \
    libx11-6 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

ENV DATA_DIR=/app/data
# Install browsers here so they're readable regardless of runtime user
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.playwright

WORKDIR /app

COPY package*.json ./

# Skip postinstall (playwright browser download) during npm ci
# We install Chromium manually in the next step so system deps are ready
RUN npm ci --ignore-scripts

# Install Chromium browser into /app/.playwright (world-readable)
RUN npx playwright install chromium

COPY . .
RUN npm run build

EXPOSE 3000
CMD ["sh", "-c", "npm start"]
