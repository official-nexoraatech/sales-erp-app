# syntax=docker/dockerfile:1
# Scheduled backup sidecar (M13) — automates the manual steps proven correct
# in ERP-PLANNING/phase-completions/dr-drill-report.md (pg_dump -Fc, Redis SAVE,
# MinIO mirror), run on a cron schedule instead of by hand. PG-024 adds an
# `age`-encrypted offsite copy and Pushgateway metrics on top of that proven
# sequence — see backup.sh.

FROM alpine:3.20

RUN apk add --no-cache \
      bash \
      postgresql16-client \
      redis \
      curl \
      tar \
      age \
 && curl -fsSL https://dl.min.io/client/mc/release/linux-amd64/mc -o /usr/local/bin/mc \
 && chmod +x /usr/local/bin/mc

WORKDIR /app
COPY backup.sh /app/backup.sh
COPY push-metrics.sh /app/push-metrics.sh
RUN chmod +x /app/backup.sh /app/push-metrics.sh

COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]
