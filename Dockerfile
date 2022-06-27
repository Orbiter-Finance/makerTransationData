FROM node:current
RUN mkdir -p /www/maker-datasource
WORKDIR /maker-datasource
COPY ./ .
RUN npm i
RUN npm run build
CMD ["node","./dist/index.js"]