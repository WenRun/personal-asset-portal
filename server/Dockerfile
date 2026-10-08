FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# migrations + alembic.ini 必须进镜像：启动时 lifespan 执行 alembic upgrade head
COPY app ./app
COPY migrations ./migrations
COPY alembic.ini ./

EXPOSE 8000
# --proxy-headers：信任反代链路头（FORWARDED_ALLOW_IPS 由 compose 注入，仅私有容器网络）
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
