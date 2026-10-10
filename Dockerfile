# JSON 工具容器镜像：零依赖源码直接跑在官方 Node LTS 上
# 构建：docker build -t json-tools .
# 运行：docker run -d -p 3000:3000 -v json-tools-data:/data --restart unless-stopped json-tools
FROM node:24-alpine

WORKDIR /app
COPY server.js LICENSE ./
COPY lib/ lib/
COPY public/ public/

# 数据（工作区/历史/AI 配置）落 /data，配合 -v 挂载持久化
ENV JSON_DATA=/data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/info').catch(() => process.exit(1))"

CMD ["node", "server.js"]
