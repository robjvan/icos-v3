FROM node:24-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 4200

CMD ["npx", "ng", "serve", "--host", "0.0.0.0", "--port", "4200"]
# CMD ["./node_modules/.bin/ng", "serve", "--host", "0.0.0.0", "--port", "4200"]