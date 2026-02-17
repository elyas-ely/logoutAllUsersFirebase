# Stage 1: Build
FROM node:20-alpine AS build

# Set working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install production dependencies only
ENV NODE_ENV=production
RUN npm ci

# Copy app source code
COPY . .

# Stage 2: Production image
FROM node:20-alpine

WORKDIR /usr/src/app

# Copy only production dependencies from build stage
COPY --from=build /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app ./

# Expose port
EXPOSE 3000

# Start the server
CMD ["npm", "run", "start:server"]
