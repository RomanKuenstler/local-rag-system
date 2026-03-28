FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY worker.py /app/worker.py

ENV PYTHONUNBUFFERED=1

CMD ["python", "/app/worker.py"]
