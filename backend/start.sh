#!/bin/bash
# Check if Node.js is installed
if ! command -v node &> /dev/null
then
    echo "Node.js could not be found. Please install it to run the server."
    exit
fi

echo "Installing dependencies..."
npm install

echo "Starting Puzzle Clash Backend..."
npm start
