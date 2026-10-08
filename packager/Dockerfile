# The packager: Node (the HTTP wrapper) plus apksigner (to sign an Android build), in one image for Cloud Run.
#
# The players are not in the image: the owner builds them with Unity and puts them, with players.json, in a Cloud Storage bucket mounted at
# /players (see README.md). The signing key is a secret mounted as a file and a password in the environment, never in the image.
FROM node:24-bookworm-slim

# apksigner is Debian's package of the Android build tool (it needs a Java runtime, which the package pulls in).
RUN apt-get update \
 && apt-get install -y --no-install-recommends apksigner \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json server.mjs zip.mjs ./
ENV NODE_ENV=production PORT=8080 PLAYERS_DIR=/players
USER node
CMD ["node", "server.mjs"]
