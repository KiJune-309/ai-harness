# The former official registry images are no longer public. Package the same
# upstream release from its official GitHub assets and verify its published digest.
FROM alpine:3.22.2

ARG TARGETARCH
ARG MINIO_VERSION=RELEASE.2025-04-22T22-12-26Z

LABEL org.opencontainers.image.source="https://github.com/minio/minio" \
    org.opencontainers.image.version="RELEASE.2025-04-22T22-12-26Z" \
    org.opencontainers.image.licenses="AGPL-3.0-only"

# SHA-256 values are the official release asset digests for each Linux architecture.
RUN apk add --no-cache ca-certificates curl \
    && case "$TARGETARCH" in \
        amd64) checksum=53e2a2cb16c5366ea6fbbc479c19ddb4c6a0948273e752f740fb1fbf27bb817c ;; \
        arm64) checksum=6c2f3142c94240206123177f4ba1e360daa5d1e0a4962e90757ef4f92c3ab57c ;; \
        *) echo "Unsupported MinIO image architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
    && curl --fail --silent --show-error --location --retry 3 --proto '=https' --tlsv1.2 \
        "https://github.com/minio/minio/releases/download/${MINIO_VERSION}/minio.linux-${TARGETARCH}.${MINIO_VERSION}" \
        -o /usr/local/bin/minio \
    && echo "${checksum}  /usr/local/bin/minio" | sha256sum -c - \
    && chmod 755 /usr/local/bin/minio \
    && addgroup -S -g 10001 minio \
    && adduser -S -D -H -u 10001 -G minio minio \
    && mkdir -p /data \
    && chown minio:minio /data

USER minio
EXPOSE 9000 9001
ENTRYPOINT ["/usr/local/bin/minio"]
CMD ["server", "/data", "--console-address", ":9001"]
