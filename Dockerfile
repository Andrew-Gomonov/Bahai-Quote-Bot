FROM node:18-alpine

# Create app directory
WORKDIR /app

# Install app dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Bundle app source
COPY . .

ENV NODE_ENV=production

# Expose admin web port (change via ADMIN_PORT env)
EXPOSE 3000

CMD ["npm", "start"] 