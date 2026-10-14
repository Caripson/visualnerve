FROM golang:1.26.5-bookworm AS bridge
WORKDIR /source/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
COPY docs/openapi.yaml /public/openapi.yaml
COPY API.md /public/API.md
RUN go run ./cmd/openapi /public/openapi.yaml \
    && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /bridge/visual-nerve ./cmd/visual-nerve

FROM python:3.13-slim-bookworm
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
COPY --from=bridge /bridge/ /bridge/
COPY --from=bridge /public/ /public/
COPY harness/ /harness/
USER 10001:10001
EXPOSE 47418
CMD ["python", "/harness/service.py"]
