export default {
  port: 3000, // The port the proxy server will listen on
  target: 'https://openrouter.ai', // The target URL to proxy requests to
  logLevel: 'debug', // The logging level ('debug', 'info', 'warn', 'error')
  apiKeysPath: './config/api-keys.txt' // Path to the API keys file
};