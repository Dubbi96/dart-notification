FROM node:20-alpine AS builder

RUN apk add --no-cache openssl

WORKDIR /workspace

COPY packages/aos-rule-engine/package.json ./packages/aos-rule-engine/package.json
COPY backend/package.json backend/package-lock.json ./backend/
WORKDIR /workspace/backend
RUN npm ci --legacy-peer-deps

COPY packages/aos-rule-engine /workspace/packages/aos-rule-engine
RUN npx tsc -p ../packages/aos-rule-engine/tsconfig.json

COPY backend/prisma ./prisma
RUN npx prisma generate

COPY backend .
RUN npm run build

# ------- production -------
FROM node:20-alpine

# tzdata + TZ: 컨테이너 기본 TZ(UTC) 고정 해소(DAR-199). @Cron의 timeZone 옵션이
# 1차 방어선이나, 시스템 TZ도 KST로 고정해 Date 로컬 메서드·로그·보조 코드까지 일관.
RUN apk add --no-cache openssl tzdata
ENV TZ=Asia/Seoul

WORKDIR /workspace

COPY packages/aos-rule-engine/package.json ./packages/aos-rule-engine/package.json
COPY --from=builder /workspace/packages/aos-rule-engine/dist ./packages/aos-rule-engine/dist
COPY backend/package.json backend/package-lock.json ./backend/
WORKDIR /workspace/backend
RUN npm ci --legacy-peer-deps --omit=dev

COPY --from=builder /workspace/backend/dist ./dist
COPY --from=builder /workspace/backend/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /workspace/backend/prisma ./prisma

EXPOSE 3000

CMD ["node", "dist/src/main"]
