FROM debian:bookworm-slim AS common
RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates busybox \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 installer-test

FROM common AS wget
RUN apt-get update \
    && apt-get install -y --no-install-recommends wget \
    && rm -rf /var/lib/apt/lists/*
USER 10001:10001
WORKDIR /home/installer-test
CMD ["sleep", "infinity"]

FROM common AS bootstrap
WORKDIR /root
CMD ["sleep", "infinity"]

FROM python:3.13-slim-bookworm AS fixtures
COPY fixture-server.py /fixture-server.py
USER 10001:10001
CMD ["python", "/fixture-server.py"]
