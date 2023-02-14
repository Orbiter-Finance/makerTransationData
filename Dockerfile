FROM node:16.15
WORKDIR /app
COPY package.json .

RUN mkdir -p /app/src/config
RUN echo "[]" > /app/src/config/chain.json
RUN echo "{}" > /app/src/config/maker.json

RUN apt-get update
RUN apt-get install -y vim
RUN yarn config set ignore-engines true
RUN yarn global add pm2
RUN yarn install --network-timeout 600000

COPY ./ .
RUN curl -o /app/src/config/chain.json http://ec2-54-238-20-18.ap-northeast-1.compute.amazonaws.com:9095/public/chain.json
RUN curl -o /app/src/config/maker.json http://ec2-54-238-20-18.ap-northeast-1.compute.amazonaws.com:9095/public/maker.json
RUN yarn run build
EXPOSE 8001
CMD ["node","./dist/index.js"]
