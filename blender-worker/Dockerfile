# The Blender worker: Node (the HTTP wrapper) plus Blender (headless) in one image, for Cloud Run.
#
# Blender 5.2 LTS, pinned (the same release the scripts are tested on here). The version and its SHA-256 come from download.blender.org (the LTS page lists 5.2.2 and 4.5.14 as the
# maintained releases; checksum read from https://download.blender.org/release/Blender5.2/blender-5.2.2.sha256 on 2026-10-05).
# To move to another release: change the three ARGs, rerun tests/test_blender.py with that Blender, and bump JOB_VERSION in
# web/src/lib/blender/key.ts so old cached results are not reused.
FROM node:24-bookworm-slim

ARG BLENDER_SERIES=5.2
ARG BLENDER_VERSION=5.2.2
ARG BLENDER_SHA256=84098912789dc450e95697c4184fb8a90acbe5111c2ba4aede3fecb57806a168

# The libraries headless Blender needs to start (no window is ever opened). If Blender reports a missing .so, add its package here;
# `ldd /opt/blender/blender | grep "not found"` lists them.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
      libxi6 libxxf86vm1 libxfixes3 libxrender1 libgl1 libegl1 libsm6 libxkbcommon0 \
 && rm -rf /var/lib/apt/lists/*

# Download, check the checksum before unpacking, unpack, and remove the tools that were only needed for that.
RUN curl -fsSL -o /tmp/blender.tar.xz "https://download.blender.org/release/Blender${BLENDER_SERIES}/blender-${BLENDER_VERSION}-linux-x64.tar.xz" \
 && echo "${BLENDER_SHA256}  /tmp/blender.tar.xz" | sha256sum -c - \
 && mkdir /opt/blender \
 && tar -xJf /tmp/blender.tar.xz -C /opt/blender --strip-components=1 \
 && rm /tmp/blender.tar.xz \
 && apt-get purge -y --auto-remove curl xz-utils

# The code is owned by root and the process runs as an unprivileged user: it can read the wrapper and the scripts, not change them.
WORKDIR /app
COPY server.mjs recipe.mjs package.json ./
COPY scripts ./scripts

ENV BLENDER_BIN=/opt/blender/blender \
    NODE_ENV=production \
    PORT=8080

USER 10001:10001
EXPOSE 8080
CMD ["node", "server.mjs"]
