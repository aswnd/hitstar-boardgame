# Bun runtime — matches your local Bun 1.3.10
FROM oven/bun:1.3.10-slim

WORKDIR /app

# Install dependencies first (cached unless lockfile changes)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy the rest of the app, including the song previews (~351 MB)
COPY . .

ENV PORT=3000
EXPOSE 3000

CMD ["bun", "run", "src/server.ts"]
