FROM node

RUN npm install -g \
    yo \
    generator-joplin

WORKDIR /home/node/app

CMD ["npm", "run", "dist"]
