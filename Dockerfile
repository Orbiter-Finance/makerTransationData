FROM node:16.15
RUN mkdir -p /home/makerTransationData
WORKDIR /home/makerTransationData
COPY ./ .
RUN apt-get update
RUN apt-get install -y vim
RUN yarn config set ignore-engines true
RUN yarn global add pm2
RUN yarn install --network-timeout 600000
RUN yarn run build
EXPOSE 8001
CMD ["node","./dist/index.js"]
