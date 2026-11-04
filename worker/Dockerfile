# Transcription worker: claims jobs from Postgres, transcribes recordings with faster-whisper on CPU,
# writes segments back. Audio is decoded by PyAV (bundled ffmpeg libs), so no system ffmpeg is needed.
FROM python:3.12-slim
ARG DIARIZATION=0
ENV PYTHONUNBUFFERED=1 HF_HOME=/models
WORKDIR /app
COPY requirements.txt requirements-diarize.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
 && if [ "$DIARIZATION" = "1" ]; then pip install --no-cache-dir -r requirements-diarize.txt; fi
COPY worker.py ./
RUN useradd -m worker && mkdir -p /models && chown worker /models
USER worker
CMD ["python", "worker.py"]
