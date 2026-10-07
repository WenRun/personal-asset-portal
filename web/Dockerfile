# 前端构建 + 静态托管（详细设计 §1.1）：内置 nginx 只做静态与 SPA 回退，TLS 由外层 NGINX 终结。
# 同源部署关键：VITE_API_BASE 留空 → client.ts 走相对路径 /api/*，请求与页面同域，CORS 不再参与。
FROM node:20-alpine AS build
WORKDIR /web
COPY package.json package-lock.json ./
ENV VITE_API_BASE=""
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /web/dist /usr/share/nginx/html
COPY nginx-static.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
