FROM node:20.12.2 AS base
ENV MODE production
ENV HOST 0.0.0.0

ARG APP_PORT
ENV PORT=${APP_PORT}
EXPOSE ${APP_PORT}

ARG NETWORK=mainnet
ENV NETWORK=${NETWORK}

WORKDIR /usr/src/app
COPY package.json package-lock.json ./
RUN npm i
COPY . /usr/src/app
RUN npm run build

# Install Doppler CLI for runtime secret injection
RUN (curl -Ls --tlsv1.2 --proto "=https" --retry 3 https://cli.doppler.com/install.sh || wget -t 3 -qO- https://cli.doppler.com/install.sh) | sh -s -- --no-package-manager --no-install

# Add non-root user
RUN groupadd -r appuser && useradd -r -g appuser appuser
USER appuser

# Doppler injects all secrets at runtime via DOPPLER_TOKEN, DOPPLER_PROJECT, DOPPLER_CONFIG env vars
CMD ["./doppler", "run", "--", "node", ".output/server/index.mjs"]
