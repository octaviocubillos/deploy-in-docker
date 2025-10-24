export default {
    node22: `
FROM node:22-alpine AS builder
WORKDIR /app
COPY app/package*.json ./
RUN npm install --only=production && npm cache clean --force
COPY app .

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app .
EXPOSE 3000
CMD ["node", "{handler}"]
`} as {[x: string]: string};