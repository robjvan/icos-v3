# Dev server for local docker-compose use.
FROM node:24-alpine

# Native Node modules such as better-sqlite3 may need to compile from source.
# Alpine does not include the required build toolchain by default.
RUN apk add --no-cache python3 make g++

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .

# NestJS API port
EXPOSE 3000

# Run with watch so code changes reload inside compose
CMD ["npm", "run", "start:dev"]
