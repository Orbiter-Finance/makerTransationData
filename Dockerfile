FROM node:16.15
WORKDIR /app

RUN apt-get update
RUN apt-get install -y vim

RUN yarn config set ignore-engines true
RUN yarn global add pm2


COPY package.json .
RUN yarn install --network-timeout 600000
RUN yarn run postinstall

COPY pm2.json ./

# RUN curl -o /app/src/config/chain.json http://openapi.orbiter.finance/mainnet/public/chain.json
# RUN curl -o /app/src/config/maker.json http://openapi.orbiter.finance/mainnet/public/maker.json
# RUN curl -o /app/src/config/chainTest.json http://ec2-54-238-20-18.ap-northeast-1.compute.amazonaws.com:9095/public/chainTest.json
# RUN curl -o /app/src/config/makerTest.json http://ec2-54-238-20-18.ap-northeast-1.compute.amazonaws.com:9095/public/makerTest.json

COPY ./ .
RUN yarn run build
EXPOSE 8001
CMD ["node","./dist/index.js"]
