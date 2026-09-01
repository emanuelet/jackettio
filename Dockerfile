FROM node:26-slim

RUN mkdir -p /home/node/app && chown -R node:node /home/node/app \
  && mkdir -p /data && chown -R node:node /data

WORKDIR /home/node/app

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN npm install --global pnpm@11.25.0

USER node

RUN pnpm install --prod --frozen-lockfile

COPY --chown=node:node ./src ./src

EXPOSE 4000

CMD [ "node", "src/index.js" ]
