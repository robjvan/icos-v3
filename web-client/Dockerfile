# Production image: build the Angular SPA, then serve the static output
# with nginx. (The previous `ng serve` dev-server image OOMs on small
# Docker hosts: vite's dep optimizer exceeds the available heap and the
# container gets SIGKilled. Static serving uses ~15MB at runtime.)
FROM node:24-alpine AS build

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .
RUN npx ng build --configuration production

FROM nginx:alpine

COPY --from=build /usr/src/app/dist/web-client/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 4200
