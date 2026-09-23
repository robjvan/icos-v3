# Dev server for local docker-compose use.
# glibc base, not alpine/musl: native modules without musl prebuilds
# (e.g. RuVector — see M10a evidence) fail closed on alpine.
FROM node:24-slim

# Native Node modules such as better-sqlite3 may need to compile from source.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .

# NestJS API port
EXPOSE 3000

# Run with watch so code changes reload inside compose
CMD ["npm", "run", "start:dev"]
