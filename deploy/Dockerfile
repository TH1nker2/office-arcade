# 摸鱼游戏厅 · 容器镜像
# 注意：房间/在线状态保存在进程内存，所以只能跑单副本，不要 scale 到多个实例。
FROM node:24-alpine

WORKDIR /app

# 只拷贝运行所需文件
COPY server.js package.json ./
COPY shared ./shared
COPY js ./js
COPY css ./css
COPY index.html icon.svg ./

RUN mkdir -p /app/data
VOLUME ["/app/data"]

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8090

EXPOSE 8090

CMD ["node", "server.js"]
