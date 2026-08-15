# Stage 1: Build the React frontend
FROM node:18-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Build the Python backend
FROM python:3.11-slim

# Set the working directory in the container
WORKDIR /app

# Install system dependencies, including FFmpeg and fonts for subtitles
RUN apt-get update && apt-get install -y \
    ffmpeg \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Copy the requirements file into the container
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code
COPY . .

# Copy the built React app from Stage 1
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Expose the port Render/Cloud Run expects (10000 by default)
EXPOSE 10000

# Run the FastAPI application using Uvicorn
# Render/Cloud Run injects PORT via environment variable; fallback to 10000
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-10000}
