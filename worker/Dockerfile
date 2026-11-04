# Transcription worker: claims jobs from Postgres, transcribes recordings with faster-whisper on CPU,
# labels speakers with sherpa-onnx, writes segments back. Audio is decoded by PyAV (bundled ffmpeg libs).
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 HF_HOME=/models DIARIZATION_MODELS=/opt/diarization
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
# Diarization models are part of the image so a server never depends on a runtime download.
ADD https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2 /tmp/seg.tar.bz2
ADD https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/nemo_en_titanet_small.onnx /opt/diarization/embedding.onnx
RUN mkdir -p /opt/diarization && tar xjf /tmp/seg.tar.bz2 -C /tmp \
 && mv /tmp/sherpa-onnx-pyannote-segmentation-3-0/model.onnx /opt/diarization/segmentation.onnx \
 && rm -rf /tmp/seg.tar.bz2 /tmp/sherpa-onnx-pyannote-segmentation-3-0 && chmod -R a+r /opt/diarization
COPY worker.py ./
RUN useradd -m worker && mkdir -p /models && chown worker /models
USER worker
CMD ["python", "worker.py"]
