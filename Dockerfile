# Use an official Python runtime as a parent image
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

# Expose the port Render expects (10000 by default)
EXPOSE 10000

# Run the FastAPI application using Uvicorn
# Render injects PORT via environment variable; fallback to 10000
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-10000}
