FROM node:20.12.2 AS base
ENV MODE production
ENV HOST=0.0.0.0

ARG APP_PORT
ENV PORT=${APP_PORT}
EXPOSE ${APP_PORT}

ARG NETWORK=mainnet
ENV NETWORK=${NETWORK}

WORKDIR /usr/src/app
COPY package.json package-lock.json ./
RUN npm ci
COPY . /usr/src/app
RUN npm run build

# Set NODE_ENV for runtime (after build so devDependencies are available during npm ci)
ENV NODE_ENV=production

# Install Doppler CLI for runtime secret injection
RUN (curl -Ls --tlsv1.2 --proto "=https" --retry 3 https://cli.doppler.com/install.sh || wget -t 3 -qO- https://cli.doppler.com/install.sh) | sh -s -- --no-package-manager --no-install

# Add non-root user
RUN groupadd -r appuser && useradd -r -g appuser -m appuser
USER appuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/tenderly/status').then(r=>{if(!r.ok)throw r.status}).catch(()=>process.exit(1))"

# Doppler injects all secrets at runtime via DOPPLER_TOKEN, DOPPLER_PROJECT, DOPPLER_CONFIG env vars.
# server/plugins/chain-config.ts scans env vars and injects chain config via render:html hook.
CMD ["./doppler", "run", "--", "node", ".output/server/index.mjs"]
