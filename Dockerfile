FROM node:20-alpine
WORKDIR /app
COPY cloudfunctions/room/roomCore.js ./roomCore.js
COPY cloudrun/room-server/package.json ./package.json
RUN npm install --omit=dev
COPY cloudrun/room-server/server.js ./server.js
ENV PORT=80
ENV ROOM_CORE_PATH=./roomCore
CMD ["npm", "start"]
