# Use an official Node.js runtime as a parent image
FROM node:24.2.0-slim

# Install Google Chrome's dependencies
# This is the magic part that installs the libraries Puppeteer needs
RUN apt-get update && apt-get install -y wkhtmltopdf && rm -rf /var/lib/apt/lists/*

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install app dependencies
RUN npm install

# Bundle app source
COPY . .

# Your app binds to port 5001, but Render will map its internal port
EXPOSE 5001

# Define the command to run your app
CMD [ "node", "index.js" ]