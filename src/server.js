import express from 'express';
import proxy from './proxy.js';
import logger from './logger.js';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

const app = express();

// Increase default timeout
app.set('timeout', 60000);

// Basic request logging
app.use((req, res, next) => {
    const headers = { ...req.headers };
    if (headers.authorization) {
        headers.authorization = 'Bearer sk-or-...';
    }

    logger.info('Incoming request:', {
        method: req.method,
        url: req.url,
        headers: headers
    });
    next();
});

// Check for localhost
app.use((req, res, next) => {
    const isLocalhost = req.socket.remoteAddress === '::1' || 
                       req.socket.remoteAddress === '::ffff:127.0.0.1' ||
                       req.socket.remoteAddress === '127.0.0.1';
    
    if (!isLocalhost) {
        logger.warn(`Rejected non-localhost request from ${req.socket.remoteAddress}`);
        res.status(403).end();
        return;
    }

    next();
});

// Use proxy for all routes
app.use('/', proxy);

const port = process.env.PORT || 3000;

// Create server with increased timeout
const server = app.listen(port, 'localhost', () => {
    logger.info(`Proxy server listening on localhost:${port}`);
    logger.info('Forwarding requests to https://openrouter.ai');
});

// Set server timeouts
server.timeout = 60000;
server.keepAliveTimeout = 30000;

// Error handling
server.on('error', (err) => {
    logger.error('Server error:', err);
});

process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception:', err);
});

process.on('unhandledRejection', (err) => {
    logger.error('Unhandled rejection:', err);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    server.close(() => {
        logger.info('Server closed');
        process.exit(0);
    });
});