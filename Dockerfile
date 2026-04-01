FROM node:20-bookworm-slim

# Install system Chromium — more reliable than Playwright's downloaded binary
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    && rm -rf /var/lib/apt/lists/*

ENV DATA_DIR=/app/data
# Tell Playwright to skip its own browser download; we use system Chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

COPY package*.json ./

RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

EXPOSE 3000
CMD ["sh", "-c", "npm start"]
