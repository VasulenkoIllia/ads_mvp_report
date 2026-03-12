FROM node:20-alpine AS build

WORKDIR /app

RUN apk add --no-cache tzdata
ENV TZ=Europe/Kyiv

COPY package*.json ./
COPY web/package*.json ./web/
COPY prisma ./prisma
COPY tsconfig.json ./
COPY src ./src
COPY web ./web

RUN npm ci
RUN npm --prefix web ci
RUN npm run build
RUN npx prisma generate

FROM node:20-alpine AS runtime

WORKDIR /app

RUN apk add --no-cache tzdata

ENV NODE_ENV=production
ENV TZ=Europe/Kyiv
ENV PORT=4010

COPY package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist
COPY docker/start.sh ./docker/start.sh

RUN chmod +x ./docker/start.sh

EXPOSE 4010

CMD ["./docker/start.sh"]
