FROM node:16.15
WORKDIR /app
COPY package.json .

RUN apt-get update
RUN apt-get install -y vim

COPY package.json package-lock.json ./
RUN yarn config set ignore-engines true
RUN yarn global add pm2
RUN yarn install --network-timeout 600000

COPY pm2.json ./

COPY ./ .
RUN curl -o /app/src/config/chain.json http://openapi.orbiter.finance/mainnet/public/chain.json
RUN curl -o /app/src/config/maker.json http://openapi.orbiter.finance/mainnet/public/maker.json
RUN curl -o /app/src/config/chainTest.json http://ec2-54-238-20-18.ap-northeast-1.compute.amazonaws.com:9095/public/chainTest.json
RUN curl -o /app/src/config/makerTest.json http://ec2-54-238-20-18.ap-northeast-1.compute.amazonaws.com:9095/public/makerTest.json

RUN yarn run build

RUN yarn run postinstall

EXPOSE 8001
CMD ["node","./dist/index.js"]
