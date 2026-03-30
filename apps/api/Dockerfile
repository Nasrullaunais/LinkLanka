FROM node:22-alpine

WORKDIR /app/apps/api

# Install Bun
RUN apk add --no-cache curl bash && \
	curl -fsSL https://bun.sh/install | bash

ENV BUN_INSTALL=/root/.bun
ENV PATH=${BUN_INSTALL}/bin:${PATH}

# Copy API package and lock files
COPY apps/api/package.json apps/api/bun.lock ./

# Install API dependencies (this generates Linux-native modules)
RUN bun install --frozen-lockfile

# Copy all files
WORKDIR /app
COPY . .

# Run the API in development mode with auto-restart
CMD ["sh", "-c", "cd apps/api && bun run start:dev"]
