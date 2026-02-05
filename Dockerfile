FROM node:20.12.2 AS base
ENV MODE production
ENV HOST 0.0.0.0

ARG APP_PORT
ENV PORT=${APP_PORT}
EXPOSE ${APP_PORT}

ARG NETWORK=mainnet
ENV NETWORK=${NETWORK}

ARG APPKIT_PROJECT_ID
ENV APPKIT_PROJECT_ID=${APPKIT_PROJECT_ID}

ARG APP_URL
ENV APP_URL=${APP_URL}

# Create app directory
WORKDIR /usr/src/app
# Copy package.json for installing dependencies
COPY package.json .
COPY package-lock.json .
# Install app dependencies
RUN npm i
# Copy app source with common folder
COPY . /usr/src/app
# Build app
RUN npm run build
# Start server
CMD [ "node", ".output/server/index.mjs" ]
