# Use official Microsoft Playwright system image (includes node, browsers, and OS dependencies)
FROM mcr.microsoft.com/playwright:v1.62.1-jammy

# Set active workspace
WORKDIR /app

# Install package dependencies
COPY package*.json ./
RUN npm install

# Copy application source code
COPY . .

# Expose port (Express uses process.env.PORT or falls back to 3000)
EXPOSE 3000

# Start Express server
CMD ["node", "server.js"]
