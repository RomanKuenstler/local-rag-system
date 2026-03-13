# ------------------------------------------------------------------------------
# Base Image
#
# Use the official Node.js Docker image.
# Version:
#   Node.js 22.19
# Distribution:
#   Debian "Trixie"
#
# This provides the runtime environment needed to execute the Node.js
# RAG application (index.js).
# ------------------------------------------------------------------------------
FROM node:22.19.0-trixie


# ------------------------------------------------------------------------------
# Working Directory
#
# Sets the working directory inside the container.
# All following commands will be executed relative to /app.
#
# The application code will live in this directory.
# ------------------------------------------------------------------------------
WORKDIR /app


# ------------------------------------------------------------------------------
# Copy dependency configuration
#
# Copy package.json and package-lock.json (if present) first.
# This allows Docker to cache the dependency installation layer
# and speeds up rebuilds when only source files change.
# ------------------------------------------------------------------------------
COPY package*.json ./


# ------------------------------------------------------------------------------
# Install Node.js dependencies
#
# Installs all libraries defined in package.json.
#
# These include:
# - LangChain
# - Qdrant client
# - text splitters
# - prompt utilities
# ------------------------------------------------------------------------------
RUN npm install


# ------------------------------------------------------------------------------
# Copy application source files
#
# Copies all JavaScript files (for example index.js) into the container.
#
# The application logic (retriever + embedding pipeline) lives here.
# ------------------------------------------------------------------------------
COPY *.js .


# ------------------------------------------------------------------------------
# Create a non-root user
#
# Running containers as root is not recommended for security reasons.
# Therefore we create a dedicated user for running the application.
#
# Group:
#   nodejs (gid 1001)
#
# User:
#   ai (uid 1001)
#
# The user will have a home directory and a bash shell.
# ------------------------------------------------------------------------------
RUN groupadd --gid 1001 nodejs && \
    useradd --uid 1001 --gid nodejs --shell /bin/bash --create-home ai


# ------------------------------------------------------------------------------
# Adjust file permissions
#
# Change ownership of the /app directory so that the newly created
# "ai" user can access and modify the application files.
# ------------------------------------------------------------------------------
RUN chown -R ai:nodejs /app


# ------------------------------------------------------------------------------
# Switch to the non-root user
#
# From this point forward, the container runs under the "ai" user
# instead of root.
#
# This improves security and follows container best practices.
# ------------------------------------------------------------------------------
USER ai