FROM node:18.18.0

RUN mkdir -p /home/node/app

WORKDIR /home/node/app

COPY package.json /home/node/app/package.json

RUN npm install

COPY . .

RUN npm run build

USER node
WORKDIR /home/node/app/dist

EXPOSE 5000

CMD ["node","index.js"]

