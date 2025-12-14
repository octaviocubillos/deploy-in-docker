
FROM node:22-alpine
WORKDIR /app
COPY server.min.js .
EXPOSE 3000
CMD ["node", "server.min.js"]
