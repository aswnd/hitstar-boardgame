# Bun runtime — matches your local Bun 1.3.10
FROM oven/bun:1.3.10-slim

WORKDIR /app

# Install dependencies first (cached unless lockfile changes)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy the song previews first (~351 MB) so this heavy layer stays cached
# and is only rebuilt when the previews themselves change, not on code edits.
COPY previews/ ./previews/

# Copy the rest of the app
COPY . .

ENV PORT=3000
EXPOSE 3000

CMD ["bun", "run", "src/server.ts"]
