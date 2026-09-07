# express-meaning: ONE IMAGE, THREE ROLES.
#
# The .cpcp manifest has claimed "one image, three processes, distinguished by
# the ROLE environment variable" since the FRONT/BACK/BACKJOB split, and there
# was no image. The claim was true of the code and unfalsifiable in practice:
# nothing could stand the three roles up beside each other to check.
#
#   docker run -e ROLE=back    ...   the todo seam. Owns the database.
#   docker run -e ROLE=front   ...   the browser UI. No database, no store import.
#   docker run -e ROLE=backjob ...   no ingress. Reaps expired receipts.
#
# NODE 24 IS A FLOOR, NOT A PREFERENCE. src/db.js uses node:sqlite, which is
# behind --experimental-sqlite on 22.5 and absent before it. Pinned by digest
# because a tag is documentation and the digest is the pin.
FROM node:24-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e

WORKDIR /app

# THE STORE LIVES ON A VOLUME, NOT IN THE IMAGE.
#
# TODOS_DB defaults to data/todos.sqlite3 inside the working tree, which in a
# container is a directory inside the layer: every new container would start
# from an empty store and lose every todo. /app/data is where the compose file
# mounts a named volume.
ENV NODE_ENV=production \
    TODOS_DB=/app/data/todos.sqlite3 \
    ROLE=back \
    PORT=3200 \
    HOST=0.0.0.0

# Dependencies before source, so editing a route does not reinstall express.
# --omit=dev because the tests run with node --test and need nothing installed.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY src/ ./src/
COPY public/ ./public/
# data/contextframes.local.json IS source: it is the labelled fallback served
# when the upstream seam refuses. Without it in the image, a refusal that should
# degrade to "local" becomes a second failure.
COPY data/ ./data/

# HOST=0.0.0.0 ABOVE IS A CONTAINER FACT, NOT A PUBLICATION.
#
# server.js defaults HOST to 127.0.0.1, which inside a container means nothing
# outside that container can reach it -- including a sibling on the pod network.
# Binding all interfaces is what makes the seam reachable AT ALL here; whether
# it is reachable from outside the pod is decided by whether a port is
# published, which is the deployment's business and not this file's.
EXPOSE 3200
CMD ["node", "server.js"]
