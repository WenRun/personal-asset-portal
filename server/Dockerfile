FROM python:3.12-slim

# 国内 NAS 访问 deb.debian.org 极慢（ffmpeg+字体 ~160MB 可拖一小时）：换清华镜像源
RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources /etc/apt/sources.list 2>/dev/null || true \
    && apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    fonts-noto-cjk \
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
