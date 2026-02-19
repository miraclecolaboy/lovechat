FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
# 你代码里用 process.env.PORT || 3000，所以不用写死端口
EXPOSE 3000

CMD ["npm", "start"]
