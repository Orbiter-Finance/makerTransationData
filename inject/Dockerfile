FROM node:16.15
RUN mkdir -p /home/inject
WORKDIR /home/inject
COPY ./ .
RUN yarn config set ignore-engines true
RUN yarn install --network-timeout 600000 && yarn run build

# CMD ["node","./dist/index.js"]