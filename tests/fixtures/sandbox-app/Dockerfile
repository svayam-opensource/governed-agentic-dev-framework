# Minimal, dependency-free image for the prj-e2e sandbox service.
FROM node:20-alpine
WORKDIR /app
COPY package.json server.js ./
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://localhost:8080/health || exit 1
CMD ["node", "server.js"]
